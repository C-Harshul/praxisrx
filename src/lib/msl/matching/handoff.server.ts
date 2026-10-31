import { readRecord } from "../platform/store.server";
import type { DoctorState } from "../platform/types";
import { currentMatchingInput } from "./handoff";

/** Generation-side read only. Publication must recheck under its doctor CAS. */
export async function readCurrentRankedPackage(doctorId: string, runId: string) {
  const doctor = await readRecord<DoctorState>("doctor", doctorId);
  if (!doctor) return null;
  const run = doctor.state.matching_runs.find((r) => r.id === runId);
  const pkg = run?.evidence_package;
  if (
    !run ||
    !pkg ||
    pkg.schema_version !== "ranked-evidence-package.v1" ||
    pkg.publication_state !== "published"
  )
    return null;
  const input = currentMatchingInput(doctor.state);
  if (!input || JSON.stringify(input) !== JSON.stringify(pkg.input)) return null;
  const mix =
    doctor.state.doctor.patient_data_linked && doctor.state.doctor.consent_given_at
      ? doctor.state.patient_mix
      : null;
  if (
    (mix?.id ?? null) !== run.patient_mix_id ||
    (mix?.version ?? null) !== pkg.patient_mix_version
  )
    return null;
  const release = await readRecord<{ published: boolean; version: string; kb_write_lock?:unknown }>(
    "kb_release",
    "published",
  );
  if (
    !release?.state.published ||
    release.state.kb_write_lock != null ||
    release.revision !== pkg.kb_pointer_revision ||
    release.state.version !== run.release_version
  )
    return null;
  return {
    doctor_id: doctorId,
    matching_run_id: run.id,
    doctor_revision: doctor.revision,
    release_version: run.release_version,
    evidence_package: pkg,
  };
}
