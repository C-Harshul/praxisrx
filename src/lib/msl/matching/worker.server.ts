import { randomUUID } from "node:crypto";
import { listRecords, readRecord, audit } from "../platform/store.server";
import type { DoctorState } from "../platform/types";
import { currentMatchingInput } from "./handoff";
import { matchEvidence, MATCHER_VERSION, evidenceReleaseSchema } from "./contract";

/** Canonical deterministic matching. Does not call profiling or briefing generation. */
export async function runMatchingJob() {
  const release = await readRecord<{ version: string; payload: unknown; published: boolean; kb_write_lock?:unknown }>(
    "kb_release",
    "published",
  );
  if (!release?.state.published || release.state.kb_write_lock != null) return { status: "waiting_for_reviewed_evidence" };
  evidenceReleaseSchema.parse(release.state.payload);
  const doctors = await listRecords<DoctorState>("doctor");
  const candidate = doctors.find(({ state }) => {
    const profile = state.profiles.at(-1);
    if (
      !profile?.confirmed_at ||
      profile.status !== "succeeded" ||
      !state.doctor.onboarding_complete
    )
      return false;
    const last = state.matching_runs.at(-1);
    const days = state.doctor.frequency === "Every two weeks" ? 14 : 7;
    return (
      !last ||
      !last.evidence_package ||
      (last.evidence_package.kb_pointer_revision!==release.revision && !state.newsletters.some((n)=>n.publication?.matching_run_id===last.id)) ||
      last.profile_id !== profile.id ||
      Date.now() - Date.parse(last.created_at) >= days * 86400_000
    );
  });
  if (!candidate) return { status: "idle" };
  const profile = candidate.state.profiles.at(-1)!;
  const mix =
    candidate.state.doctor.patient_data_linked && candidate.state.doctor.consent_given_at
      ? candidate.state.patient_mix
      : null;
  const input = currentMatchingInput(candidate.state)!;
  const result = matchEvidence(input, release.state.payload);
  const currentRelease = await readRecord("kb_release", "published");
  if (currentRelease?.revision !== release.revision) return { status: "superseded" };
  // Exact input revision guards consent, patient mix and profile changes during computation.
  const { commitDoctor } = await import("../platform/store.server");
  const next = structuredClone(candidate.state);
  const id = randomUUID();
  next.matching_runs.push({
    id,
    created_at: new Date().toISOString(),
    profile_id: profile.id,
    patient_mix_id: mix?.id ?? null,
    release_version: release.state.version,
    result,
    evidence_package: {
      schema_version: "ranked-evidence-package.v1",
      publication_state: "published",
      input_doctor_revision: candidate.revision,
      profile_version: profile.version,
      patient_mix_version: mix?.version ?? null,
      kb_pointer_revision: release.revision,
      matcher_version: MATCHER_VERSION,
      input,
      result,
    },
  });
  audit(next, "matching-worker", "matching_succeeded", {
    run_id: id,
    profile_id: profile.id,
    patient_mix_id: mix?.id ?? null,
    kb_release_version: release.state.version,
    matcher_version: MATCHER_VERSION,
  });
  const revision = await commitDoctor(candidate, next);
  return { status: "succeeded", matching_run_id: id, revision };
}
