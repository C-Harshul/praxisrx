import type { DoctorState } from "../platform/types";
import type { MatchingInput, matchEvidence } from "./contract";

/** Canonical publication suppresses items; email outcomes and reading never do. */
export function publishedItemIds(state: DoctorState): string[] {
  return [
    ...new Set(
      state.newsletters
        .filter((n) => n.publication?.status === "published")
        .flatMap((n) => n.articles.flatMap((a) => (a.kb_item_id ? [a.kb_item_id] : []))),
    ),
  ].sort();
}

/** Private worker input. Never serialize this package into an email. */
export type RankedEvidencePackage = {
  schema_version: "ranked-evidence-package.v1";
  publication_state: "published";
  input_doctor_revision: string;
  profile_version: number;
  patient_mix_version: number | null;
  kb_pointer_revision: string;
  matcher_version: string;
  input: MatchingInput;
  result: ReturnType<typeof matchEvidence>;
};

/** Excludes names, email addresses, doctor codes and individual patient records. */
export function currentMatchingInput(state: DoctorState): MatchingInput | null {
  const profile = state.profiles.at(-1);
  if (!profile?.confirmed_at || profile.status !== "succeeded" || !state.doctor.onboarding_complete)
    return null;
  const mix =
    state.doctor.patient_data_linked && state.doctor.consent_given_at ? state.patient_mix : null;
  return {
    profile: {
      id: profile.id,
      version: profile.version,
      schema_version: profile.schema_version!,
      prompt_version: profile.prompt_version!,
      model: profile.model!,
      stated: profile.input,
      reviewed_focus: profile.reviewed_focus ?? [],
    },
    patient_mix: mix
      ? {
          synced_at: mix.synced_at,
          aggregates: Object.fromEntries(
            Object.entries(mix.aggregates).filter(
              (entry): entry is [string, number] => entry[1] !== null,
            ),
          ),
        }
      : null,
    delivered_item_ids: publishedItemIds(state),
  };
}
