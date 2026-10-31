import { z } from "zod";
import { CANCER_TYPES, TOPICS } from "../options";
import { statedProfileSchema } from "../profiling/contract";

export const MATCHER_VERSION = "matching.v1";
const id = z.string().min(1).max(200);
const percent = z.number().finite().min(0).max(100);
const sourceSchema = z
  .object({
    id,
    source_name: z.string().min(1),
    title: z.string().min(1),
    url: z
      .string()
      .url()
      .refine((s) => new URL(s).protocol === "https:", "HTTPS required"),
    published_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  })
  .strict();
const claimSchema = z
  .object({
    id,
    claim_text: z.string().min(1),
    source_id: id,
    supporting_passage: z.string().min(1),
    location: z.string().min(1),
  })
  .strict();
export const evidenceItemSchema = z
  .object({
    id,
    version: id,
    title: z.string().min(1),
    cancer_type: z.enum(CANCER_TYPES),
    topics: z.array(z.enum(TOPICS)),
    population_id: id.nullable(),
    eligibility_definition_id: id.nullable(),
    eligibility_summary: z.string().min(1),
    status_flags: z.array(z.string().min(1)),
    funding: z.string().min(1),
    reviewed_by: id,
    reviewed_at: z.string().datetime({ offset: true }),
    claims: z.array(claimSchema).min(1),
    sources: z.array(sourceSchema).min(1),
  })
  .strict()
  .superRefine((item, ctx) => {
    for (const values of [item.claims, item.sources]) {
      if (new Set(values.map((v) => v.id)).size !== values.length)
        ctx.addIssue({ code: "custom", message: "Duplicate evidence IDs" });
    }
    for (const claim of item.claims) {
      if (!item.sources.some((source) => source.id === claim.source_id))
        ctx.addIssue({ code: "custom", message: "Claim references missing source" });
    }
  });
export const evidenceReleaseSchema = z
  .object({
    schema_version: z.literal("matching-kb.v1"),
    items: z.array(evidenceItemSchema),
  })
  .strict()
  .superRefine((release, ctx) => {
    if (new Set(release.items.map((v) => v.id)).size !== release.items.length)
      ctx.addIssue({ code: "custom", message: "Duplicate KB item IDs" });
  });

export const matchingInputSchema = z
  .object({
    profile: z
      .object({
        id: z.string().uuid(),
        version: z.number().int(),
        schema_version: id,
        prompt_version: id,
        model: id,
        stated: statedProfileSchema,
        reviewed_focus: z.array(
          z.object({ cancer_type: z.enum(CANCER_TYPES), topic: z.enum(TOPICS) }).strict(),
        ),
      })
      .strict(),
    // The legacy store has labels and percentages, but no eligibility definitions.
    patient_mix: z
      .object({
        synced_at: z.string(),
        aggregates: z.record(percent),
      })
      .strict()
      .nullable(),
    delivered_item_ids: z.array(id),
  })
  .strict();
export type MatchingInput = z.infer<typeof matchingInputSchema>;
export type EvidenceRelease = z.infer<typeof evidenceReleaseSchema>;

// Explicit aliases only. Unknown labels never match by fuzzy clinical inference.
export const POPULATION_LABELS: Readonly<Record<string, readonly string[]>> = {
  nsclc: ["NSCLC"],
  sclc: ["SCLC"],
  "egfr-mutant": ["EGFR-mutant"],
  "post-osimertinib": ["Post-osimertinib"],
  "post-osimertinib-met": ["Post-osimertinib with MET alteration"],
  "kras-g12c": ["KRAS G12C"],
  "alk-positive": ["ALK-positive"],
  "pdl1-high": ["PD-L1 ≥50%"],
  "pdl1-negative": ["PD-L1 negative"],
  "es-sclc-after-1l-chemo-io": [
    "ES-SCLC after 1L chemo-IO",
    "Extensive-stage SCLC after first-line chemo-immunotherapy",
  ],
  "stage-iv": ["Stage IV"],
};

/** Pure, deterministic and independent of the LLM and database. */
export function matchEvidence(rawInput: unknown, rawRelease: unknown) {
  const input = matchingInputSchema.parse(rawInput);
  const release = evidenceReleaseSchema.parse(rawRelease);
  const delivered = new Set(input.delivered_item_ids);
  const excluded: { item_id: string; reason: string }[] = [];
  const matches = release.items
    .flatMap((item) => {
      const reason = delivered.has(item.id)
        ? "already_delivered"
        : !input.profile.stated.cancer_types.includes(item.cancer_type)
          ? "outside_specialty"
          : null;
      if (reason) {
        excluded.push({ item_id: item.id, reason });
        return [];
      }
      const topicMatch = [
        ...new Set(item.topics.filter((t) => input.profile.stated.topics.includes(t))),
      ].sort();
      const focusMatch = input.profile.reviewed_focus.some(
        (f) => f.cancer_type === item.cancer_type && topicMatch.includes(f.topic),
      );
      const labels = item.population_id ? (POPULATION_LABELS[item.population_id] ?? []) : [];
      const values = labels.flatMap((label) => {
        const value = input.patient_mix?.aggregates[label];
        return value === undefined ? [] : [{ label, value }];
      });
      // Conflicting aliases are unknown, never whichever label happens to come first.
      const cohort =
        values.length && new Set(values.map((v) => v.value)).size === 1 ? values[0]!.value : null;
      const cohortReason =
        cohort !== null
          ? "potentially_relevant_cohort"
          : !input.patient_mix
            ? "patient_data_unlinked_or_unavailable"
            : values.length > 1
              ? "conflicting_population_aliases"
              : "population_unknown";
      return [
        {
          item_id: item.id,
          item_version: item.version,
          population_id: item.population_id,
          applicability_percent: null,
          cohort_percent: cohort,
          applicability_kind: cohort !== null ? "cohort_only" : "unknown",
          // Weighted percentage plus small topic boosts. Zero differs from unknown.
          score: (cohort ?? 0) * 100 + topicMatch.length * 2 + Number(focusMatch),
          topic_match: topicMatch,
          reasons: [
            "selected_cancer_type",
            cohortReason,
            ...topicMatch.map((t) => `topic:${t}`),
            ...(focusMatch ? ["doctor_confirmed_focus"] : []),
          ],
          evidence: item,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.cohort_percent !== null) - Number(a.cohort_percent !== null) ||
        (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0),
    );
  return { matcher_version: MATCHER_VERSION, matches, excluded };
}
