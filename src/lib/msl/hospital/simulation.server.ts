import { hospitalSyncSchema, DEMO_PATIENT_MIX } from "./contract";
import type { HospitalDirectory, HospitalSyncInput } from "./contract";
import type { SyncSnapshot } from "../patient-sync/contract";

/** Isolated synthetic hospital store; never reads or writes connected doctor accounts. */
export function createHospitalSimulation(now: () => number = Date.now) {
  const doctors: HospitalDirectory["doctors"] = [
    {
      doctor_id_code: "DR-1001",
      full_name: "Dr. Ananya Rao",
      specialty: "Thoracic medical oncology",
      linked: true,
      context: structuredClone(DEMO_PATIENT_MIX),
      profile: { version: 1, status: "succeeded", confirmed: true },
      history: [],
    },
  ];
  const requests = new Map<string, { input: string; snapshot: SyncSnapshot }>();
  const jobs = new Map<string, { queuedAt: number; version: number }>();
  let version = 0;
  // Called by the independent local timer, also exposed for deterministic tests.
  function advance() {
    for (const [code, job] of jobs) {
      const doctor = doctors.find((d) => d.doctor_id_code === code)!;
      if (now() - job.queuedAt >= 2400) {
        doctor.profile = { version: job.version, status: "succeeded", confirmed: false };
        jobs.delete(code);
      } else if (now() - job.queuedAt >= 800)
        doctor.profile = { version: job.version, status: "processing", confirmed: false };
    }
  }
  return {
    advance,
    directory(): HospitalDirectory {
      return structuredClone({
        mode: "simulation",
        authorized: true,
        hospital_name: "Demo hospital",
        doctors,
      });
    },
    sync(value: HospitalSyncInput): SyncSnapshot {
      const input = hospitalSyncSchema.parse(value);
      const doctor = doctors.find((d) => d.doctor_id_code === input.payload.doctor_id_code);
      if (!doctor?.linked)
        throw new Error("Doctor is not assigned to this hospital or has not consented.");
      if (Date.parse(input.payload.synced_at) > now() + 300000)
        throw new Error("Export timestamp cannot be in the future.");
      const prior = requests.get(input.requestId);
      if (prior) {
        if (prior.input !== JSON.stringify(input)) throw new Error("Request ID conflict.");
        return structuredClone(prior.snapshot);
      }
      if ((doctor.context?.id ?? null) !== input.expectedId)
        throw new Error("Patient context changed. Refresh and preview again.");
      if (
        doctor.history.length &&
        Date.parse(input.payload.synced_at) < Date.parse(doctor.context!.synced_at)
      )
        throw new Error("An older export cannot replace newer patient context.");
      const snapshot: SyncSnapshot = {
        ...input.payload,
        id: input.requestId,
        version: ++version,
        created_at: new Date(now()).toISOString(),
        source_kind: input.sourceKind,
      };
      doctor.context = structuredClone(snapshot);
      doctor.history.unshift(structuredClone(snapshot));
      const nextVersion = (doctor.profile?.version ?? 0) + 1;
      doctor.profile = { version: nextVersion, status: "queued", confirmed: false };
      jobs.set(doctor.doctor_id_code, { queuedAt: now(), version: nextVersion });
      requests.set(input.requestId, {
        input: JSON.stringify(input),
        snapshot: structuredClone(snapshot),
      });
      return structuredClone(snapshot);
    },
  };
}
export const hospitalSimulation = createHospitalSimulation();
if (import.meta.env.DEV) {
  const timer = setInterval(() => hospitalSimulation.advance(), 400);
  timer.unref();
  if (import.meta.hot) import.meta.hot.dispose(() => clearInterval(timer));
}
