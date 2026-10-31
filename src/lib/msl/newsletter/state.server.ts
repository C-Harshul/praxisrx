import { randomUUID, createHash } from "node:crypto";
import { readRecord, commitDoctor, audit } from "../platform/store.server";
import type { DoctorState } from "../platform/types";
import type { NewsletterState } from "./types";
import type { DeliveryState } from "../delivery/types";

export const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex");
// UUID-shaped deterministic identifiers remain compatible with existing article/bookmark APIs.
export function stableId(value: string) {
  const h = hash(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function generation(state: DoctorState): NewsletterState {
  return (state.newsletter_jobs ??= { schema_version: "newsletter-jobs.v1", jobs: [] });
}
export function delivery(state: DoctorState): DeliveryState {
  return (state.email_delivery ??= {
    schema_version: "email-delivery.v1",
    subscription: {
      status: "unsubscribed",
      version: 1,
      updated_at: new Date().toISOString(),
      reason: null,
    },
    tasks: [],
  });
}

/** Recover ambiguous canonical writes by an operation receipt inside the atomic audit append. */
export async function changeDoctor<T>(
  id: string,
  action: string,
  fn: (state: DoctorState) => T,
): Promise<T> {
  const before = await readRecord<DoctorState>("doctor", id);
  if (!before || before.state.doctor.id !== id) throw new Error("doctor_unavailable");
  const next = structuredClone(before.state);
  const result = fn(next);
  if (JSON.stringify(next) === JSON.stringify(before.state)) return result;
  const receipt = randomUUID();
  audit(next, "newsletter-delivery", action, { operation_id: receipt });
  if (
    (next.newsletter_jobs?.jobs.length ?? 0) > 100 ||
    (next.email_delivery?.tasks.length ?? 0) > 100
  )
    throw new Error("newsletter_archival_required");
  try {
    await commitDoctor(before, next);
  } catch (error) {
    const current = await readRecord<DoctorState>("doctor", id);
    if (!current?.state.audit.some((e) => e.details["operation_id"] === receipt)) throw error;
  }
  return result;
}
