import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeSql, databricksConfig } from "./sql.server";
beforeEach(() => {
  vi.stubEnv("DATABRICKS_TOKEN", "secret");
  vi.stubEnv("DATABRICKS_WAREHOUSE_ID", "warehouse");
  vi.stubEnv("DATABRICKS_APP_TABLE", "workspace.msl_demo.app_state");
});
afterEach(() => vi.unstubAllEnvs());
describe("canonical SQL transport", () => {
  it("keeps credentials in headers and values in bound parameters", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: { state: "SUCCEEDED" },
        manifest: { schema: { columns: [{ name: "id" }] } },
        result: { data_array: [["row"]] },
      }),
    );
    const result = await executeSql(
      "SELECT :id",
      [{ name: "id", value: "'; DROP TABLE x" }],
      fetcher,
    );
    expect(result.rows).toEqual([["row"]]);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).not.toContain("secret");
    const body = JSON.parse(init!.body as string);
    expect(body.statement).toBe("SELECT :id");
    expect(body.parameters[0].value).toContain("DROP");
  });
  it("rejects another workspace or injected identifiers", () => {
    vi.stubEnv("DATABRICKS_HOST", "https://wrong-workspace.test");
    expect(() => databricksConfig()).toThrow("designated");
  });
  it("rejects failed and truncated results instead of substituting local data", async () => {
    for (const data of [
      { status: { state: "FAILED", error: { message: "private" } } },
      { status: { state: "SUCCEEDED" }, manifest: { truncated: true } },
    ]) {
      await expect(
        executeSql("SELECT 1", [], vi.fn<typeof fetch>().mockResolvedValue(Response.json(data))),
      ).rejects.toThrow();
    }
  });
});
