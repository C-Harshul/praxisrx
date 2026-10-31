import { createHash } from "node:crypto";
import { z } from "zod";
import { CANCER_TYPES, SPECIALTIES, TOPICS } from "../options";
import { evidenceReleaseSchema, POPULATION_LABELS } from "../matching/contract";

export function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
export const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const id = z.string().min(1).max(200);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const unknown = z.string().min(1).nullable();
export const documentSchema = z
  .object({
    id,
    version: sha,
    title: id.or(z.string().min(1)),
    source_name: z.string().min(1),
    url: z
      .string()
      .url()
      .refine((s) => new URL(s).protocol === "https:"),
    original_url: z.string().url().nullable(),
    source_type: z.enum([
      "journal",
      "conference",
      "registry",
      "regulatory",
      "guideline",
      "press_release",
    ]),
    published_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    presentation_date: unknown,
    registry_updated_at: unknown,
    retrieved_at: z.string().datetime({ offset: true }),
    access: z.string().min(1),
    license: z.string().min(1),
    language: unknown,
    source_hash: sha,
    supporting_passage: z.string().min(1),
    location: z.string().min(1),
    identifiers: z.record(z.string().nullable()),
    study_ids: z.array(id),
    connector: id,
    acquisition_run: id,
    family_hint: z.enum(CANCER_TYPES),
    publication_types: z.array(z.string()),
    pmid: id,
    doi: unknown,
    pmcid: unknown,
  })
  .strict();
export type Document = z.infer<typeof documentSchema>;
export const candidateSchema = z
  .object({
    id,
    version: sha,
    title: z.string().min(1),
    cancer_families: z.array(z.enum(CANCER_TYPES)).min(1),
    specialties: z.array(z.enum(SPECIALTIES)).min(1),
    topics: z.array(z.enum(TOPICS)),
    subtypes: z.array(id),
    study_ids: z.array(id),
    evidence_type: z.string().min(1),
    population: z
      .object({
        id: id.nullable(),
        definition_id: id,
        version: id,
        inclusion: z.string().min(1),
        exclusion: z.string().min(1),
        predicates: z.record(z.unknown()),
        required_fields: z.array(id),
        denominator: z.string().min(1),
        unknowns: z.array(z.string()),
      })
      .strict(),
    details: z
      .object({
        phase: unknown,
        histology: unknown,
        stage: unknown,
        biomarker: unknown,
        treatment_line: unknown,
        previous_therapies: unknown,
        progression_requirement: unknown,
        intervention: unknown,
        comparator: unknown,
        geography: unknown,
        sample_size: z.number().int().positive().nullable(),
        endpoints: z.array(z.string()),
        maturity: unknown,
      })
      .strict(),
    funding: z.string().min(1),
    conflicts: z.string().min(1),
    regulatory: z
      .object({ jurisdiction: id, as_of: z.string(), status: z.string(), source_id: id.nullable() })
      .strict(),
    limitations: z.array(z.string()).min(1),
    status_flags: z.array(z.string()),
    synthetic: z.boolean(),
    claims: z
      .array(
        z
          .object({
            id,
            version: sha,
            claim_text: z.string().min(1),
            source_id: id,
            source_version: sha,
            supporting_passage: z.string().min(1),
            location: z.string().min(1),
            effect: z
              .object({
                endpoint: id,
                arms: z.array(id),
                units: id,
                analysis_population: id,
                time_point: id,
                estimate: z.number(),
                confidence_interval: z.tuple([z.number(), z.number()]).nullable(),
                maturity: id,
              })
              .strict()
              .nullable(),
            extraction: z
              .object({
                method: id,
                model: id.nullable(),
                prompt_version: id,
                schema_version: id,
                input_hash: sha,
              })
              .strict(),
          })
          .strict(),
      )
      .min(1),
    sources: z.array(documentSchema).min(1),
  })
  .strict();
export type Candidate = z.infer<typeof candidateSchema>;
export function validateCandidate(raw: unknown): Candidate {
  const c = candidateSchema.parse(raw);
  if (hash({ ...c, version: "" }) !== c.version) throw new Error("Item version mismatch");
  if (
    new Set(c.claims.map((x) => x.id)).size !== c.claims.length ||
    new Set(c.sources.map((x) => x.id)).size !== c.sources.length
  )
    throw new Error("Duplicate claim/source");
  if (c.population.id && !POPULATION_LABELS[c.population.id])
    throw new Error("Uncoordinated population alias");
  for (const source of c.sources) {
    const { version, retrieved_at, acquisition_run, ...identity } = source;
    if (hash(identity) !== version) throw new Error("Source version mismatch");
  }
  for (const claim of c.claims) {
    if (hash({ ...claim, version: "" }) !== claim.version)
      throw new Error("Claim version mismatch");
    const s = c.sources.find((s) => s.id === claim.source_id && s.version === claim.source_version);
    if (
      !s ||
      !s.supporting_passage.includes(claim.supporting_passage) ||
      s.source_hash !== claim.extraction.input_hash
    )
      throw new Error("Source/passage integrity failure");
    if (s.source_type === "registry" && claim.effect)
      throw new Error("Registry efficacy extraction needs separate reported source");
  }
  return c;
}
export const reviewSchema = z
  .object({
    id,
    item_id: id,
    item_version: sha,
    decision: z.enum(["approved", "rejected"]),
    reviewer: id,
    reviewed_at: z.string().datetime({ offset: true }),
    human_attestation: z.literal(true),
    scope: z.literal("claims-population-funding-limitations-regulatory-classification"),
    note: z.string().min(10),
    snapshot_hash: sha,
  })
  .strict();
