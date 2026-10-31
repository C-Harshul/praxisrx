import { pickStatedProfile } from "../profiling/contract";
import type { DoctorState, ProfileJob } from "./types";
export function queueProfile(
  state: DoctorState,
  uuid: () => string = () => crypto.randomUUID(),
  now = new Date().toISOString(),
) {
  for (const job of state.profiles)
    if (job.status !== "superseded") {
      job.status = "superseded";
      job.confirmed_at = null;
    }
  if (!state.doctor.onboarding_complete) return;
  const job: ProfileJob = {
    id: uuid(),
    version: (state.profiles.at(-1)?.version ?? 0) + 1,
    doctor: state.doctor.id,
    input: pickStatedProfile(state.doctor),
    patient_mix_id:
      state.doctor.patient_data_linked && state.doctor.consent_given_at
        ? (state.patient_mix?.id ?? null)
        : null,
    status: "queued",
    attempts: 0,
    lease_token: null,
    started_at: null,
    created_at: now,
    completed_at: null,
    confirmed_at: null,
    output: null,
    reviewed_focus: null,
    error_code: null,
    model: null,
    prompt_version: null,
    schema_version: null,
  };
  state.profiles.push(job);
}
