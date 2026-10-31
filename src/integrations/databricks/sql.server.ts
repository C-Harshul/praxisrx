export const CANONICAL_HOST = "https://dbc-85372395-9d08.cloud.databricks.com";
export type SqlParameter = { name: string; value: string; type?: string };
export type SqlResult = { columns: string[]; rows: (string | null)[][] };

export function databricksConfig() {
  const host = (process.env["DATABRICKS_HOST"] ?? CANONICAL_HOST).replace(/\/$/, "");
  if (host !== CANONICAL_HOST) throw new Error("The designated Databricks workspace is required.");
  const warehouse = process.env["DATABRICKS_WAREHOUSE_ID"];
  const table = process.env["DATABRICKS_APP_TABLE"];
  if (!warehouse || !table || !/^[A-Za-z_]\w*\.[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(table))
    throw new Error("Databricks warehouse/table configuration is missing.");
  return { host, warehouse, table };
}

export async function databricksToken(): Promise<string> {
  if (process.env["DATABRICKS_TOKEN"]) return process.env["DATABRICKS_TOKEN"]!;
  // Local development only. Hosted deployments supply a server-side OAuth/PAT token.
  if (process.env["DATABRICKS_AUTH_PROFILE"] && process.env["NODE_ENV"] !== "production") {
    const { execFile } = await import("node:child_process");
    const result = await new Promise<string>((resolve, reject) => {
      execFile(
        "databricks",
        ["auth", "token", "--profile", process.env["DATABRICKS_AUTH_PROFILE"]!, "--output", "json"],
        { timeout: 15000, maxBuffer: 65536 },
        (error, stdout) =>
          error ? reject(new Error("Databricks CLI authentication unavailable.")) : resolve(stdout),
      );
    });
    const parsed = JSON.parse(result);
    if (typeof parsed.access_token === "string" && parsed.access_token) return parsed.access_token;
  }
  throw new Error("Databricks server authentication is missing.");
}

/** Only fixed server SQL reaches this transport. Values always use named parameters. */
export async function executeSql(
  statement: string,
  parameters: SqlParameter[] = [],
  fetcher: typeof fetch = fetch,
): Promise<SqlResult> {
  const config = databricksConfig();
  const headers = {
    Authorization: `Bearer ${await databricksToken()}`,
    "Content-Type": "application/json",
  };
  const request = async (path: string, init: RequestInit) => {
    const response = await fetcher(config.host + path, {
      ...init,
      headers,
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Databricks request failed (${response.status}).`);
    return response.json();
  };
  let result = await request("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({
      warehouse_id: config.warehouse,
      statement,
      parameters,
      wait_timeout: "10s",
      on_wait_timeout: "CONTINUE",
      disposition: "INLINE",
      format: "JSON_ARRAY",
      row_limit: 1000,
      byte_limit: 8_000_000,
    }),
  });
  const statementId = result.statement_id;
  const deadline = Date.now() + 90000;
  while (["PENDING", "RUNNING"].includes(result.status?.state) && Date.now() < deadline) {
    if (typeof statementId !== "string" || !/^[\w-]+$/.test(statementId))
      throw new Error("Invalid Databricks statement response.");
    await new Promise((resolve) => setTimeout(resolve, 500));
    result = await request(`/api/2.0/sql/statements/${statementId}`, { method: "GET" });
  }
  if (result.status?.state !== "SUCCEEDED") {
    // A timeout may have committed: callers must re-read the canonical state, never fall back.
    throw new Error("Databricks query did not complete. Refresh canonical state before retrying.");
  }
  if (result.manifest?.truncated || result.result?.next_chunk_index !== undefined)
    throw new Error("Databricks result exceeds the bounded app contract.");
  return {
    columns: result.manifest?.schema?.columns?.map((c: { name: string }) => c.name) ?? [],
    rows: result.result?.data_array ?? [],
  };
}
