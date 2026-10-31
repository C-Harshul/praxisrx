import { GATE_VERSION } from "./content";
import type { PublishedNewsletter, Package } from "./types";

/** Revalidate frozen/preview text without another model or a semantic-judge claim. */
export function validateFrozenNewsletter(newsletter: PublishedNewsletter, pkg: Package) {
  if (
    newsletter.provenance.gate_version !== GATE_VERSION ||
    newsletter.title !== "Your reviewed evidence briefing"
  )
    throw new Error("newsletter_frozen_gate_invalid");
  const expected = pkg.result.matches.slice(0, 12);
  if (
    newsletter.articles.length !== expected.length ||
    new Set(newsletter.articles.map((a) => a.kb_item_id)).size !== expected.length
  )
    throw new Error("newsletter_frozen_item_invalid");
  for (const article of newsletter.articles) {
    const matched = expected.find((m) => m.item_id === article.kb_item_id);
    if (
      !matched ||
      article.title !== `${matched.evidence.cancer_type} research briefing` ||
      article.applicability_percent !== matched.applicability_percent
    )
      throw new Error("newsletter_frozen_item_invalid");
    const item = matched.evidence;
    const snippets = article.citations.map((c, index) => {
      const claim = item.claims.find((claim) => claim.id === c.claim_id);
      const source = item.sources.find((s) => s.id === claim?.source_id);
      if (
        !claim ||
        !source ||
        c.number !== index + 1 ||
        c.source_id !== source.id ||
        c.url !== source.url ||
        c.title !== source.title ||
        c.supporting_passage !== claim.supporting_passage
      )
        throw new Error("newsletter_frozen_citation_invalid");
      return `${claim.claim_text} [${c.number}]`;
    });
    if (
      new Set(article.citations.map((c) => c.claim_id)).size !== article.citations.length ||
      !snippets.length
    )
      throw new Error("newsletter_frozen_citation_invalid");
    const approvedText = (text: string) => {
      let rest = text;
      while (rest.length) {
        const snippet = snippets.find((s) => rest === s || rest.startsWith(s + " "));
        if (!snippet) return false;
        rest = rest.slice(snippet.length);
        if (rest.startsWith(" ")) rest = rest.slice(1);
      }
      return text.length > 0;
    };
    if (!approvedText(article.short_summary)) throw new Error("newsletter_frozen_text_invalid");
    for (const paragraph of article.full_summary.split("\n\n"))
      if (
        !approvedText(paragraph) &&
        paragraph !== "Funding disclosure is not mapped to a reviewed claim in this briefing."
      )
        throw new Error("newsletter_frozen_text_invalid");
    const cover = item.claims.find((c) => c.claim_text === item.eligibility_summary);
    const marker = article.citations.find((c) => c.claim_id === cover?.id);
    const expectedCoverage =
      cover && marker
        ? `${cover.claim_text} [${marker.number}]`
        : "Complete eligibility has not been mapped to a reviewed claim in this briefing. Consult the original research.";
    if (
      article.covers_text !== expectedCoverage ||
      article.not_covers_text !==
        "Exclusion criteria have not been separately mapped in this briefing. Do not infer eligibility; consult the original research."
    )
      throw new Error("newsletter_frozen_coverage_invalid");
  }
}
