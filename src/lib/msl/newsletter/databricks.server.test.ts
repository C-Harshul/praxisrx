import { beforeEach, describe, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@/integrations/databricks/model-hosting.server", () => ({
  verifyProfilingHosting: mock.verify,
}));
import { generateNewsletterDraft } from "./databricks.server";
import { fixtureDraft, fixturePackage } from "../../../../scripts/fixtures/newsletter";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEWSLETTER_MODEL_ENDPOINT", "databricks-gpt-oss-20b");
  mock.verify.mockResolvedValue({
    token: "test-token",
    provenance: { hosting: "databricks", model_entity: "system.ai.gpt-oss-20b" },
  });
});
describe("newsletter hosted inference", () => {
  it("uses only verified Databricks hosted structured inference and records usage", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(fixtureDraft) } }],
          usage: { total_tokens: 42 },
        }),
      ),
    );
    const result = await generateNewsletterDraft(fixturePackage, fetcher);
    expect(result.usage).toEqual({ total_tokens: 42 });
    expect(fetcher).toHaveBeenCalledWith(
      "https://dbc-85372395-9d08.cloud.databricks.com/serving-endpoints/databricks-gpt-oss-20b/invocations",
      expect.objectContaining({ redirect: "error" }),
    );
    expect(mock.verify).toHaveBeenCalledBefore(fetcher);
  });
  it("fails closed on unverified/external endpoints without fallback inference", async () => {
    vi.stubEnv("NEWSLETTER_MODEL_ENDPOINT", "external-proxy");
    const fetcher = vi.fn();
    await expect(generateNewsletterDraft(fixturePackage, fetcher)).rejects.toThrow(
      "hosting_unverified",
    );
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv("NEWSLETTER_MODEL_ENDPOINT", "databricks-gpt-oss-20b");
    mock.verify.mockRejectedValue(new Error("model_hosting_unverified"));
    await expect(generateNewsletterDraft(fixturePackage, fetcher)).rejects.toThrow(
      "hosting_unverified",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects truncated/invalid output rather than publishing partial text", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }),
        ),
      );
    await expect(generateNewsletterDraft(fixturePackage, fetcher)).rejects.toThrow("incomplete");
  });
});
