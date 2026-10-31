import { describe, expect, it, vi } from "vitest";
import { generateDoctorProfile } from "./gemini.server";
import type { StatedProfile } from "./contract";
const stated: StatedProfile = {
  years_in_practice: null,
  practice_setting: null,
  specialty: null,
  cancer_types: ["Lung"],
  topics: [],
  preferred_format: null,
  frequency: null,
};
const config = { apiKey: "test-key", model: "configured-model" };
const success = (value: unknown, finishReason = "STOP") =>
  Response.json({
    candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }],
  });

describe("Gemini profiling adapter", () => {
  it("uses a header secret and only whitelisted input, then validates the response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(success({ stated, suggested_focus: [] }));
    await generateDoctorProfile(
      { ...stated, full_name: "Secret name", patient_records: ["Secret patient"] },
      config,
      fetcher,
    );
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).not.toContain(config.apiKey);
    expect(init?.headers).toHaveProperty("x-goog-api-key", config.apiKey);
    expect(init?.body).not.toContain("Secret");
    expect(JSON.parse(init!.body as string).generationConfig.responseMimeType).toBe(
      "application/json",
    );
  });
  it("rejects truncated, blocked and invented responses", async () => {
    for (const response of [
      success({ stated, suggested_focus: [] }, "MAX_TOKENS"),
      Response.json({ promptFeedback: { blockReason: "SAFETY" } }),
      success({ stated: { ...stated, years_in_practice: 5 }, suggested_focus: [] }),
    ]) {
      await expect(
        generateDoctorProfile(stated, config, vi.fn<typeof fetch>().mockResolvedValue(response)),
      ).rejects.toThrow();
    }
  });
  it("does not expose upstream error content", async () => {
    await expect(
      generateDoctorProfile(
        stated,
        config,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("private error text", { status: 429 })),
      ),
    ).rejects.toThrow("gemini_http_429");
  });
});
