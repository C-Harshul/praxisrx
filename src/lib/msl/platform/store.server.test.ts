import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/integrations/databricks/sql.server", () => ({
  executeSql: mocks.execute,
  databricksConfig: () => ({ table: "workspace.msl_demo.app_state" }),
}));
import { commitDoctor, readRecord } from "./store.server";
import type { DoctorState, RecordSnapshot } from "./types";
const snapshot = () =>
  ({
    id: "doctor",
    revision: "r1",
    state: {
      schema_version: "msl-app-state.v1",
      doctor: { id: "doctor" },
      audit: [{ id: "event", actor: "doctor", action: "test", created_at: "now", details: {} }],
    },
  }) as RecordSnapshot<DoctorState>;
beforeEach(() => vi.resetAllMocks());
describe("Delta doctor commits", () => {
  it("binds the expected revision and commits appended audit alongside state", async () => {
    mocks.execute.mockResolvedValue({ columns: ["num_affected_rows"], rows: [["1"]] });
    const before = snapshot();
    const next = structuredClone(before.state);
    next.audit.push({ ...next.audit[0]!, id: "second" });
    await commitDoctor(before, next);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining("revision = :expected"),
      expect.arrayContaining([{ name: "expected", value: "r1" }]),
    );
  });
  it("rejects overwritten audit histories before contacting the database", async () => {
    const before = snapshot();
    const next = structuredClone(before.state);
    next.audit = [];
    await expect(commitDoctor(before, next)).rejects.toThrow("append-only");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects stale writes and duplicate canonical identities", async () => {
    mocks.execute.mockResolvedValueOnce({ columns: ["num_affected_rows"], rows: [["0"]] });
    const before = snapshot();
    await expect(commitDoctor(before, before.state)).rejects.toThrow("changed");
    mocks.execute.mockResolvedValueOnce({
      rows: [
        ["r1", "{}"],
        ["r2", "{}"],
      ],
    });
    await expect(readRecord("doctor", "doctor")).rejects.toThrow("not unique");
  });
});
