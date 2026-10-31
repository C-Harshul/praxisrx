// OFFLINE SYNTHETIC ONLY. Never publish this fixture into the canonical clinical KB.
import { matchEvidence } from "../../src/lib/msl/matching/contract";
import type { MatchingInput, EvidenceRelease } from "../../src/lib/msl/matching/contract";
import type { DoctorState } from "../../src/lib/msl/platform/types";
import type { RankedEvidencePackage } from "../../src/lib/msl/matching/handoff";
import { hash } from "../../src/lib/msl/kb/core";
export const doctorId = "00000000-0000-4000-8000-000000000001";
export const runId = "00000000-0000-4000-8000-000000000003";
const stated: MatchingInput["profile"]["stated"] = {
  years_in_practice: null,
  practice_setting: null,
  specialty: "Medical oncology",
  cancer_types: ["Lung"],
  topics: ["Immunotherapy"],
  preferred_format: "Written",
  frequency: "Weekly",
};
export const fixtureInput: MatchingInput = {
  profile: {
    id: "00000000-0000-4000-8000-000000000002",
    version: 1,
    schema_version: "doctor-profile.v1",
    prompt_version: "fixture",
    model: "fixture",
    stated,
    reviewed_focus: [],
  },
  patient_mix: null,
  delivered_item_ids: [],
};
export const fixtureRelease: EvidenceRelease = {
  schema_version: "matching-kb.v1",
  items: [
    {
      id: "SYNTHETIC-ONLY",
      version: "fixture-v1",
      title: "Synthetic workflow demonstration, not clinical evidence",
      cancer_type: "Lung",
      topics: ["Immunotherapy"],
      population_id: null,
      eligibility_definition_id: null,
      eligibility_summary: "Unknown",
      status_flags: [],
      funding: "Unknown",
      reviewed_by: "SYNTHETIC-FIXTURE-NO-HUMAN-APPROVAL",
      reviewed_at: "2026-10-31T00:00:00Z",
      claims: [
        {
          id: "fixture-claim",
          claim_text: "This synthetic workflow demonstration contains no clinical findings.",
          source_id: "fixture-source",
          supporting_passage:
            "This synthetic workflow demonstration contains no clinical findings.",
          location: "Local fixture",
        },
      ],
      sources: [
        {
          id: "fixture-source",
          source_name: "Synthetic fixture",
          title: "Not a research publication",
          url: "https://example.invalid/research",
          published_date: null,
        },
      ],
    },
  ],
};
export const fixturePackage: RankedEvidencePackage = {
  schema_version: "ranked-evidence-package.v1",
  publication_state: "published",
  input_doctor_revision: "fixture-doctor-revision",
  profile_version: 1,
  patient_mix_version: null,
  kb_pointer_revision: "fixture-kb-revision",
  matcher_version: "matching.v1",
  input: fixtureInput,
  result: matchEvidence(fixtureInput, fixtureRelease),
};
export const fixtureDraft = {
  articles: [
    {
      item_id: "SYNTHETIC-ONLY",
      summary_claim_ids: ["fixture-claim"],
      paragraph_claim_ids: [["fixture-claim"]],
    },
  ],
};
export function fixtureDoctor(): DoctorState {
  return {
    schema_version: "msl-app-state.v1",
    doctor: {
      id: doctorId,
      full_name: "Synthetic fixture",
      ...stated,
      doctor_id_code: null,
      patient_data_linked: false,
      consent_given_at: null,
      onboarding_complete: true,
      created_at: "2026-10-31T00:00:00Z",
      updated_at: "2026-10-31T00:00:00Z",
    },
    assigned_code: "DR-TEST",
    hospital_ids: [],
    patient_mix: null,
    sync_history: [],
    profiles: [
      {
        id: fixtureInput.profile.id,
        version: 1,
        doctor: doctorId,
        input: stated,
        patient_mix_id: null,
        status: "succeeded",
        attempts: 1,
        lease_token: null,
        started_at: null,
        created_at: "2026-10-31T00:00:00Z",
        completed_at: "2026-10-31T00:00:00Z",
        confirmed_at: "2026-10-31T00:00:00Z",
        output: { stated, suggested_focus: [] },
        reviewed_focus: [],
        error_code: null,
        model: "fixture",
        prompt_version: "fixture",
        schema_version: "doctor-profile.v1",
      },
    ],
    matching_runs: [
      {
        id: runId,
        created_at: "2026-10-31T00:00:00Z",
        profile_id: fixtureInput.profile.id,
        patient_mix_id: null,
        release_version: "fixture-release",
        result: fixturePackage.result,
        evidence_package: structuredClone(fixturePackage),
      },
    ],
    newsletters: [],
    bookmarks: [],
    audit: [],
  };
}
export function fixturePointer() {
  return {
    version: "fixture-release",
    published: true,
    payload: structuredClone(fixtureRelease),
    manifest: {
      kind: "synthetic-integration-fixture",
      payload_hash: hash(fixtureRelease),
      membership: [
        {
          id: "SYNTHETIC-ONLY",
          version: "fixture-v1",
          review_id: "fixture-review",
          review_hash: "fixture-hash",
          source_versions: [
            { id: "fixture-source", version: "fixture-source-v1", content_hash: "fixture-hash" },
          ],
          claim_versions: [{ id: "fixture-claim", version: "fixture-claim-v1" }],
        },
      ],
    },
  };
}
