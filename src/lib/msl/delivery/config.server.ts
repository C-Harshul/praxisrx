import { z } from "zod";
import { createHash } from "node:crypto";
import type { DoctorState } from "../platform/types";
export const recipientSchema = z
  .object({
    doctor_id: z.string().uuid(),
    id: z.string().uuid(),
    email: z.string().email().max(254),
    version: z.string().min(1).max(100),
    verified_at: z.string().datetime(),
    authorized_at: z.string().datetime(),
    modes: z.array(z.enum(["test", "live"])).min(1),
  })
  .strict();
export type Recipient = z.infer<typeof recipientSchema>;
export const addressHash = (email: string) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
export function recipientMatches(state: DoctorState, recipient: Recipient | null) {
  const canonical = state.email_delivery?.recipient;
  return (
    !!recipient &&
    canonical?.status === "verified" &&
    canonical.id === recipient.id &&
    canonical.version === recipient.version &&
    canonical.email === recipient.email &&
    canonical.address_hash === addressHash(recipient.email) &&
    canonical.verified_at === recipient.verified_at &&
    canonical.authorized_at === recipient.authorized_at &&
    JSON.stringify(canonical.modes) === JSON.stringify(recipient.modes)
  );
}
export function recipients() {
  const rows = z
    .array(recipientSchema)
    .parse(JSON.parse(process.env["EMAIL_RECIPIENTS_JSON"] ?? "[]"));
  if (
    new Set(rows.map((r) => r.doctor_id)).size !== rows.length ||
    new Set(rows.map((r) => r.id)).size !== rows.length
  )
    throw new Error("recipient_registry_invalid");
  if (
    rows.some(
      (r) => Date.parse(r.verified_at) > Date.now() || Date.parse(r.authorized_at) > Date.now(),
    )
  )
    throw new Error("recipient_registry_invalid");
  return rows;
}
export function recipientFor(doctor: string) {
  return recipients().find((r) => r.doctor_id === doctor) ?? null;
}
export function emailMode(): "preview" | "test" | "live" {
  const value = process.env["EMAIL_MODE"] ?? "preview";
  return value === "live" || value === "test" ? value : "preview";
}
export function sendConfigured(recipient: Recipient | null) {
  const mode = emailMode();
  return (
    !!recipient &&
    mode !== "preview" &&
    recipient.modes.includes(mode) &&
    !recipient.email.toLowerCase().endsWith(".invalid") &&
    process.env["EMAIL_SEND_ENABLED"] === "true" &&
    [
      "GMAIL_CLIENT_ID",
      "GMAIL_CLIENT_SECRET",
      "GMAIL_REFRESH_TOKEN",
      "GMAIL_SENDER",
      "EMAIL_UNSUBSCRIBE_SECRET",
      "GMAIL_PUBSUB_TOPIC",
      "GMAIL_PUBSUB_SUBSCRIPTION",
      "GMAIL_PUBSUB_AUDIENCE",
      "GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL",
    ].every((key) => !!process.env[key]) &&
    (process.env["EMAIL_UNSUBSCRIBE_SECRET"]?.length ?? 0) >= 32 &&
    !!process.env["APP_ORIGIN"]?.startsWith("https://")
  );
}
export function emailOrigin() {
  const origin = new URL(process.env["APP_ORIGIN"] ?? "https://example.invalid");
  if (origin.protocol !== "https:") {
    if (emailMode() !== "preview") throw new Error("email_https_origin_required");
    return "https://example.invalid";
  }
  return origin.origin;
}
