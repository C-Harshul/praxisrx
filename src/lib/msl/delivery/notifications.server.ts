import { readRecord, listRecords } from "../platform/store.server";
import type { DoctorState } from "../platform/types";
import { gmailFetch } from "./gmail.server";
import { updateMailbox } from "./mailbox.server";
import type { MailboxState } from "./mailbox.server";
import { hash, changeDoctor, delivery } from "../newsletter/state.server";
import { recipientFor } from "./config.server";
import { renewGmailWatch } from "./watch.server";

/** Notifications signal mailbox changes, not recipient delivery. DSNs are quarantined for review. */
export async function runGmailNotificationJob() {
  await renewGmailWatch();
  const mailbox = await readRecord<MailboxState>("email_mailbox", "gmail");
  if (!mailbox) return { status: "setup_required" };
  const event = mailbox.state.events.find(
    (e) =>
      e.status === "pending" &&
      (!mailbox.state.scan_event_id || e.id === mailbox.state.scan_event_id),
  );
  if (!event) return { status: "idle" };
  if (!mailbox.state.history_id) {
    await updateMailbox((state) => {
      const e = state.events.find((e) => e.id === event.id)!;
      e.status = "quarantined";
      e.error = "gmail_watch_checkpoint_required";
    });
    return { status: "quarantined" };
  }
  const response = await gmailFetch(
    `/history?startHistoryId=${encodeURIComponent(mailbox.state.history_id)}&historyTypes=messageAdded&maxResults=100${mailbox.state.page_token ? `&pageToken=${encodeURIComponent(mailbox.state.page_token)}` : ""}`,
  );
  if (!response.ok) {
    await updateMailbox((state) => {
      const e = state.events.find((e) => e.id === event.id)!;
      e.status = "quarantined";
      e.error =
        response.status === 404
          ? "gmail_history_expired_resync_required"
          : "gmail_history_unavailable";
    });
    return { status: "quarantined" };
  }
  const result = await response.json();
  const ids = [
    ...new Set<string>(
      (result.history ?? []).flatMap((h: { messagesAdded?: { message: { id: string } }[] }) =>
        (h.messagesAdded ?? []).map((m) => m.message.id),
      ),
    ),
  ];
  for (const id of ids) {
    const item = await gmailFetch(
      `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Content-Type&metadataHeaders=Auto-Submitted`,
    );
    if (!item.ok) throw new Error("gmail_report_read_failed");
    const message = await item.json();
    const report = message.payload?.headers?.some(
      (h: { name: string; value: string }) =>
        h.name.toLowerCase() === "content-type" &&
        /multipart\/report|message\/delivery-status/i.test(h.value),
    );
    if (report) {
      await updateMailbox((state) => {
        if (!state.reports.some((r) => r.message_id === id))
          state.reports.push({
            id: `gmail-report-${id}`,
            hash: hash({ id, thread: message.threadId }),
            message_id: id,
            status: "unreviewed",
            at: Date.now(),
          });
      });
      const rawResponse = await gmailFetch(`/messages/${encodeURIComponent(id)}?format=raw`);
      if (!rawResponse.ok) throw new Error("gmail_report_read_failed");
      const rawData = await rawResponse.json();
      if (typeof rawData.raw !== "string" || rawData.raw.length > 700000) continue;
      const raw = Buffer.from(rawData.raw, "base64url").toString();
      // A report is not trusted outcome evidence. Correlation only triggers a conservative hold.
      const doctors = await listRecords<DoctorState>("doctor");
      for (const doctor of doctors) {
        const recipient = recipientFor(doctor.id);
        if (!recipient || !raw.toLowerCase().includes(recipient.email.toLowerCase())) continue;
        const related =
          doctor.state.email_delivery?.tasks.filter(
            (t) => t.provider_id && raw.includes(t.message_id),
          ) ?? [];
        if (!related.length) continue;
        await changeDoctor(doctor.id, "email_report_pending_review", (state) => {
          const mail = delivery(state);
          if (mail.subscription.status !== "suppressed")
            mail.subscription = {
              status: "suppressed",
              version: mail.subscription.version + 1,
              updated_at: new Date().toISOString(),
              reason: "delivery_report_pending_review",
            };
          for (const task of mail.tasks)
            if (["queued", "sending", "unknown"].includes(task.status)) {
              task.status = "held";
              task.error = "delivery_report_pending_review";
            }
        });
      }
    }
  }
  await updateMailbox((state) => {
    const e = state.events.find((e) => e.id === event.id)!;
    if (
      e.status !== "pending" ||
      state.history_id !== mailbox.state.history_id ||
      (state.page_token ?? null) !== (mailbox.state.page_token ?? null)
    )
      return;
    if (result.nextPageToken) {
      state.page_token = String(result.nextPageToken);
      state.scan_event_id = event.id;
      return;
    }
    e.status = "processed";
    e.error = null;
    state.page_token = null;
    state.scan_event_id = null;
    const next = String(result.historyId ?? event.history_id);
    if (/^\d+$/.test(next) && (!state.history_id || BigInt(next) > BigInt(state.history_id)))
      state.history_id = next;
  });
  return { status: result.nextPageToken ? "scanning" : "processed" };
}
