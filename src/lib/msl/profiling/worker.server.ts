import type { HostingProvenance } from "@/integrations/databricks/model-hosting.server";
import { randomUUID } from "node:crypto";
import { generateDatabricksProfile } from "./databricks.server";
import { PROFILE_PROMPT_VERSION, PROFILE_SCHEMA_VERSION } from "./contract";
import { listRecords, mutateDoctor, audit } from "../platform/store.server";
import type { DoctorState } from "../platform/types";

/** Independent worker. The model call runs after the lease is durably stored in Delta. */
export async function runProfilingJob() {
  if (!process.env["DATABRICKS_MODEL_ENDPOINT"]) throw new Error("profiling_configuration_missing");
  const records = await listRecords<DoctorState>("doctor");
  const candidate = records.find(({ state }) => {
    const job = state.profiles.at(-1);
    return (
      job &&
      (job.status === "queued" ||
        (job.status === "processing" && Date.now() - Date.parse(job.started_at!) > 5 * 60_000))
    );
  });
  if (!candidate) return { status: "idle" };
  const lease = randomUUID();
  const claimed = await mutateDoctor(candidate.id, (state) => {
    const job = state.profiles.at(-1);
    if (
      !job ||
      job.id !== candidate.state.profiles.at(-1)?.id ||
      !["queued", "processing"].includes(job.status)
    )
      return null;
    if (job.status === "processing" && Date.now() - Date.parse(job.started_at!) < 5 * 60_000)
      return null;
    if (job.attempts >= 3) {
      job.status = "failed";
      job.error_code = "worker_lease_expired";
      job.completed_at = new Date().toISOString();
      audit(state, "profiling-worker", "profiling_failed", {
        job_id: job.id,
        error_code: job.error_code,
      });
      return null;
    }
    job.status = "processing";
    job.attempts++;
    job.lease_token = lease;
    job.started_at = new Date().toISOString();
    audit(state, "profiling-worker", "profiling_started", {
      job_id: job.id,
      attempt: job.attempts,
    });
    return { id: job.id, input: job.input };
  });
  if (!claimed) return { status: "idle" };
  let output = null;
  let error: string | null = null;
  let hosting: HostingProvenance | null = null;
  try {
    output = await generateDatabricksProfile(claimed.input, fetch, (verified) => {
      hosting = verified;
    });
  } catch (err) {
    error =
      err instanceof Error && err.message === "model_hosting_unverified"
        ? "model_hosting_unverified"
        : "profile_generation_or_validation_failed";
  }
  const metadata = {
    job_id: claimed.id,
    model: process.env["DATABRICKS_MODEL_ENDPOINT"]!,
    prompt_version: PROFILE_PROMPT_VERSION,
    schema_version: PROFILE_SCHEMA_VERSION,
    hosting_verification: hosting,
  };
  const status = await mutateDoctor(candidate.id, (state) => {
    const job = state.profiles.at(-1);
    if (!job || job.id !== claimed.id || job.status !== "processing" || job.lease_token !== lease) {
      audit(state, "profiling-worker", "profiling_discarded", metadata);
      return "superseded";
    }
    job.status = error ? "failed" : "succeeded";
    job.output = output;
    job.error_code = error;
    job.completed_at = new Date().toISOString();
    job.model = metadata.model;
    job.prompt_version = metadata.prompt_version;
    job.schema_version = metadata.schema_version;
    audit(state, "profiling-worker", `profiling_${job.status}`, { ...metadata, error_code: error });
    return job.status;
  });
  return { status };
}
