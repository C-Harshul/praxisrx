import { randomUUID } from "node:crypto";
import { listRecords, readRecord } from "../platform/store.server";
import type { DoctorState } from "../platform/types";
import { changeDoctor, delivery, hash } from "../newsletter/state.server";
import type { PublishedNewsletter } from "../newsletter/types";
import { newsletterStillValid } from "../newsletter/context.server";
import { recipientFor, recipientMatches, sendConfigured } from "./config.server";
import { sendGmail, reconcileGmail, GmailError } from "./gmail.server";
import type { MailboxState } from "./mailbox.server";
const backoff = [60_000, 300_000, 1800_000, 7200_000];

export async function runDeliveryJob() {
  const records = await listRecords<DoctorState>("doctor");
  const candidate = records.find(({ state }) =>
    state.email_delivery?.tasks.some(
      (t) =>
        (t.status === "queued" && t.next_attempt_at <= Date.now()) ||
        (t.status === "sending" && t.lease_until <= Date.now()) ||
        (t.status === "unknown" && t.reconciliation_count < 5 && t.next_attempt_at <= Date.now()),
    ),
  );
  if (!candidate) return { status: "idle" };
  const task = candidate.state.email_delivery!.tasks.find(
    (t) =>
      (t.status === "queued" && t.next_attempt_at <= Date.now()) ||
      (t.status === "sending" && t.lease_until <= Date.now()) ||
      (t.status === "unknown" && t.reconciliation_count < 5 && t.next_attempt_at <= Date.now()),
  )!;
  if (task.status === "sending") {
    await changeDoctor(candidate.id, "email_abandoned_send", (state) => {
      const current = delivery(state).tasks.find((t) => t.id === task.id)!;
      if (current.status === "sending" && current.lease_until <= Date.now()) {
        current.status = "unknown";
        current.error = "abandoned_send_requires_reconciliation";
        const attempt = current.attempts.at(-1);
        if (attempt) {
          attempt.outcome = "unknown";
          attempt.error = current.error;
        }
        current.next_attempt_at = Date.now();
      }
    });
    return { status: "unknown" };
  }
  if (task.status === "unknown") {
    const recipient = recipientFor(candidate.id);
    if (!sendConfigured(recipient)) return { status: "held" };
    let providerId: string | null = null;
    try {
      providerId = await reconcileGmail(task);
    } catch {
      /* No inference from unavailable mailbox. */
    }
    const status = await changeDoctor(candidate.id, "email_reconciliation", (state) => {
      const current = delivery(state).tasks.find((t) => t.id === task.id)!;
      if (current.status !== "unknown") return current.status;
      current.reconciliation_count++;
      current.next_attempt_at = Date.now() + 3600_000;
      if (providerId) {
        current.provider_id = providerId;
        current.status = "provider-accepted";
        current.error = null;
      }
      // No result is NOT proof that the message was unsent; never requeue automatically.
      return current.status;
    });
    return { status };
  }
  const recipient = recipientFor(candidate.id);
  const mailbox = await readRecord<MailboxState>("email_mailbox", "gmail");
  const notificationsReady =
    mailbox?.state.schema_version === "gmail-mailbox.v1" &&
    (mailbox.state.watch_expires_at ?? 0) > Date.now();
  const fingerprintValid =
    !!recipient &&
    task.recipient_fingerprint === hash([recipient.id, recipient.version, recipient.email]) &&
    task.sender_fingerprint === hash(process.env["GMAIL_SENDER"]?.toLowerCase());
  const newsletter = candidate.state.newsletters.find((n) => n.id === task.newsletter_id) as
    PublishedNewsletter | undefined;
  const valid = !!newsletter && (await newsletterStillValid(candidate.state, newsletter));
  const lease = randomUUID();
  const claimed = await changeDoctor(candidate.id, "email_claim", (state) => {
    const mail = delivery(state);
    const current = mail.tasks.find((t) => t.id === task.id)!;
    if (current.status !== "queued" || current.next_attempt_at > Date.now()) return false;
    if (!notificationsReady) {
      current.status = "held";
      current.error = "gmail_notification_setup_required";
      return false;
    }
    if (
      mail.tasks.some(
        (t) => t.id !== current.id && t.status === "sending" && t.lease_until > Date.now(),
      )
    )
      return false;
    if (!valid || hash(current.render) !== current.render_hash) {
      current.status = "held";
      current.error = "newsletter_invalid";
      return false;
    }
    if (
      !recipientMatches(state, recipient) ||
      !fingerprintValid ||
      !sendConfigured(recipient) ||
      recipient!.id !== current.recipient_id ||
      recipient!.version !== current.recipient_version
    ) {
      current.status = "held";
      current.error = "recipient_or_provider_unavailable";
      return false;
    }
    if (mail.subscription.status !== "subscribed") {
      current.status = "cancelled";
      current.error = "unsubscribed";
      return false;
    }
    if (!current.attempts.length) {
      const previous = mail.tasks.filter((t) => t.id !== current.id && t.provider_id);
      const lastAccepted = Math.max(
        0,
        ...previous.map((t) =>
          Math.max(t.created_at, ...t.attempts.filter((a) => a.provider_id).map((a) => a.at)),
        ),
      );
      const days = state.doctor.frequency === "Every two weeks" ? 14 : 7;
      current.send_not_before = Math.max(
        current.send_not_before ?? current.created_at,
        lastAccepted ? lastAccepted + days * 86400_000 : current.created_at,
      );
      if (current.send_not_before > Date.now()) {
        current.next_attempt_at = current.send_not_before;
        return false;
      }
    }
    if (
      current.attempts.length >= 5 ||
      Date.now() - (current.send_not_before ?? current.created_at) > 86400_000
    ) {
      current.status = "failed";
      current.error = "email_retry_limit";
      return false;
    }
    current.status = "sending";
    current.lease = lease;
    current.lease_until = Date.now() + 5 * 60_000;
    current.attempts.push({
      id: randomUUID(),
      at: Date.now(),
      outcome: "sending",
      error: null,
      provider_id: null,
      subscription_version: mail.subscription.version,
      recipient_version: recipient!.version,
    });
    return true;
  });
  if (!claimed) return { status: "held" };
  // This read is after the durable lease and immediately before any external provider call.
  const final = await readRecord<DoctorState>("doctor", candidate.id);
  const current = final?.state.email_delivery?.tasks.find((t) => t.id === task.id);
  const authorized =
    !!final &&
    current?.status === "sending" &&
    current.lease === lease &&
    final.state.email_delivery?.subscription.status === "subscribed" &&
    recipientFor(candidate.id)?.version === recipient!.version &&
    sendConfigured(recipientFor(candidate.id)) &&
    recipientMatches(final.state, recipientFor(candidate.id)) &&
    (await newsletterStillValid(final.state, newsletter!));
  if (!authorized) {
    await changeDoctor(candidate.id, "email_final_check_cancelled", (state) => {
      const t = delivery(state).tasks.find((t) => t.id === task.id)!;
      if (t.lease === lease && t.status === "sending") {
        t.status = "cancelled";
        t.error = "final_authorization_changed";
      }
    });
    return { status: "cancelled" };
  }
  let providerId: string | null = null;
  let failure: GmailError | null = null;
  try {
    providerId = await sendGmail(current!, recipient!, fetch, async () => {
      const record = await readRecord<DoctorState>("doctor", candidate.id);
      const mail = record?.state.email_delivery;
      const pending = mail?.tasks.find((t) => t.id === task.id);
      const address = recipientFor(candidate.id);
      const inbox = await readRecord<MailboxState>("email_mailbox", "gmail");
      return (
        !!record &&
        pending?.status === "sending" &&
        pending.lease === lease &&
        pending.lease_until > Date.now() &&
        inbox?.state.schema_version === "gmail-mailbox.v1" &&
        (inbox.state.watch_expires_at ?? 0) > Date.now() &&
        mail?.subscription.status === "subscribed" &&
        recipientMatches(record.state, address) &&
        sendConfigured(address) &&
        pending.recipient_fingerprint === hash([address?.id, address?.version, address?.email]) &&
        pending.sender_fingerprint === hash(process.env["GMAIL_SENDER"]?.toLowerCase()) &&
        (await newsletterStillValid(record.state, newsletter!))
      );
    });
  } catch (error) {
    failure =
      error instanceof GmailError ? error : new GmailError("unknown", "gmail_send_outcome_unknown");
  }
  const status = await changeDoctor(candidate.id, "email_provider_outcome", (state) => {
    const t = delivery(state).tasks.find((t) => t.id === task.id)!;
    if (t.lease !== lease) return t.status;
    const attempt = t.attempts.at(-1)!;
    const result =
      failure?.code === "final_authorization_changed"
        ? "cancelled"
        : providerId
          ? "provider-accepted"
          : failure!.kind === "unknown"
            ? "unknown"
            : failure!.kind === "retry" && t.attempts.length < 5
              ? "queued"
              : "failed";
    // Preserve a webhook's terminal outcome or an immediate unsubscribe, but record the provider response.
    attempt.outcome = result;
    attempt.error = failure?.code ?? null;
    attempt.provider_id = providerId;
    if (providerId) t.provider_id = providerId;
    if (t.status === "sending") {
      t.status = result;
      t.error = failure?.code ?? null;
      t.next_attempt_at = Date.now() + (backoff[t.attempts.length - 1] ?? 3600_000);
    }
    return t.status;
  });
  return { status };
}
