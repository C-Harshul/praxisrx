import { readRecord } from "../platform/store.server";
import type { MailboxState } from "./mailbox.server";
import { updateMailbox } from "./mailbox.server";
import { gmailFetch } from "./gmail.server";
export async function renewGmailWatch() {
  const topic = process.env["GMAIL_PUBSUB_TOPIC"];
  if (!topic) return;
  if (!/^projects\/[\w-]+\/topics\/[\w.-]+$/.test(topic)) throw new Error("gmail_topic_invalid");
  const mailbox = await readRecord<MailboxState>("email_mailbox", "gmail");
  if (!mailbox || (mailbox.state.watch_expires_at ?? 0) > Date.now() + 86400_000) return;
  const profile = await gmailFetch("/profile");
  if (
    !profile.ok ||
    (await profile.json()).emailAddress?.toLowerCase() !==
      process.env["GMAIL_SENDER"]?.toLowerCase()
  )
    throw new Error("gmail_sender_unverified");
  const response = await gmailFetch("/watch", {
    method: "POST",
    body: JSON.stringify({ topicName: topic }),
  });
  if (!response.ok) throw new Error("gmail_watch_renewal_failed");
  const result = await response.json();
  if (!/^\d+$/.test(result.historyId) || !Number.isFinite(Number(result.expiration)))
    throw new Error("gmail_watch_response_invalid");
  await updateMailbox((state) => {
    state.history_id ??= result.historyId;
    state.watch_expires_at = Number(result.expiration);
  });
}