export type Review = z.infer<typeof reviewSchema>;
export const invalidationSchema = z
  .object({
    id,
    item_id: id,
    item_version: sha.nullable(),
    kind: z.enum(["retracted", "superseded", "withdrawn", "correction"]),
    reason: z.string().min(1),
    actor: id,
    created_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type Invalidation = z.infer<typeof invalidationSchema>;
export function project(c: Candidate, review: Review) {
  // v1 has one family. Fan-out is intentionally prohibited to avoid repeated delivery.
  if (c.cancer_families.length !== 1)
    throw new Error(
      "Multi-family evidence requires reviewed indication-specific children before v1 publication",
    );
  return {
    id: c.id,
    version: c.version,
    title: c.title,
    cancer_type: c.cancer_families[0]!,
    topics: c.topics,
    population_id: c.population.id,
    eligibility_definition_id: c.population.definition_id,
    eligibility_summary: c.population.inclusion,
    status_flags: c.status_flags.filter((s) => s !== "pending human review"),
    funding: c.funding,
    reviewed_by: review.reviewer,
    reviewed_at: review.reviewed_at,
    claims: c.claims.map(({ id, claim_text, source_id, supporting_passage, location }) => ({
      id,
      claim_text,
      source_id,
      supporting_passage,
      location,
    })),
    sources: c.sources.map(({ id, source_name, title, url, published_date }) => ({
      id,
      source_name,
      title,
      url,
      published_date,
    })),
  };
}
export function buildRelease(
  candidates: unknown[],
  reviews: unknown[],
  invalidations: unknown[],
  reviewers: string[],
  cutoff: string,
  fixture = false,
) {
  const cs = candidates.map(validateCandidate),
    rs = reviews.map((r) => reviewSchema.parse(r)),
    inv = invalidations.map((i) => invalidationSchema.parse(i));
  if (new Set(cs.map((c) => c.id)).size !== cs.length)
    throw new Error("Select exactly one version per item");
  const members = [];
  for (const c of cs) {
    if (inv.some((i) => i.item_id === c.id && (!i.item_version || i.item_version === c.version)))
      continue;
    const decisions = rs.filter((r) => r.item_id === c.id && r.item_version === c.version);
    // Rejection wins for this exact version; new human review requires a new item version.
    if (decisions.some((r) => r.decision === "rejected")) continue;
    const r = decisions.find(
      (r) =>
        r.decision === "approved" && reviewers.includes(r.reviewer) && r.snapshot_hash === hash(c),
    );
    if (!r) continue;
    if (c.synthetic !== fixture) throw new Error("Synthetic/clinical release boundary");
    if (new Date(r.reviewed_at).getTime() > Date.now()) throw new Error("Future review timestamp");
    if (c.sources.some((s) => s.published_date && s.published_date > cutoff))
      throw new Error("Source after release cutoff");
    members.push({ candidate: c, review: r, item: project(c, r) });
  }
  members.sort((a, b) => a.item.id.localeCompare(b.item.id));
  const payload = evidenceReleaseSchema.parse({
    schema_version: "matching-kb.v1",
    items: members.map((m) => m.item),
  });
  const manifest = {
    schema_version: "kb-release.v1",
    kind: fixture ? "synthetic-integration-fixture" : "clinical",
    source_cutoff: cutoff,
    payload_hash: hash(payload),
    membership: members.map((m) => ({
      id: m.item.id,
      version: m.item.version,
      review_id: m.review.id,
      review_hash: hash(m.review),
      source_versions: m.candidate.sources.map((s) => ({
        id: s.id,
        version: s.version,
        content_hash: s.source_hash,
      })),
      claim_versions: m.candidate.claims.map((c) => ({ id: c.id, version: c.version })),
    })),
    validation: "passed-structural-and-review-gates",
    projection_status: "local-unpublished",
    invalidations_hash: hash(inv),
  };
  return { payload, manifest: { ...manifest, release_id: `kb-${hash(manifest)}` } };
}

/** Related reports remain distinct; unresolved reports are not counted as verified trials. */
export function groupReports(documents: Document[]) {
  const groups: Record<
    string,
    { study_id: string; verified_registry_identifier: boolean; reports: string[] }
  > = {};
  for (const source of documents) {
    const keys = source.study_ids.length ? source.study_ids : [`unresolved-report:${source.id}`];
    for (const study_id of keys) {
      const group = (groups[study_id] ??= {
        study_id,
        verified_registry_identifier: /^NCT\d{8}$/.test(study_id),
        reports: [],
      });
      const report = `${source.id}@${source.version}`;
      if (!group.reports.includes(report)) group.reports.push(report);
      group.reports.sort();
    }
  }
  return Object.values(groups).sort((a, b) => a.study_id.localeCompare(b.study_id));
}
