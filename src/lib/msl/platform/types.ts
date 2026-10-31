import type { GeneratedProfile, StatedProfile } from "../profiling/contract";
import type { SyncSnapshot } from "../patient-sync/contract";
import type { RankedEvidencePackage } from "../matching/handoff";
import type { NewsletterState } from "../newsletter/types";
import type { DeliveryState } from "../delivery/types";
export type Doctor = {
  id: string;
  full_name: string | null;
  years_in_practice: number | null;
  practice_setting: string | null;
  specialty: string | null;
  cancer_types: string[];
  topics: string[];
  preferred_format: string | null;
  frequency: string | null;
  doctor_id_code: string | null;
  patient_data_linked: boolean;
  consent_given_at: string | null;
  onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
};
export type DoctorProfileUpdate = Partial<
  Pick<
    Doctor,
    | "full_name"
    | "years_in_practice"
    | "practice_setting"
    | "specialty"
    | "cancer_types"
    | "topics"
    | "preferred_format"
    | "frequency"
  >
>;
export type Newsletter = {
  id: string;
  doctor: string;
  sent_at: string;
  title: string;
  summary: string;
  // Legacy sent_at is a library timestamp, never evidence of email acceptance/delivery.
  publication?: {
    status: "published";
    published_at: string;
    matching_run_id: string;
  };
};
export type Article = {
  id: string;
  newsletter: string;
  kb_item_id?: string;
  title: string;
  cancer_type: string;
  short_summary: string;
  full_summary: string;
  covers_text: string;
  not_covers_text: string;
  applicability_percent: number | null;
  position: number;
};
export type Citation = {
  claim_id?: string;
  claim_version?: string;
  source_id?: string;
  source_version?: string;
  supporting_passage?: string;
  location?: string;
  id: string;
  article: string;
  number: number;
  source_name: string;
  title: string;
  published_date: string | null;
  url: string;
};
export type ProfileJob = {
  id: string;
  version: number;
  doctor: string;
  input: StatedProfile;
  patient_mix_id: string | null;
  status: "queued" | "processing" | "succeeded" | "failed" | "superseded";
  attempts: number;
  lease_token: string | null;
  started_at: string | null;
  created_at: string;
  completed_at: string | null;
  confirmed_at: string | null;
  output: GeneratedProfile | null;
  reviewed_focus: GeneratedProfile["suggested_focus"] | null;
  error_code: string | null;
  model: string | null;
  prompt_version: string | null;
  schema_version: string | null;
};
export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  created_at: string;
  details: Record<string, unknown>;
};
export type DoctorState = {
  newsletter_jobs?: NewsletterState;
  email_delivery?: DeliveryState;
  schema_version: "msl-app-state.v1";
  doctor: Doctor;
  assigned_code: string;
  hospital_ids: string[];
  patient_mix: SyncSnapshot | null;
  sync_history: SyncSnapshot[];
  profiles: ProfileJob[];
  matching_runs: {
    id: string;
    created_at: string;
    profile_id: string;
    patient_mix_id: string | null;
    release_version: string;
    result: unknown;
    // Absent on historical runs; those must be rematched before delivery-worker use.
    evidence_package?: RankedEvidencePackage;
  }[];
  newsletters: (Newsletter & { articles: (Article & { citations: Citation[] })[] })[];
  bookmarks: { article: string; created_at: string }[];
  audit: AuditEvent[];
};
export type RecordSnapshot<T> = { id: string; revision: string; state: T };
