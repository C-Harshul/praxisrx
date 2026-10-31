import type { HostingProvenance } from "@/integrations/databricks/model-hosting.server";
import type { RankedEvidencePackage } from "../matching/handoff";
import type { Article, Citation, Newsletter } from "../platform/types";

export type PublishedNewsletter = Newsletter & {
  articles: (Article & { citations: Citation[] })[];
  provenance: {
    schema_version: "newsletter.v1";
    gate_version: string;
    prompt_version: string;
    input_hash: string;
    matching_run_id: string;
    kb_revision: string;
    release_version: string;
    profile_id: string;
    patient_mix_id: string | null;
    hosting: HostingProvenance;
    usage: Record<string, number>;
    latency_ms: number;
    review_provenance: unknown;
  };
};
export type GenerationJob = {
  provenance?: {
    model_endpoint: string;
    prompt_version: string;
    schema_version: "newsletter-selection.v1";
    gate_version: string;
    hosting: HostingProvenance | null;
  };
  id: string;
  matching_run_id: string;
  newsletter_id: string;
  status:
    "queued" | "processing" | "retry" | "published" | "preview" | "empty" | "failed" | "superseded";
  attempts: number;
  lease: string | null;
  lease_until: number;
  next_attempt_at: number;
  created_at: string;
  completed_at: string | null;
  error: string | null;
  // No raw source/patient input is duplicated in job history. Matching retains it.
  input_hash: string;
  result?: PublishedNewsletter;
};
export type NewsletterState = {
  schema_version: "newsletter-jobs.v1";
  jobs: GenerationJob[];
};
export type Package = RankedEvidencePackage;
