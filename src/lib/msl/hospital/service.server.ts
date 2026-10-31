import { readSession, requireSession } from "../platform/auth.server";
import { listRecords, readRecord, commitDoctor } from "../platform/store.server";
import type { DoctorState } from "../platform/types";
import { publishHospitalContext } from "./publication.server";
import type { HospitalDirectory } from "./contract";
export async function readHospitalDirectory(request: Request): Promise<HospitalDirectory> {
  const session = readSession(request, "hospital");
  if (!session)
    return { mode: "connected", authorized: false, hospital_name: "Hospital portal", doctors: [] };
  const records = await listRecords<DoctorState>("doctor");
  return {
    mode: "connected",
    authorized: true,
    hospital_name: "Databricks hospital workspace",
    doctors: records
      .filter((r) => r.state.hospital_ids.includes(session.id))
      .map(({ state }) => ({
        doctor_id_code: state.assigned_code,
        full_name: state.doctor.full_name ?? "Doctor",
        specialty: state.doctor.specialty ?? "Unknown",
        linked: state.doctor.patient_data_linked && !!state.doctor.consent_given_at,
        context:
          state.doctor.patient_data_linked && state.doctor.consent_given_at
            ? state.patient_mix
            : null,
        profile: state.profiles.at(-1)
          ? {
              version: state.profiles.at(-1)!.version,
              status: state.profiles.at(-1)!.status,
              confirmed: !!state.profiles.at(-1)!.confirmed_at,
            }
          : null,
        history:
          state.doctor.patient_data_linked && state.doctor.consent_given_at
            ? state.sync_history.filter((s) => s.created_at >= state.doctor.consent_given_at!)
            : [],
      })),
  };
}
export async function hospitalSync(request: Request, value: unknown) {
  const session = requireSession(request, "hospital");
  return publishHospitalContext(session.id, value, {
    list: () => listRecords<DoctorState>("doctor"),
    read: (id) => readRecord<DoctorState>("doctor", id),
    commit: commitDoctor,
  });
}
