import { randomUUID } from "node:crypto";
import { z } from "zod";
import { executeSql, databricksConfig } from "@/integrations/databricks/sql.server";
import { hash, stable, invalidationSchema } from "./core";
export class KBError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
    this.name = "KBError";
  }
}
export const kbTable = () => {
  const namespace = process.env["KB_NAMESPACE"] ?? "workspace.msl_demo";
  if (!/^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(namespace))
    throw new KBError("Invalid KB configuration.", 503);
  return `${namespace}.kb_records`;
};
const stateSchema = z
  .object({
    version: z.string(),
    published: z.boolean(),
    payload: z.unknown(),
    manifest: z.object({ payload_hash: z.string() }).passthrough().optional(),
    audit: z.array(z.unknown()).default([]),
    invalidations: z.array(invalidationSchema).optional(),
    kb_write_lock: z.object({ id: z.string(), expires_at: z.number() }).nullable().optional(),
  })
  .passthrough();
export type Pointer = { revision: string; state: z.infer<typeof stateSchema> };
export type RecordValue = { kind: string; id: string; version: string; payload: unknown };
export async function readPointer(): Promise<Pointer | null> {
  const result = await executeSql(
    `SELECT revision,payload FROM ${databricksConfig().table} WHERE record_type='kb_release' AND id='published' LIMIT 2`,
  );
  if (result.rows.length > 1) throw new KBError("Duplicate canonical release pointer.", 503);
  const row = result.rows[0];
  return row ? { revision: row[0]!, state: stateSchema.parse(JSON.parse(row[1]!)) } : null;
}
export async function readRecords(): Promise<RecordValue[]> {
  const result = await executeSql(
    `SELECT record_type,id,version,content_hash,payload FROM ${kbTable()} ORDER BY record_type,id,version LIMIT 999`,
  );
  if (result.rows.length >= 999)
    throw new KBError(
      "KB scan limit reached; an administrator must paginate before expansion.",
      503,
    );
  const seen = new Set<string>();
  return result.rows.map((row) => {
    const key = stable(row.slice(0, 3));
    const payload = JSON.parse(row[4]!);
    if (seen.has(key) || hash(payload) !== row[3])
      throw new KBError("Canonical KB uniqueness or content hash failed.", 503);
    seen.add(key);
    return { kind: row[0]!, id: row[1]!, version: row[2]!, payload };
  });
}
export async function commitPointer(next: Pointer["state"], expected: Pointer | null) {
  if (
    expected &&
    stable(next.audit.slice(0, expected.state.audit.length)) !== stable(expected.state.audit)
  )
    throw new KBError("Publication audit is append-only.");
  const revision = randomUUID(),
    params = [
      { name: "revision", value: revision },
      { name: "payload", value: stable(next) },
    ];
  if (Buffer.byteLength(stable(next)) > 2_000_000)
    throw new KBError("KB pointer requires archival before more writes.", 503);
  let writeError: unknown;
  try {
    if (expected)
      await executeSql(
        `UPDATE ${databricksConfig().table} SET revision=:revision,payload=:payload,updated_at=current_timestamp() WHERE record_type='kb_release' AND id='published' AND revision=:expected`,
        [...params, { name: "expected", value: expected.revision }],
      );
    else
      await executeSql(
        `MERGE INTO ${databricksConfig().table} t USING (SELECT 'published' AS id) s ON t.record_type='kb_release' AND t.id=s.id WHEN NOT MATCHED THEN INSERT (record_type,id,revision,payload,updated_at) VALUES ('kb_release','published',:revision,:payload,current_timestamp())`,
        params,
      );
  } catch (e) {
    writeError = e;
  }
  // A timed-out statement may already have committed. Only exact canonical readback is success.
  let ack: Pointer | null;
  try {
    ack = await readPointer();
  } catch {
    throw new KBError("Publication unconfirmed. Retry with the same request identity.", 503);
  }
  if (ack?.revision === revision && stable(ack.state) === stable(next)) return ack;
  throw new KBError(
    writeError
      ? "Publication unconfirmed. Retry with the same request identity."
      : "Canonical KB changed. Refresh before retrying.",
    writeError ? 503 : 409,
  );
}
const immutableSource = `SELECT col.* FROM (SELECT explode(from_json(:rows,'ARRAY<STRUCT<record_type:STRING,id:STRING,version:STRING,content_hash:STRING,payload:STRING>>')) AS col)`;
export function immutableWriteStatement(fence = false) {
  const source = immutableSource;
  return `MERGE INTO ${kbTable()} t USING (${source}${fence ? ` WHERE EXISTS (SELECT 1 FROM ${databricksConfig().table} WHERE record_type='kb_release' AND id='published' AND revision=:fence)` : ""}) s ON t.record_type=s.record_type AND t.id=s.id AND t.version=s.version WHEN NOT MATCHED THEN INSERT (record_type,id,version,content_hash,payload,created_at) VALUES (s.record_type,s.id,s.version,s.content_hash,s.payload,current_timestamp())`;
}
export async function insertRecords(values: RecordValue[], fence?: Pointer) {
  const rows = values.map((v) => ({
    record_type: v.kind,
    id: v.id,
    version: v.version,
    content_hash: hash(v.payload),
    payload: stable(v.payload),
  }));
  if (new Set(rows.map((r) => stable([r.record_type, r.id, r.version]))).size !== rows.length)
    throw new KBError("Duplicate ingestion keys.");
  const parameters = [
    { name: "rows", value: JSON.stringify(rows) },
    ...(fence ? [{ name: "fence", value: fence.revision }] : []),
  ];
  const source = immutableSource;
  let writeError: unknown;
  try {
    await executeSql(immutableWriteStatement(!!fence), parameters);
  } catch (e) {
    writeError = e;
  }
  const checked = await executeSql(
    `SELECT t.record_type,t.id,t.version,t.content_hash FROM ${kbTable()} t INNER JOIN (${source}) s ON t.record_type=s.record_type AND t.id=s.id AND t.version=s.version`,
    [{ name: "rows", value: JSON.stringify(rows) }],
  );
  if (
    checked.rows.length !== rows.length ||
    rows.some(
      (v) =>
        !checked.rows.some(
          (r) =>
            r[0] === v.record_type &&
            r[1] === v.id &&
            r[2] === v.version &&
            r[3] === v.content_hash,
        ),
    )
  )
    throw new KBError(
      writeError
        ? "Canonical write unconfirmed. Retry with the same request identity."
        : "Canonical write not acknowledged; refresh and retry.",
      503,
    );
}
/** All UI and CLI KB writers share this persisted pointer CAS lease. No in-memory authority. */
export async function withKBWrite<T>(
  work: (locked: Pointer, original: Pointer) => Promise<T>,
): Promise<T> {
  const original = await readPointer();
  if (!original) throw new KBError("Canonical release pointer is not provisioned.", 503);
  if (original.state.kb_write_lock && original.state.kb_write_lock.expires_at > Date.now())
    throw new KBError("Another KB write is in progress. Refresh and retry.");
  const lock = { id: randomUUID(), expires_at: Date.now() + 10 * 60_000 };
  const locked = await commitPointer({ ...original.state, kb_write_lock: lock }, original);
  try {
    return await work(locked, original);
  } finally {
    // Never clear another writer's lock or overwrite a successful publication.
    try {
      const p = await readPointer();
      if (p?.revision === locked.revision && p.state.kb_write_lock?.id === lock.id)
        await commitPointer({ ...p.state, kb_write_lock: null }, p);
    } catch {
      /* unconfirmed writes stay fenced until refresh/lease expiry */
    }
  }
}
