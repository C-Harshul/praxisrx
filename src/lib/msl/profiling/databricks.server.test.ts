import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/databricks/sql.server", () => ({
  databricksToken: async () => "secret",
  CANONICAL_HOST: "https://dbc-85372395-9d08.cloud.databricks.com",
}));
vi.mock("@/integrations/databricks/model-hosting.server", () => ({
  verifyProfilingHosting: async () => ({
    token: "secret",
    provenance: { hosting: "databricks", model_entity: "system.ai.gpt-oss-20b" },
  }),
}));
import { generateDatabricksProfile } from "./databricks.server";
const input = {
  years_in_practice: null,
  practice_setting: null,
  specialty: null,
  cancer_types: ["Lung"],
  topics: ["Immunotherapy"],
  preferred_format: null,
  frequency: null,
};
afterEach(() => vi.unstubAllEnvs());
describe("Databricks model adapter", () => {
  it("strips patient data and identities before sending structured input", async () => {
    vi.stubEnv("DATABRICKS_MODEL_ENDPOINT", "databricks-gpt-oss-20b");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ stated: input, suggested_focus: [] }) },
          },
        ],
      }),
    );
    await generateDatabricksProfile(
      { ...input, full_name: "secret patient name", patient_records: ["private record"] },
      fetcher,
    );
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toContain("/serving-endpoints/databricks-gpt-oss-20b/invocations");
    expect(init?.body).not.toContain("secret patient name");
    expect(init?.body).not.toContain("private record");
  });
  it("rejects model hallucinations and truncation", async () => {
    vi.stubEnv("DATABRICKS_MODEL_ENDPOINT", "databricks-gpt-oss-20b");
    for (const response of [
      { choices: [{ finish_reason: "length" }] },
      {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                stated: { ...input, years_in_practice: 14 },
                suggested_focus: [],
              }),
            },
          },
        ],
      },
    ])
      await expect(
        generateDatabricksProfile(
          input,
          vi.fn<typeof fetch>().mockResolvedValue(Response.json(response)),
        ),
      ).rejects.toThrow();
  });
});
