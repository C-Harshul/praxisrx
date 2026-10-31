import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  mutate: vi.fn(),
  audit: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("../platform/store.server", () => ({
  listRecords: mocks.list,
  mutateDoctor: mocks.mutate,
  audit: mocks.audit,
}));
vi.mock("./databricks.server", () => ({ generateDatabricksProfile: mocks.generate }));
import { runProfilingJob } from "./worker.server";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DATABRICKS_MODEL_ENDPOINT", "model");
});
describe("canonical profiling worker", () => {
  it("does not claim without model configuration", async () => {
    vi.stubEnv("DATABRICKS_MODEL_ENDPOINT", "");
    await expect(runProfilingJob()).rejects.toThrow("configuration_missing");
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("idles when there is no persisted work", async () => {
    mocks.list.mockResolvedValue([]);
    expect(await runProfilingJob()).toEqual({ status: "idle" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("persists a lease before model execution and sanitizes failures", async () => {
    const state = { profiles: [{ id: "job", status: "queued", attempts: 0, input: {} }] };
    mocks.list.mockResolvedValue([{ id: "doctor", state }]);
    mocks.mutate.mockImplementation(async (_id, fn) => fn(state));
    mocks.generate.mockImplementation(async () => {
      expect(state.profiles[0]!.status).toBe("processing");
      throw new Error("private details");
    });
    expect(await runProfilingJob()).toEqual({ status: "failed" });
    expect(state.profiles[0]).toMatchObject({
      error_code: "profile_generation_or_validation_failed",
      output: null,
    });
  });
  it("discards a completed model response after an intervening profile change", async () => {
    const state = { profiles: [{ id: "job", status: "queued", attempts: 0, input: {} }] };
    mocks.list.mockResolvedValue([{ id: "doctor", state }]);
    mocks.mutate.mockImplementation(async (_id, fn) => fn(state));
    mocks.generate.mockImplementation(async () => {
      state.profiles[0]!.status = "superseded";
      return { stated: {}, suggested_focus: [] };
    });
    expect(await runProfilingJob()).toEqual({ status: "superseded" });
    expect(mocks.audit).toHaveBeenLastCalledWith(
      state,
      "profiling-worker",
      "profiling_discarded",
      expect.objectContaining({ job_id: "job" }),
    );
  });
});
