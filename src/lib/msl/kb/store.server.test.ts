import { beforeEach, describe, it, expect, vi } from "vitest";
import { hash, stable } from "./core";
import type { Pointer } from "./store.server";
const db = vi.hoisted(() => ({
  p: null as Pointer | null,
  rows: [] as (string | null)[][],
  failAfterWrite: false,
  loseCas: false,
  fenceChanged: false,
}));
vi.mock("@/integrations/databricks/sql.server", () => ({
  databricksConfig: () => ({ table: "workspace.msl_demo.app_state" }),
  executeSql: vi.fn(async (sql: string, params: { name: string; value: string }[] = []) => {
    const p = Object.fromEntries(params.map((p) => [p.name, p.value]));
    if (sql.startsWith("SELECT revision,payload"))
      return { rows: db.p ? [[db.p.revision, stable(db.p.state)]] : [], columns: [] };
    if (sql.startsWith("SELECT record_type")) return { rows: db.rows, columns: [] };
    if (sql.startsWith("UPDATE")) {
      if (!db.loseCas && db.p?.revision === p["expected"])
        db.p = { revision: p["revision"]!, state: JSON.parse(p["payload"]!) };
      if (db.failAfterWrite) throw new Error("ambiguous SQL timeout");
      return { rows: [["1"]], columns: ["num_affected_rows"] };
    }
    if (sql.startsWith("MERGE INTO workspace.msl_demo.kb_records")) {
      const input = JSON.parse(p["rows"]!);
      if (!db.fenceChanged)
        for (const r of input)
          if (
            !db.rows.some(
              (row) => row[0] === r.record_type && row[1] === r.id && row[2] === r.version,
            )
          )
            db.rows.push([r.record_type, r.id, r.version, r.content_hash, r.payload]);
      if (db.failAfterWrite) throw new Error("ambiguous SQL timeout");
      return { rows: [], columns: [] };
    }
    if (sql.startsWith("SELECT t.record_type"))
      return { rows: db.rows.map((r) => r.slice(0, 4)), columns: [] };
    throw new Error("Unexpected fixture SQL");
  }),
}));
import { readRecords, commitPointer, insertRecords, withKBWrite } from "./store.server";
beforeEach(() => {
  db.rows = [];
  db.p = {
    revision: "initial",
    state: {
      version: "empty",
      payload: { schema_version: "matching-kb.v1", items: [] },
      published: true,
      audit: [],
    },
  };
  db.failAfterWrite = false;
  db.loseCas = false;
  db.fenceChanged = false;
});
describe("canonical KB transport acknowledgments", () => {
  it("recovers an ambiguous pointer response only after exact canonical readback", async () => {
    const expected = structuredClone(db.p!);
    db.failAfterWrite = true;
    const ack = await commitPointer({ ...expected.state, version: "new" }, expected);
    expect(ack.state.version).toBe("new");
  });
  it("rejects a lost CAS without changing previous release content", async () => {
    db.loseCas = true;
    await expect(commitPointer({ ...db.p!.state, version: "new" }, db.p)).rejects.toThrow(
      "changed",
    );
    expect(db.p!.state.version).toBe("empty");
  });
  it("recovers duplicate or ambiguous immutable writes and rejects missing acknowledgments", async () => {
    const payload = { id: "unit-test-review" };
    const row = { kind: "review", id: "unit-test-review", version: hash(payload), payload };
    db.failAfterWrite = true;
    await insertRecords([row], db.p!);
    await insertRecords([row], db.p!);
    expect(db.rows).toHaveLength(1);
    db.rows = [];
    db.fenceChanged = true;
    await expect(insertRecords([row], db.p!)).rejects.toThrow("unconfirmed");
  });
  it("rejects corrupt/duplicate canonical rows and never substitutes a fixture", async () => {
    db.rows = [["claim", "c", "v", "wrong", stable({ id: "c" })]];
    await expect(readRecords()).rejects.toThrow("hash");
    const payload = { id: "c" };
    db.rows = [
      ["claim", "c", "v", hash(payload), stable(payload)],
      ["claim", "c", "v", hash(payload), stable(payload)],
    ];
    await expect(readRecords()).rejects.toThrow("uniqueness");
  });
  it("fences concurrent writers and clears its own failed lease without losing the release", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = withKBWrite(async () => {
      await pending;
      return "saved";
    });
    await vi.waitFor(() => expect(db.p!.state.kb_write_lock).toBeTruthy());
    await expect(withKBWrite(async () => null)).rejects.toThrow("in progress");
    finish();
    expect(await first).toBe("saved");
    expect(db.p!.state.kb_write_lock).toBeNull();
    expect(db.p!.state.version).toBe("empty");
  });
});
