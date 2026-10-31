import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { hash } from "../newsletter/state.server";
import { updateMailbox } from "./mailbox.server";

/** Google-signed Pub/Sub OIDC token; the caller cannot select issuer keys or audience. */
export async function verifyPubSub(request: Request, fetcher: typeof fetch = fetch) {
  const audience = process.env["GMAIL_PUBSUB_AUDIENCE"];
  const email = process.env["GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL"];
  if (!audience || !email) throw new Error("pubsub_not_configured");
  const token = /^Bearer ([\w.-]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token || token.length > 10000) throw new Error("pubsub_signature_invalid");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("pubsub_signature_invalid");
  const [head, body, sig] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(head, "base64url").toString());
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  const now = Date.now() / 1000;
  if (
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) ||
    claims.aud !== audience ||
    claims.email !== email ||
    claims.email_verified !== true ||
    typeof claims.exp !== "number" ||
    claims.exp <= now ||
    typeof claims.iat !== "number" ||
    claims.iat > now + 60 ||
    claims.iat < now - 3600 ||
    claims.exp - claims.iat > 3700
  )
    throw new Error("pubsub_signature_invalid");
  const response = await fetcher("https://www.googleapis.com/oauth2/v3/certs", {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("pubsub_keys_unavailable");
  const keys = await response.json();
  const key = keys.keys?.find(
    (k: { kid: string; alg: string; kty: string; use: string }) =>
      k.kid === header.kid && k.alg === "RS256" && k.kty === "RSA" && k.use === "sig",
  );
  if (
    !key ||
    !verify(
      "RSA-SHA256",
      Buffer.from(`${head}.${body}`),
      createPublicKey({ key, format: "jwk" }),
      Buffer.from(sig, "base64url"),
    )
  )
    throw new Error("pubsub_signature_invalid");
}
const pushSchema = z.object({
  message: z.object({
    messageId: z.string().regex(/^[\w-]{1,200}$/),
    data: z.string().max(40000),
    publishTime: z.string().datetime().optional(),
  }),
  subscription: z.string(),
});
export async function receiveGmailPush(request: Request, fetcher: typeof fetch = fetch) {
  await verifyPubSub(request, fetcher);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 65536) throw new Error("pubsub_payload_too_large");
  const push = pushSchema.parse(JSON.parse(raw));
  if (push.subscription !== process.env["GMAIL_PUBSUB_SUBSCRIPTION"])
    throw new Error("pubsub_subscription_invalid");
  const notice = z
    .object({ emailAddress: z.string().email(), historyId: z.string().regex(/^\d+$/) })
    .strict()
    .parse(JSON.parse(Buffer.from(push.message.data, "base64").toString()));
  const digest = hash({ subscription: push.subscription, data: push.message.data });
  return updateMailbox((state) => {
    const existing = state.events.find((e) => e.id === push.message.messageId);
    if (existing) {
      if (existing.hash !== digest) {
        existing.status = "quarantined";
        existing.error = "pubsub_event_identity_conflict";
        state.conflicts ??= [];
        if (!state.conflicts.some((c) => c.id === existing.id && c.hash === digest))
          state.conflicts.push({ id: existing.id, hash: digest, at: Date.now() });
        return { status: "quarantined" };
      }
      return { status: "duplicate" };
    }
    const valid = notice.emailAddress.toLowerCase() === process.env["GMAIL_SENDER"]?.toLowerCase();
    state.events.push({
      id: push.message.messageId,
      hash: digest,
      history_id: notice.historyId,
      at: Date.now(),
      status: valid ? "pending" : "quarantined",
      error: valid ? null : "unexpected_mailbox",
    });
    return { status: valid ? "queued" : "quarantined" };
  });
}
