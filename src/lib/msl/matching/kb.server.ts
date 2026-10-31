import { evidenceReleaseSchema } from "./contract";
/** Canonical releases must be published by the reviewed-KB owner using its governed writer. */
export async function publishMatchingRelease(payload: unknown): Promise<never> {
  evidenceReleaseSchema.parse(payload);
  throw new Error(
    "Publish reviewed KB data through the canonical Databricks KB writer; app-side publication is disabled.",
  );
}
