import { describe, expect, it, vi } from "vitest";
vi.mock("./sql.server", () => ({
  CANONICAL_HOST: "https://dbc-85372395-9d08.cloud.databricks.com",
  databricksToken: async () => "secret",
}));
import {
  verifyProfilingHosting,
  APPROVED_PROFILING_ENDPOINT as endpoint,
} from "./model-hosting.server";
const good = () => ({
  name: endpoint,
  task: "llm/v1/chat",
  state: { ready: "READY", config_update: "NOT_UPDATING" },
  config: {
    config_version: 1,
    served_entities: [{ name: endpoint, foundation_model: { name: "system.ai.gpt-oss-20b" } }],
  },
});
describe("Databricks-hosted-only policy", () => {
  it("checks managed model identity, readiness and configuration before approval", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(good()));
    const result = await verifyProfilingHosting(endpoint, fetcher);
    expect(result.provenance).toMatchObject({
      hosting: "databricks",
      model_entity: "system.ai.gpt-oss-20b",
      config_version: 1,
    });
    expect(fetcher.mock.calls[0]![1]?.redirect).toBe("error");
  });
  it("rejects unapproved endpoints without any request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(verifyProfilingHosting("external-provider-proxy", fetcher)).rejects.toThrow(
      "model_hosting_unverified",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects external models, provider routing, gateway fallback, unknown identities and unready configs", async () => {
    const invalid = [
      {
        ...good(),
        config: {
          ...good().config,
          served_entities: [{ name: endpoint, external_model: { provider: "external" } }],
        },
      },
      { ...good(), ai_gateway: { fallback_config: { enabled: true } } },
      { ...good(), pending_config: {} },
      { ...good(), state: { ready: "NOT_READY", config_update: "NOT_UPDATING" } },
      {
        ...good(),
        config: {
          ...good().config,
          served_entities: [{ name: endpoint, foundation_model: { name: "unverified" } }],
        },
      },
    ];
    for (const metadata of invalid)
      await expect(
        verifyProfilingHosting(
          endpoint,
          vi.fn<typeof fetch>().mockResolvedValue(Response.json(metadata)),
        ),
      ).rejects.toThrow("model_hosting_unverified");
  });
  it("does not approve unavailable metadata", async () => {
    await expect(
      verifyProfilingHosting(
        endpoint,
        vi.fn<typeof fetch>().mockResolvedValue(new Response("private", { status: 403 })),
      ),
    ).rejects.toThrow("model_hosting_unverified");
  });
});
