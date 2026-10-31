import { z } from "zod";

export const POPULATIONS = [
  "NSCLC",
  "SCLC",
  "EGFR-mutant",
  "Post-osimertinib",
  "Post-osimertinib with MET alteration",
  "KRAS G12C",
  "ALK-positive",
  "PD-L1 ≥50%",
  "PD-L1 negative",
  "ES-SCLC after 1L chemo-IO",
  "Stage IV",
] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const patientUploadSchema = z
  .object({
    doctor_id_code: z.string().regex(/^DR-[A-Z0-9-]{1,32}$/),
    synced_at: z.string().datetime({ offset: true }),
    panel_size: z.number().int().min(5).max(1000000),
    min_cell_size: z.number().int().min(5).max(1000000),
    aggregates: z.record(z.enum(POPULATIONS), z.number().finite().min(0).max(100).nullable()),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.min_cell_size > value.panel_size || !Object.keys(value.aggregates).length)
      ctx.addIssue({
        code: "custom",
        message: "Panel size and aggregate categories are required.",
      });
    // Rounded percentages must not disclose small positive cells. Null means suppressed/unknown.
    for (const percent of Object.values(value.aggregates)) {
      if (
        percent != null &&
        percent > 0 &&
        Math.ceil(((percent + 0.5) * value.panel_size) / 100) - 1 < value.min_cell_size
      )
        ctx.addIssue({
          code: "custom",
          message: "Small positive cells must be suppressed (null).",
        });
    }
  });
export type PatientUpload = z.infer<typeof patientUploadSchema>;
export type SyncSnapshot = PatientUpload & {
  id: string;
  version: number;
  created_at: string;
  source_kind: "aggregate_json" | "synthetic_csv";
};

/** RFC 4180-style reader. Values are never included in errors or logged. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"' && cell === "" && !closed) quoted = true;
    else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        rows.push(row);
        row = [];
      }
    } else {
      if (closed || c === '"') throw new Error("Invalid CSV quoting.");
      cell += c;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (cell || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Only this known synthetic lung-panel format is supported, not arbitrary clinical exports. */
export function aggregateSyntheticCsv(text: string, now = new Date().toISOString()): PatientUpload {
  const rows = csvRows(text.replace(/^\uFEFF/, ""));
  const headers = rows.shift() ?? [];
  const expected = [
    "patient_id",
    "doctor_id_code",
    "age",
    "sex",
    "smoking_status",
    "cancer_type",
    "histology",
    "stage",
    "ecog",
    "egfr",
    "kras",
    "alk",
    "met",
    "pd_l1_tps",
    "prior_therapies",
    "current_therapy",
    "line_of_therapy",
    "disease_status",
    "last_visit_date",
    "archetype",
  ];
  if (
    headers.length !== expected.length ||
    new Set(headers).size !== headers.length ||
    expected.some((h) => !headers.includes(h))
  )
    throw new Error("Use the supplied synthetic patient CSV format with all expected columns.");
  const records = rows
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => {
      if (r.length !== headers.length)
        throw new Error("CSV row has a different number of columns.");
      return Object.fromEntries(headers.map((h, i) => [h, r[i]!]));
    });
  if (records.length < 5 || records.length > 50000)
    throw new Error("Use a panel of 5–50,000 synthetic patients.");
  const codes = new Set(records.map((r) => r["doctor_id_code"]));
  const ids = records.map((r) => r["patient_id"]!);
  if (codes.size !== 1 || ids.some((v) => !/^SYN-\d+$/.test(v)) || new Set(ids).size !== ids.length)
    throw new Error("Use unique synthetic patient IDs from exactly one doctor panel.");
  const counts = Object.fromEntries(POPULATIONS.map((k) => [k, 0])) as Record<
    (typeof POPULATIONS)[number],
    number
  >;
  for (const r of records) {
    const nsclc = r["cancer_type"] === "NSCLC";
    const sclc = r["cancer_type"] === "SCLC";
    if (
      (!nsclc && !sclc) ||
      !["Wild-type", "Not tested", "Exon 19 deletion", "L858R"].includes(r["egfr"]!) ||
      !["Wild-type", "Not tested", "G12C"].includes(r["kras"]!) ||
      !["Negative", "Positive", "Not tested"].includes(r["alk"]!) ||
      !["None", "Not tested", "Amplification", "Overexpression"].includes(r["met"]!) ||
      !["IA", "IB", "II", "IIIA", "IIIB", "IIIC", "IV", "Limited", "Extensive"].includes(
        r["stage"]!,
      )
    )
      throw new Error("Unsupported clinical category in synthetic CSV; no sync was performed.");
    const pd = r["pd_l1_tps"] === "" ? null : Number(r["pd_l1_tps"]);
    if (pd !== null && (!Number.isFinite(pd) || pd < 0 || pd > 100))
      throw new Error("Invalid PD-L1 value in synthetic CSV.");
    const post = nsclc && r["prior_therapies"]!.includes("Osimertinib");
    const flags = [
      nsclc,
      sclc,
      !["Wild-type", "Not tested"].includes(r["egfr"]!),
      post,
      post && ["Amplification", "Overexpression"].includes(r["met"]!),
      r["kras"] === "G12C",
      r["alk"] === "Positive",
      pd !== null && pd >= 50,
      pd === 0,
      sclc && r["stage"] === "Extensive" && r["line_of_therapy"]!.includes("maintenance"),
      ["IV", "Extensive"].includes(r["stage"]!),
    ];
    POPULATIONS.forEach((key, i) => {
      if (flags[i]) counts[key]++;
    });
  }
  return patientUploadSchema.parse({
    doctor_id_code: [...codes][0],
    synced_at: now,
    panel_size: records.length,
    min_cell_size: 5,
    aggregates: Object.fromEntries(
      POPULATIONS.map((k) => [
        k,
        counts[k] > 0 && counts[k] < 5 ? null : Math.round((100 * counts[k]) / records.length),
      ]),
    ),
  });
}

export function parsePatientUpload(
  text: string,
  kind: "aggregate_json" | "synthetic_csv",
): PatientUpload {
  if (new TextEncoder().encode(text).length > MAX_UPLOAD_BYTES)
    throw new Error("File must be 5 MB or smaller.");
  try {
    return kind === "synthetic_csv"
      ? aggregateSyntheticCsv(text)
      : patientUploadSchema.parse(JSON.parse(text.replace(/^\uFEFF/, "")));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      throw new Error(
        "Invalid aggregate JSON: check doctor ID, timestamp, panel size, cell threshold and supported percentages. Extra fields are not accepted.",
      );
    throw error;
  }
}
