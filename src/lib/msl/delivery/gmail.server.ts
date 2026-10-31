import { z } from "zod";
import type { DeliveryTask } from "./types";
import type { Recipient } from "./config.server";

export class GmailError extends Error {
  constructor(
    public kind: "rejected" | "retry" | "unknown",
    public code: string,
  ) {
    super(code);
  }
}
function sender() {
  return z.string().email().parse(process.env["GMAIL_SENDER"]);
}
async function accessToken(fetcher: typeof fetch) {
  const fields = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"];
  if (fields.some((key) => !process.env[key]))
    throw new GmailError("rejected", "gmail_not_configured");
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env[fields[0]!]!,
      client_secret: process.env[fields[1]!]!,
      refresh_token: process.env[fields[2]!]!,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new GmailError("rejected", "gmail_oauth_unavailable");
  const data = await response.json();
  if (typeof data.access_token !== "string")
    throw new GmailError("rejected", "gmail_oauth_invalid");
  return data.access_token as string;
}
export async function gmailFetch(
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
) {
  if (!path.startsWith("/")) throw new Error("gmail_path_invalid");
  const token = await accessToken(fetcher);
  return fetcher(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
  });
}
const b64 = (value: string) =>
  Buffer.from(value)
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") ?? "";
/** Stable MIME: repeated reconciliation never changes Message-ID, date, recipient or bytes. */
export function gmailMime(task: DeliveryTask, recipient: Recipient) {
  const from = sender();
  if (task.recipient_id !== recipient.id || task.recipient_version !== recipient.version)
    throw new Error("gmail_recipient_changed");
  const boundary = `msl_${task.idempotency_key}`;
  const unsub = task.render.text.match(/Unsubscribe: (https:\/\/[^\s]+)/)?.[1];
  if (!unsub || /[\r\n]/.test(unsub)) throw new Error("gmail_unsubscribe_missing");
  return [
    `From: MSL Evidence Briefing <${from}>`,
    `To: ${recipient.email}`,
    `Subject: =?UTF-8?B?${Buffer.from(task.render.subject).toString("base64")}?=`,
    `Message-ID: ${task.message_id}`,
    `Date: ${new Date(task.created_at).toUTCString()}`,
    "MIME-Version: 1.0",
    `List-Unsubscribe: <${unsub}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(task.render.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(task.render.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
export async function sendGmail(
  task: DeliveryTask,
  recipient: Recipient,
  fetcher: typeof fetch = fetch,
  beforeSend: () => Promise<boolean> = async () => false,
) {
  // Configuration and mailbox ownership fail before a send request is attempted.
  const token = await accessToken(fetcher);
  const profile = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!profile.ok || (await profile.json()).emailAddress?.toLowerCase() !== sender().toLowerCase())
    throw new GmailError("rejected", "gmail_sender_unverified");
  const raw = Buffer.from(gmailMime(task, recipient)).toString("base64url");
  if (!(await beforeSend())) throw new GmailError("rejected", "final_authorization_changed");
  let response: Response;
  try {
    response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
  } catch {
    throw new GmailError("unknown", "gmail_send_outcome_unknown");
  }
  if (!response.ok) {
    if (response.status === 429) throw new GmailError("retry", "gmail_rate_limited");
    if ([400, 401, 403, 404].includes(response.status))
      throw new GmailError("rejected", `gmail_rejected_${response.status}`);
    throw new GmailError("unknown", "gmail_send_outcome_unknown");
  }
  try {
    const data = await response.json();
    if (typeof data.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(data.id)) throw new Error();
    return data.id as string;
  } catch {
    throw new GmailError("unknown", "gmail_send_outcome_unknown");
  }
}
/** Gmail has no idempotent send. Search can confirm a prior send; absence never authorizes replay. */
export async function reconcileGmail(task: DeliveryTask, fetcher: typeof fetch = fetch) {
  const query = `in:sent rfc822msgid:${task.message_id.replace(/[<>]/g, "")}`;
  const response = await gmailFetch(
    `/messages?maxResults=2&q=${encodeURIComponent(query)}`,
    {},
    fetcher,
  );
  if (!response.ok) return null;
  const data = await response.json();
  if (data.messages?.length !== 1 || typeof data.messages[0].id !== "string") return null;
  // Verify the returned message itself, rather than trusting search alone.
  const verify = await gmailFetch(
    `/messages/${encodeURIComponent(data.messages[0].id)}?format=metadata&metadataHeaders=Message-ID`,
    {},
    fetcher,
  );
  if (!verify.ok) return null;
  const message = await verify.json();
  if (
    !message.labelIds?.includes("SENT") ||
    !message.payload?.headers?.some(
      (h: { name: string; value: string }) =>
        h.name.toLowerCase() === "message-id" && h.value === task.message_id,
    )
  )
    return null;
  return message.id as string;
}
