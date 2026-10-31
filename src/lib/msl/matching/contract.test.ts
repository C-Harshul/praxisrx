import { describe, expect, it } from "vitest";
import { matchEvidence, type MatchingInput, type EvidenceRelease } from "./contract";

const input: MatchingInput = {
  profile: {
    id: "00000000-0000-0000-0000-000000000001",
    version: 1,
    schema_version: "doctor-profile.v1",
    prompt_version: "test",
    model: "test",
    stated: {
      years_in_practice: null,
      practice_setting: null,
      specialty: "Medical oncology",
      cancer_types: ["Lung"],
      topics: ["Immunotherapy"],
      preferred_format: "Written",
      frequency: "Weekly",
    },
    reviewed_focus: [{ cancer_type: "Lung", topic: "Immunotherapy" }],
  },
  patient_mix: {
    synced_at: "2026-10-30T00:00:00Z",
    aggregates: { "KRAS G12C": 12, "PD-L1 negative": 30, "ALK-positive": 0 },
  },
  delivered_item_ids: [],
};
const item: EvidenceRelease["items"][number] = {
  id: "synthetic-a",
  version: "test-only",
  title: "SYNTHETIC MATCHING FIXTURE — no clinical results",
  cancer_type: "Lung",
  topics: ["Immunotherapy"],
  population_id: "kras-g12c",
  eligibility_definition_id: null,
  eligibility_summary: "Synthetic eligibility placeholder",
  status_flags: ["SYNTHETIC — NOT CLINICAL EVIDENCE"],
  funding: "Synthetic placeholder",
  reviewed_by: "synthetic-test-reviewer",
  reviewed_at: "2026-10-30T00:00:00Z",
  claims: [
    {
      id: "claim-placeholder",
      claim_text: "Synthetic non-clinical placeholder",
      source_id: "source-placeholder",
      supporting_passage: "Synthetic non-clinical placeholder",
      location: "Test fixture",
    },
  ],
  sources: [
    {
      id: "source-placeholder",
      source_name: "Synthetic fixture",
      title: "Not a research citation",
      url: "https://example.invalid/test-fixture",
      published_date: null,
    },
  ],
};
const release = (...items: EvidenceRelease["items"]) => ({
  schema_version: "matching-kb.v1",
  items,
});

describe("deterministic matching", () => {
  it("ranks cohorts, filters specialty and delivered IDs, retains citation chain", () => {
    const result = matchEvidence(
      { ...input, delivered_item_ids: ["sent"] },
      release(
        item,
        { ...item, id: "higher", population_id: "pdl1-negative" },
        { ...item, id: "outside", cancer_type: "Breast" },
        { ...item, id: "sent" },
      ),
    );
    expect(result.matches.map((m) => m.item_id)).toEqual(["higher", "synthetic-a"]);
    expect(result.excluded).toEqual([
      { item_id: "outside", reason: "outside_specialty" },
      { item_id: "sent", reason: "already_delivered" },
    ]);
    expect(result.matches[0]?.applicability_percent).toBeNull();
    expect(result.matches[0]?.cohort_percent).toBe(30);
    expect(result.matches[0]?.evidence.claims[0]?.source_id).toBe("source-placeholder");
  });
  it("distinguishes zero, missing and unlinked; never invents eligibility", () => {
    const result = matchEvidence(input, release({ ...item, population_id: "alk-positive" }));
    expect(result.matches[0]).toMatchObject({
      cohort_percent: 0,
      applicability_percent: null,
      applicability_kind: "cohort_only",
    });
    expect(matchEvidence({ ...input, patient_mix: null }, release(item)).matches[0]).toMatchObject({
      cohort_percent: null,
      applicability_kind: "unknown",
    });
    expect(
      matchEvidence(input, release({ ...item, population_id: "unknown" })).matches[0]
        ?.cohort_percent,
    ).toBeNull();
  });
  it("resolves agreed aliases and refuses conflicting aliases", () => {
    const mix = {
      synced_at: "test",
      aggregates: {
        "ES-SCLC after 1L chemo-IO": 10,
        "Extensive-stage SCLC after first-line chemo-immunotherapy": 11,
      },
    };
    const evidence = release({ ...item, population_id: "es-sclc-after-1l-chemo-io" });
    expect(matchEvidence({ ...input, patient_mix: mix }, evidence).matches[0]?.reasons).toContain(
      "conflicting_population_aliases",
    );
    expect(
      matchEvidence(
        { ...input, patient_mix: { ...mix, aggregates: { "ES-SCLC after 1L chemo-IO": 10 } } },
        evidence,
      ).matches[0]?.cohort_percent,
    ).toBe(10);
  });
  it("has stable ties regardless of KB order and boosts stated topics", () => {
    const a = { ...item, id: "a" },
      b = { ...item, id: "b" };
    expect(matchEvidence(input, release(b, a))).toEqual(matchEvidence(input, release(a, b)));
    expect(
      matchEvidence(input, release({ ...item, id: "a", topics: [] }, { ...item, id: "b" }))
        .matches[0]?.item_id,
    ).toBe("b");
  });
  it("changes selection for a second doctor's specialty", () => {
    const second = {
      ...input,
      profile: {
        ...input.profile,
        stated: { ...input.profile.stated, cancer_types: ["Breast"] },
        reviewed_focus: [],
      },
    };
    expect(
      matchEvidence(
        second,
        release(item, { ...item, id: "breast", cancer_type: "Breast" }),
      ).matches.map((m) => m.item_id),
    ).toEqual(["breast"]);
  });
  it("fails closed on invalid sources, missing review, duplicates and invalid percentages", () => {
    expect(() => matchEvidence(input, release({ ...item, sources: [] }))).toThrow();
    expect(() => matchEvidence(input, release({ ...item, reviewed_by: "" }))).toThrow();
    expect(() => matchEvidence(input, release(item, item))).toThrow();
    expect(() =>
      matchEvidence(
        input,
        release({ ...item, claims: [{ ...item.claims[0]!, source_id: "missing" }] }),
      ),
    ).toThrow();
    expect(() =>
      matchEvidence(
        { ...input, patient_mix: { synced_at: "test", aggregates: { NSCLC: 101 } } },
        release(item),
      ),
    ).toThrow();
  });
});
