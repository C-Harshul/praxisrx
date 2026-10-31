import { z } from "zod";
import type { EvidenceRelease } from "../matching/contract";
import type { Package } from "./types";

export const PROMPT_VERSION = "newsletter-selection.v1";
export const GATE_VERSION = "exact-reviewed-claims.v1";
const ids = z.array(z.string().min(1).max(200)).min(1).max(12);
export const draftSchema = z
  .object({
    articles: z
      .array(
        z
          .object({
            item_id: z.string(),
            summary_claim_ids: ids.max(2),
            paragraph_claim_ids: z.array(ids).min(1).max(8),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export type Draft = z.infer<typeof draftSchema>;
export const draftJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["articles"],
  properties: {
    articles: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_id", "summary_claim_ids", "paragraph_claim_ids"],
        properties: {
          item_id: { type: "string" },
          summary_claim_ids: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
          paragraph_claim_ids: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "array", minItems: 1, maxItems: 12, items: { type: "string" } },
          },
        },
      },
    },
  },
};

/** Model selects and orders exact reviewed statements; it cannot author clinical paraphrases. */
export function modelInput(pkg: Package) {
  return {
    interests: {
      cancer_types: pkg.input.profile.stated.cancer_types,
      topics: pkg.input.profile.stated.topics,
    },
    items: pkg.result.matches.slice(0, 12).map(({ evidence }) => ({
      id: evidence.id,
      claims: evidence.claims.map((c) => ({ id: c.id, text: c.claim_text })),
    })),
  };
}
const unknown = (s: string) =>
  /^(unknown|not (reported|available|specified)|funding (unknown|not reported))[.\s]*$/i.test(
    s.trim(),
  );
export function validateDraft(raw: unknown, pkg: Package): Draft {
  const draft = draftSchema.parse(raw);
  const expected = pkg.result.matches.slice(0, 12).map((m) => m.item_id);
  if (
    new Set(draft.articles.map((a) => a.item_id)).size !== expected.length ||
    draft.articles.length !== expected.length
  )
    throw new Error("newsletter_item_set_invalid");
  for (const article of draft.articles) {
    const item = pkg.result.matches.find((m) => m.item_id === article.item_id)?.evidence;
    if (!item || !expected.includes(article.item_id))
      throw new Error("newsletter_item_set_invalid");
    const supplied = new Set(item.claims.map((c) => c.id));
    for (const group of [article.summary_claim_ids, ...article.paragraph_claim_ids]) {
      if (new Set(group).size !== group.length || group.some((id) => !supplied.has(id)))
        throw new Error("newsletter_claim_invalid");
    }
    // Disclosures with clinical meaning must themselves be approved atomic claims.
    for (const text of [...item.status_flags, item.funding])
      if (!unknown(text) && !item.claims.some((c) => c.claim_text === text))
        throw new Error("newsletter_disclosure_claim_missing");
  }
  return draft;
}

export type RenderedEvidence = ReturnType<typeof renderEvidence>;
export function renderEvidence(raw: unknown, pkg: Package) {
  const draft = validateDraft(raw, pkg);
  return draft.articles.map((selection) => {
    const matched = pkg.result.matches.find((m) => m.item_id === selection.item_id)!;
    const item = matched.evidence;
    const used: string[] = [];
    const cite = (id: string) => {
      if (!used.includes(id)) used.push(id);
      return used.indexOf(id) + 1;
    };
    const render = (group: string[]) =>
      group
        .map((id) => `${item.claims.find((c) => c.id === id)!.claim_text} [${cite(id)}]`)
        .join(" ");
    const summary = render(selection.summary_claim_ids);
    const paragraphs = selection.paragraph_claim_ids.map(render);
    const coverage = item.claims.find((c) => c.claim_text === item.eligibility_summary);
    const covers = coverage
      ? render([coverage.id])
      : "Complete eligibility has not been mapped to a reviewed claim in this briefing. Consult the original research.";
    const disclosures = [...item.status_flags, item.funding].map((text) => {
      const claim = item.claims.find((c) => c.claim_text === text);
      return claim
        ? render([claim.id])
        : "Funding disclosure is not mapped to a reviewed claim in this briefing.";
    });
    return {
      item_id: item.id,
      item_version: item.version,
      cancer_type: item.cancer_type,
      title: `${item.cancer_type} research briefing`,
      short_summary: summary,
      full_summary: [...paragraphs, ...disclosures].join("\n\n"),
      covers_text: covers,
      not_covers_text:
        "Exclusion criteria have not been separately mapped in this briefing. Do not infer eligibility; consult the original research.",
      applicability_percent: matched.applicability_percent,
      citations: used.map((id, i) => {
        const claim = item.claims.find((c) => c.id === id)!;
        const source = item.sources.find((s) => s.id === claim.source_id)!;
        return {
          number: i + 1,
          source_name: source.source_name,
          title: source.title,
          published_date: source.published_date,
          url: source.url,
          claim_id: id,
          source_id: source.id,
          supporting_passage: claim.supporting_passage,
          location: claim.location,
        };
      }),
    };
  });
}

export function clinicalReleaseAllowed(release: {
  manifest?: { kind?: string };
  published: boolean;
}) {
  return release.published === true && release.manifest?.kind === "clinical";
}
