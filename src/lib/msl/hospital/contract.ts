import { z } from "zod";
import { patientUploadSchema } from "../patient-sync/contract";
import type { PatientUpload, SyncSnapshot } from "../patient-sync/contract";
export const hospitalSyncSchema = z
  .object({
    payload: patientUploadSchema,
    sourceKind: z.enum(["aggregate_json", "synthetic_csv"]),
    requestId: z.string().uuid(),
    expectedId: z.string().uuid().nullable(),
  })
  .strict();
export type HospitalSyncInput = z.infer<typeof hospitalSyncSchema>;
export type HospitalDoctor = {
  doctor_id_code: string;
  full_name: string;
  specialty: string;
  linked: boolean;
  context: (PatientUpload & { id?: string; version?: number }) | null;
  profile: { version: number; status: string; confirmed: boolean } | null;
  history: SyncSnapshot[];
};
export type HospitalDirectory = {
  mode: "simulation" | "connected";
  authorized: boolean;
  hospital_name: string;
  doctors: HospitalDoctor[];
};
export const DEMO_PATIENT_MIX: PatientUpload = {
  doctor_id_code: "DR-1001",
  synced_at: "2026-10-30T09:00:00Z",
  panel_size: 180,
  min_cell_size: 5,
  aggregates: {
    NSCLC: 85,
    SCLC: 15,
    "EGFR-mutant": 20,
    "Post-osimertinib": 7,
    "Post-osimertinib with MET alteration": 4,
    "KRAS G12C": 12,
    "ALK-positive": 4,
    "PD-L1 ≥50%": 25,
    "PD-L1 negative": 30,
    "ES-SCLC after 1L chemo-IO": 10,
    "Stage IV": 60,
  },
};

/** A publication is visible only after its containing canonical Delta commit succeeds. */
export type CanonicalPatientSnapshot = SyncSnapshot & {
  publication: {
    schema_version: "hospital-publication.v1";
    status: "published";
    workspace_id: "7474660613250664";
    workspace_url: "https://dbc-85372395-9d08.cloud.databricks.com";
    record_id: string;
    snapshot_id: string;
    hospital_id: string;
  };
};
export type HospitalSyncReceipt = CanonicalPatientSnapshot & { canonical_revision: string };
