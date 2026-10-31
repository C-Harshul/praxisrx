import { describe, it, expect } from "vitest";
import { fixtureDraft, fixturePackage } from "../../../../scripts/fixtures/newsletter";
import { validateDraft, renderEvidence, modelInput } from "./content";
import { emailContent } from "./publication";
import { renderEmail } from "../delivery/render";
describe("constrained clinical rendering", () => {
  it("renders approved wording and deterministic source/passages", () => {
    const result = renderEvidence(fixtureDraft, fixturePackage)[0]!;
    expect(result.full_summary).toContain(
      fixturePackage.result.matches[0]!.evidence.claims[0]!.claim_text + " [1]",
    );
    expect(result.citations[0]).toMatchObject({
      claim_id: "fixture-claim",
      source_id: "fixture-source",
      supporting_passage: expect.any(String),
    });
    expect(result.covers_text).toContain("not been mapped");
    expect(result.applicability_percent).toBeNull();
  });
  it("rejects free prose, invented deterministic values, missing and cross-item citations", () => {
    expect(() =>
      validateDraft({ ...fixtureDraft, title: "Invented finding" }, fixturePackage),
    ).toThrow();
    expect(() =>
      validateDraft(
        { articles: [{ ...fixtureDraft.articles[0], cohort_percent: 99 }] },
        fixturePackage,
      ),
    ).toThrow();
    expect(() =>
      validateDraft(
        { articles: [{ ...fixtureDraft.articles[0], summary_claim_ids: [] }] },
        fixturePackage,
      ),
    ).toThrow();
    expect(() =>
      validateDraft(
        { articles: [{ ...fixtureDraft.articles[0], summary_claim_ids: ["other-item-claim"] }] },
        fixturePackage,
      ),
    ).toThrow();
  });
  it("requires claim provenance for funding/status assertions", () => {
    const pkg = structuredClone(fixturePackage);
    pkg.result.matches[0]!.evidence.funding = "Funded by a new sponsor";
    expect(() => validateDraft(fixtureDraft, pkg)).toThrow("disclosure_claim_missing");
  });
  it("does not send identity or aggregate data to the model", () => {
    const pkg = structuredClone(fixturePackage);
    pkg.input.patient_mix = { synced_at: "PRIVATE-TIMESTAMP", aggregates: { "RARE-COHORT": 4 } };
    const text = JSON.stringify(modelInput(pkg));
    expect(text).not.toContain("RARE-COHORT");
    expect(text).not.toContain("PRIVATE-TIMESTAMP");
    expect(text).not.toContain(pkg.input.profile.id);
  });
  it("escapes source text in HTML and excludes patient fields from email DTOs", () => {
    const newsletter = {
      articles: [
        {
          id: "article",
          title: "<script>alert(1)</script>",
          short_summary: "Reviewed text [1]",
          full_summary: "Quoted evidence",
          applicability_percent: 77,
          cohort_percent: 88,
          citations: [{ number: 1, title: "Source", url: "https://example.invalid/source" }],
        },
      ],
    } as unknown as Parameters<typeof emailContent>[0];
    const dto = emailContent(
      newsletter,
      "https://example.invalid",
      "https://example.invalid/unsubscribe",
    );
    const email = renderEmail(dto, true);
    expect(JSON.stringify(dto)).not.toContain("cohort");
    expect(email.html + email.text).not.toContain("77");
    const dom = new DOMParser().parseFromString(email.html, "text/html");
    expect(dom.querySelector("script")).toBeNull();
    expect(dom.querySelector("main")).not.toBeNull();
    expect(email.text).toContain("NO EMAIL SENT");
    expect(() =>
      renderEmail({
        ...dto,
        articles: [{ ...dto.articles[0]!, article_url: "javascript:alert(1)" }],
      }),
    ).toThrow("url_invalid");
  });
});
