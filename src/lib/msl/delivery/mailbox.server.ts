import { randomUUID } from "node:crypto";
import { databricksConfig, executeSql } from "@/integrations/databricks/sql.server";
import { readRecord } from "../platform/store.server";

export type MailboxEvent = {
  id: string;
  hash: string;
  history_id: string;
  at: number;
  status: "pending" | "processed" | "quarantined";
  error: string | null;
};
export type MailboxState = {
  conflicts?: { id: string; hash: string; at: number }[];
  page_token?: string | null;
  scan_event_id?: string | null;
  schema_version: "gmail-mailbox.v1";
  history_id: string | null;
  watch_expires_at: number | null;
  events: MailboxEvent[];
  reports: {
    id: string;
    hash: string;
    message_id: string;
    status: "unreviewed" | "reviewed";
    at: number;
  }[];
};
export const emptyMailbox = (): MailboxState => ({
  schema_version: "gmail-mailbox.v1",
  history_id: null,
  watch_expires_at: null,
  events: [],
  reports: [],
});
export async function updateMailbox<T>(fn: (state: MailboxState) => T) {
  const before = await readRecord<MailboxState>("email_mailbox", "gmail");
  if (!before || before.state.schema_version !== "gmail-mailbox.v1")
    throw new Error("gmail_mailbox_setup_required");
  const next = structuredClone(before.state);
  const result = fn(next);
  if (JSON.stringify(next) === JSON.stringify(before.state)) return result;
  if (
    (next.conflicts?.length ?? 0) > 100 ||
    next.events.length > 500 ||
    next.reports.length > 100 ||
    Buffer.byteLength(JSON.stringify(next)) > 1_000_000
  )
    throw new Error("gmail_mailbox_archival_required");
  const revision = randomUUID();
  const table = databricksConfig()
    .table.split(".")
    .map((s) => `\`${s}\``)
    .join(".");
  try {
    const response = await executeSql(
      `UPDATE ${table} SET revision=:next,payload=:payload,updated_at=current_timestamp() WHERE record_type='email_mailbox' AND id='gmail' AND revision=:expected`,
      [
        { name: "next", value: revision },
        { name: "payload", value: JSON.stringify(next) },
        { name: "expected", value: before.revision },
      ],
    );
    if (Number(response.rows[0]?.[response.columns.indexOf("num_affected_rows")]) !== 1)
      throw new Error("gmail_mailbox_conflict");
  } catch (error) {
    const current = await readRecord<MailboxState>("email_mailbox", "gmail");
    if (current?.revision !== revision) throw error;
  }
  return result;
}
