import { randomUUID } from "node:crypto";
import { databricksConfig, executeSql } from "@/integrations/databricks/sql.server";
import type { DoctorState, RecordSnapshot } from "./types";
const table = () =>
  databricksConfig()
    .table.split(".")
    .map((s) => `\`${s}\``)
    .join(".");

/** Records are provisioned once by a trusted single writer, never on a browser request. */
export async function readRecord<T>(kind: string, id: string): Promise<RecordSnapshot<T> | null> {
  const result = await executeSql(
    `SELECT revision, payload FROM ${table()} WHERE record_type = :kind AND id = :id LIMIT 2`,
    [
      { name: "kind", value: kind },
      { name: "id", value: id },
    ],
  );
  if (result.rows.length > 1)
    throw new Error("Canonical ID is not unique. Administrative repair required.");
  const row = result.rows[0];
  return row ? { id, revision: row[0]!, state: JSON.parse(row[1]!) as T } : null;
}
export async function listRecords<T>(kind: string): Promise<RecordSnapshot<T>[]> {
  const result = await executeSql(
    `SELECT id, revision, payload FROM ${table()} WHERE record_type = :kind ORDER BY id LIMIT 999`,
    [{ name: "kind", value: kind }],
  );
  if (
    result.rows.length >= 999 ||
    new Set(result.rows.map((r) => r[0])).size !== result.rows.length
  )
    throw new Error("Canonical directory exceeds the demo contract or contains duplicate IDs.");
  return result.rows.map((r) => ({ id: r[0]!, revision: r[1]!, state: JSON.parse(r[2]!) as T }));
}

/** Single-row Delta compare-and-swap; audit and state commit together in the same payload. */
export async function commitDoctor(
  snapshot: RecordSnapshot<DoctorState>,
  next: DoctorState,
): Promise<string> {
  if (next.doctor.id !== snapshot.id || next.schema_version !== "msl-app-state.v1")
    throw new Error("Invalid canonical doctor state.");
  if (
    next.audit.length < snapshot.state.audit.length ||
    JSON.stringify(next.audit.slice(0, snapshot.state.audit.length)) !==
      JSON.stringify(snapshot.state.audit)
  )
    throw new Error("Audit history is append-only.");
  const revision = randomUUID();
  const payload = JSON.stringify(next);
  if (Buffer.byteLength(payload) > 2_000_000)
    throw new Error("Canonical doctor document requires archival before more writes.");
  const result = await executeSql(
    `UPDATE ${table()} SET revision = :next, payload = :payload, updated_at = current_timestamp()
    WHERE record_type = 'doctor' AND id = :id AND revision = :expected`,
    [
      { name: "next", value: revision },
      { name: "payload", value: payload },
      { name: "id", value: snapshot.id },
      { name: "expected", value: snapshot.revision },
    ],
  );
  const affectedIndex = result.columns.indexOf("num_affected_rows");
  if (affectedIndex < 0 || Number(result.rows[0]?.[affectedIndex]) !== 1)
    throw new Error("Canonical data changed. Refresh before retrying.");
  return revision;
}
export async function mutateDoctor<T>(id: string, mutate: (next: DoctorState) => T) {
  const snapshot = await readRecord<DoctorState>("doctor", id);
  if (!snapshot || snapshot.state.schema_version !== "msl-app-state.v1")
    throw new Error("Doctor is not provisioned in Databricks.");
  const next = structuredClone(snapshot.state);
  const result = mutate(next);
  await commitDoctor(snapshot, next);
  return result;
}
export function audit(
  state: DoctorState,
  actor: string,
  action: string,
  details: Record<string, unknown> = {},
) {
  state.audit.push({
    id: randomUUID(),
    actor,
    action,
    created_at: new Date().toISOString(),
    details,
  });
}
