import { randomUUID } from "node:crypto";
import { audit } from "../platform/store.server";
import { queueProfile } from "../platform/profile-state";
import type { DoctorState, RecordSnapshot } from "../platform/types";
import { hospitalSyncSchema } from "./contract";
import type { HospitalSyncInput, HospitalSyncReceipt, CanonicalPatientSnapshot } from "./contract";

export type HospitalCanonicalStore = {
  list: () => Promise<RecordSnapshot<DoctorState>[]>;
  read: (id: string) => Promise<RecordSnapshot<DoctorState> | null>;
  commit: (before: RecordSnapshot<DoctorState>, next: DoctorState) => Promise<string>;
};
export class HospitalPublicationUnconfirmed extends Error {
  constructor() {
    super(
      "Databricks publication is unconfirmed. It may have committed. Refresh the directory and retry the same upload; no offline copy will be used.",
    );
    this.name = "HospitalPublicationUnconfirmed";
  }
}
function checkAccess(state: DoctorState, hospitalId: string, code: string) {
  if (
    state.schema_version !== "msl-app-state.v1" ||
    !state.hospital_ids.includes(hospitalId) ||
    state.assigned_code !== code ||
    state.doctor.doctor_id_code !== code ||
    !state.doctor.onboarding_complete ||
    !state.doctor.patient_data_linked ||
    !state.doctor.consent_given_at
  )
    throw new Error("Doctor consent or hospital assignment is unavailable.");
}
function sameUpload(previous: CanonicalPatientSnapshot, input: HospitalSyncInput) {
  return (
    previous.doctor_id_code === input.payload.doctor_id_code &&
    previous.synced_at === input.payload.synced_at &&
    previous.panel_size === input.payload.panel_size &&
    previous.min_cell_size === input.payload.min_cell_size &&
    previous.source_kind === input.sourceKind &&
    JSON.stringify(Object.entries(previous.aggregates).sort()) ===
      JSON.stringify(Object.entries(input.payload.aggregates).sort())
  );
}
/** No local acceptance/outbox: success means an acknowledged canonical commit or verified retry. */
export async function publishHospitalContext(
  hospitalId: string,
  value: unknown,
  store: HospitalCanonicalStore,
): Promise<HospitalSyncReceipt> {
  const input = hospitalSyncSchema.parse(value);
  if (Date.parse(input.payload.synced_at) > Date.now() + 300000)
    throw new Error("Export timestamp is in the future.");
  let records: RecordSnapshot<DoctorState>[];
  try {
    records = await store.list();
  } catch {
    throw new HospitalPublicationUnconfirmed();
  }
  const targets = records.filter(
    (r) =>
      r.state.assigned_code === input.payload.doctor_id_code &&
      r.state.hospital_ids.includes(hospitalId),
  );
  if (targets.length !== 1) throw new Error("Doctor is not uniquely assigned to this hospital.");
  let current: RecordSnapshot<DoctorState> | null;
  try {
    current = await store.read(targets[0]!.id);
  } catch {
    throw new HospitalPublicationUnconfirmed();
  }
  if (!current) throw new Error("Doctor is not provisioned in Databricks.");
  checkAccess(current.state, hospitalId, input.payload.doctor_id_code);
  const existing = current.state.sync_history.find((s) => s.id === input.requestId) as
    CanonicalPatientSnapshot | undefined;
  if (existing) {
    if (
      existing.created_at < current.state.doctor.consent_given_at! ||
      !sameUpload(existing, input) ||
      existing.publication?.hospital_id !== hospitalId ||
      existing.publication?.workspace_id !== "7474660613250664"
    )
      throw new Error("Request ID cannot be reused for different data or a revoked link.");
    return { ...existing, canonical_revision: current.revision };
  }
  if ((current.state.patient_mix?.id ?? null) !== input.expectedId)
    throw new Error("Patient context changed. Refresh before retrying.");
  if (
    current.state.patient_mix &&
    Date.parse(input.payload.synced_at) <= Date.parse(current.state.patient_mix.synced_at)
  )
    throw new Error("Export must be newer than the current snapshot.");
  const next = structuredClone(current.state);
  const snapshot: CanonicalPatientSnapshot = {
    ...input.payload,
    id: input.requestId,
    version: (next.sync_history.at(-1)?.version ?? 0) + 1,
    created_at: new Date().toISOString(),
    source_kind: input.sourceKind,
    publication: {
      schema_version: "hospital-publication.v1",
      status: "published",
      workspace_id: "7474660613250664",
      workspace_url: "https://dbc-85372395-9d08.cloud.databricks.com",
      record_id: current.id,
      snapshot_id: input.requestId,
      hospital_id: hospitalId,
    },
  };
  next.patient_mix = snapshot;
  next.sync_history.push(snapshot);
  queueProfile(next, randomUUID);
  audit(next, hospitalId, "hospital_patient_mix_published", {
    snapshot_id: snapshot.id,
    version: snapshot.version,
    source_kind: snapshot.source_kind,
    workspace_id: snapshot.publication.workspace_id,
    profile_id: next.profiles.at(-1)?.id ?? null,
  });
  try {
    // A failed/ambiguous HTTP response never becomes a successful local-only upload.
    const revision = await store.commit(current, next);
    return { ...snapshot, canonical_revision: revision };
  } catch {
    throw new HospitalPublicationUnconfirmed();
  }
}
