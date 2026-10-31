import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { changeDoctor, delivery } from "../newsletter/state.server";
import { recipientFor, recipientMatches } from "./config.server";
import type { Recipient } from "./config.server";

function secret() {
  const value = process.env["EMAIL_UNSUBSCRIBE_SECRET"];
  if (!value || value.length < 32) throw new Error("unsubscribe_not_configured");
  return value;
}
const sign = (payload: string, key: string) =>
  createHmac("sha256", key).update(payload).digest("base64url");
export function unsubscribeToken(doctor: string, recipient: Recipient, at: number) {
  const data = Buffer.from(
    JSON.stringify({
      scope: "msl-unsubscribe.v1",
      doctor,
      recipient: recipient.id,
      version: recipient.version,
      exp: at + 366 * 86400_000,
    }),
  ).toString("base64url");
  return `${data}.${sign(data, secret())}`;
}
export function decodeUnsubscribe(token: string) {
  if (token.length > 2000) throw new Error("invalid_unsubscribe_token");
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("invalid_unsubscribe_token");
  const keys = [secret(), process.env["EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS"]].filter(
    (s): s is string => !!s,
  );
  if (
    !keys.some((key) => {
      const expected = Buffer.from(sign(payload, key));
      const actual = Buffer.from(signature);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    })
  )
    throw new Error("invalid_unsubscribe_token");
  const data = z
    .object({
      scope: z.literal("msl-unsubscribe.v1"),
      doctor: z.string().uuid(),
      recipient: z.string().uuid(),
      version: z.string(),
      exp: z.number(),
    })
    .strict()
    .parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
  if (data.exp < Date.now()) throw new Error("expired_unsubscribe_token");
  const recipient = recipientFor(data.doctor);
  if (!recipient || recipient.id !== data.recipient || recipient.version !== data.version)
    throw new Error("invalid_unsubscribe_recipient");
  return data;
}
export async function setSubscription(doctor: string, subscribed: boolean) {
  if (subscribed && !recipientFor(doctor)) throw new Error("verified_recipient_required");
  return changeDoctor(doctor, "email_subscription_changed", (state) => {
    const mail = delivery(state);
    if (subscribed && !recipientMatches(state, recipientFor(doctor)))
      throw new Error("published_verified_recipient_required");
    if (subscribed && mail.subscription.status === "suppressed")
      throw new Error("email_address_suppressed");
    if (!subscribed && mail.subscription.status === "suppressed") return mail.subscription;
    const status = subscribed ? "subscribed" : "unsubscribed";
    if (mail.subscription.status !== status)
      mail.subscription = {
        status,
        version: mail.subscription.version + 1,
        updated_at: new Date().toISOString(),
        reason: subscribed ? null : "doctor_unsubscribed",
      };
    if (!subscribed)
      for (const task of mail.tasks)
        if (["queued", "sending", "unknown", "held"].includes(task.status)) {
          task.status = "cancelled";
          task.error = "unsubscribed";
        }
    return mail.subscription;
  });
}
export async function unsubscribe(token: string) {
  const data = decodeUnsubscribe(token);
  await setSubscription(data.doctor, false);
}
