import { CANONICAL_HOST, databricksToken } from "./sql.server";

// Approvals pin both the endpoint and the actual Databricks-managed model identity.
// Adding another name requires a hosting/capability review, not an environment-only change.
export const APPROVED_PROFILING_ENDPOINT = "databricks-gpt-oss-20b";
export const APPROVED_PROFILING_MODEL = "system.ai.gpt-oss-20b";
export const MODEL_HOSTING_POLICY_VERSION = "databricks-hosted-only.v1";
export type HostingProvenance = {
  hosting: "databricks";
  workspace_id: "7474660613250664";
  endpoint: string;
  model_entity: string;
  config_version: number;
  verified_at: string;
  hosting_policy_version: string;
};

function containsExternalRouting(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    if (["external_model", "external_models", "provider"].includes(key) && child != null)
      return true;
    if (key === "fallback_config" && child != null) return true;
    return containsExternalRouting(child);
  });
}

/** Fail closed: a Databricks hostname or endpoint name alone is not proof of hosting. */
export async function verifyProfilingHosting(endpoint: string, fetcher: typeof fetch = fetch) {
  if (endpoint !== APPROVED_PROFILING_ENDPOINT) throw new Error("model_hosting_unverified");
  const token = await databricksToken();
  const response = await fetcher(`${CANONICAL_HOST}/api/2.0/serving-endpoints/${endpoint}`, {
    method: "GET",
    redirect: "error",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("model_hosting_unverified");
  const metadata = await response.json();
  const entities = metadata.config?.served_entities;
  const routes = metadata.config?.traffic_config?.routes;
  if (
    metadata.name !== endpoint ||
    metadata.task !== "llm/v1/chat" ||
    metadata.state?.ready !== "READY" ||
    metadata.state?.config_update !== "NOT_UPDATING" ||
    metadata.pending_config != null ||
    containsExternalRouting(metadata) ||
    !Array.isArray(entities) ||
    entities.length !== 1 ||
    entities[0]?.name !== endpoint ||
    entities[0]?.foundation_model?.name !== APPROVED_PROFILING_MODEL ||
    (metadata.config?.served_models?.length ?? 0) !== 0 ||
    !Number.isInteger(metadata.config?.config_version) ||
    (routes !== undefined &&
      (!Array.isArray(routes) ||
        routes.length !== 1 ||
        routes[0]?.served_model_name !== endpoint ||
        routes[0]?.traffic_percentage !== 100))
  )
    throw new Error("model_hosting_unverified");
  const provenance: HostingProvenance = {
    hosting: "databricks",
    workspace_id: "7474660613250664",
    endpoint,
    model_entity: APPROVED_PROFILING_MODEL,
    config_version: metadata.config.config_version,
    verified_at: new Date().toISOString(),
    hosting_policy_version: MODEL_HOSTING_POLICY_VERSION,
  };
  return { token, provenance };
}
