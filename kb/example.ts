import { readFileSync, writeFileSync } from "node:fs";
import { hash, validateCandidate, buildRelease } from "../src/lib/msl/kb/core";
import { matchEvidence, matchingInputSchema } from "../src/lib/msl/matching/contract";
const c = JSON.parse(readFileSync("kb/data/candidates.json", "utf8"))[0];
c.id = "SYNTHETIC-ONLY-evidence";
c.title = "SYNTHETIC integration exercise; no clinical findings";
c.synthetic = true;
c.study_ids = ["SYNTHETIC-study"];
c.population.id = "nsclc";
c.population.inclusion = "Synthetic NSCLC cohort for contract verification only.";
c.funding = "Synthetic fixture; no real sponsor.";
c.status_flags = ["SYNTHETIC ONLY"];
const s = c.sources[0];
s.id = "SYNTHETIC-source";
s.title = "SYNTHETIC source";
s.source_name = "Synthetic integration fixture";
s.url = "https://example.org/synthetic-evidence";
s.original_url = null;
s.doi = null;
s.pmid = "SYNTHETIC";
s.pmcid = null;
s.identifiers = {};
s.study_ids = ["SYNTHETIC-study"];
s.supporting_passage =
  "This fictional source describes a synthetic integration exercise and contains no clinical findings.";
s.license = "Synthetic fixture generated for tests";
s.source_hash = hash(s.supporting_passage);
s.acquisition_run = "SYNTHETIC";
s.connector = "synthetic-fixture.v1";
const { version, retrieved_at, acquisition_run, ...identity } = s;
s.version = hash(identity);
const claim = c.claims[0];
claim.id = "SYNTHETIC-claim";
claim.claim_text = s.supporting_passage;
claim.supporting_passage = s.supporting_passage;
claim.source_id = s.id;
claim.source_version = s.version;
claim.extraction.input_hash = s.source_hash;
claim.extraction.method = "synthetic-fixture.v1";
claim.version = "";
claim.version = hash(claim);
c.version = "";
c.version = hash(c);
validateCandidate(c);
const review = {
  id: "SYNTHETIC-review",
  item_id: c.id,
  item_version: c.version,
  decision: "approved",
  reviewer: "SYNTHETIC-fixture-reviewer",
  reviewed_at: "2026-10-30T12:00:00Z",
  human_attestation: true,
  scope: "claims-population-funding-limitations-regulatory-classification",
  note: "SIMULATED review for synthetic contract verification only; no real reviewer.",
  snapshot_hash: hash(c),
};
const release = buildRelease([c], [review], [], ["SYNTHETIC-fixture-reviewer"], "2026-10-30", true);
const input = matchingInputSchema.parse({
  profile: {
    id: "00000000-0000-4000-8000-000000000001",
    version: 1,
    schema_version: "doctor-profile.v1",
    prompt_version: "SYNTHETIC",
    model: "SYNTHETIC",
    stated: {
      years_in_practice: 5,
      practice_setting: "Academic hospital",
      specialty: "Medical oncology",
      cancer_types: ["Lung"],
      topics: ["Clinical trials"],
      preferred_format: "Written",
      frequency: "Weekly",
    },
    reviewed_focus: [],
  },
  patient_mix: { synced_at: "2026-10-30T12:00:00Z", aggregates: { NSCLC: 60 } },
  delivered_item_ids: [],
});
const result = matchEvidence(input, release.payload);
const example = {
  label: "LOCAL SYNTHETIC INTEGRATION ONLY; NO NEWSLETTER GENERATED",
  candidate: c,
  simulated_review: review,
  release,
  matching_input: input,
  matching_result: result,
  newsletter_input: {
    selected_evidence: result.matches.map((m) => m.evidence),
    deterministic_reasons: result.matches.map(
      ({ item_id, cohort_percent, applicability_percent, reasons }) => ({
        item_id,
        cohort_percent,
        applicability_percent,
        reasons,
      }),
    ),
    clinical_text_policy:
      "Only supplied reviewed claims; deterministic cohort descriptions cite profile/snapshot provenance, never trial eligibility.",
  },
};
writeFileSync("kb/exports/synthetic-worked-example.json", JSON.stringify(example, null, 2) + "\n");
console.log(
  "Synthetic trace validated through actual matcher; cohort 60%, exact applicability null.",
);
