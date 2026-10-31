import { readRecord } from "../platform/store.server";
import type { DoctorState } from "../platform/types";
import { changeDoctor, generation, delivery } from "./state.server";
import { safeToRetry } from "../delivery/retry";
import {
  recipientFor,
  recipientMatches,
  emailMode,
  sendConfigured,
} from "../delivery/config.server";
import { setSubscription } from "../delivery/subscription.server";
import { z } from "zod";

export async function newsletterRead(doctor: string) {
  const record = await readRecord<DoctorState>("doctor", doctor);
  if (!record) throw new Error("doctor_unavailable");
  const state = record.state;
  const recipient = recipientFor(doctor);
  return {
    subscription: state.email_delivery?.subscription ?? {
      status: "unsubscribed",
      version: 0,
      reason: null,
    },
    recipient_verified: recipientMatches(state, recipient),
    recipient_label:
      recipientMatches(state, recipient) && recipient
        ? `${recipient.email.slice(0, 1)}…@${recipient.email.split("@")[1]}`
        : null,
    mode: emailMode(),
    send_configured: recipientMatches(state, recipient) && sendConfigured(recipient),
    frequency: state.doctor.frequency ?? "Weekly",
    timezone: "UTC",
    canonical_document_bytes: Buffer.byteLength(JSON.stringify(state)),
    jobs: (state.newsletter_jobs?.jobs ?? [])
      .map((j) => ({ id: j.id, status: j.status, error: j.error, created_at: j.created_at }))
      .slice(-10)
      .reverse(),
    delivery: (state.email_delivery?.tasks ?? [])
      .map((t) => ({
        id: t.id,
        retry_allowed: safeToRetry(t),
        newsletter_id: t.newsletter_id,
        status: t.status,
        error: t.error,
        attempts: t.attempts.length,
      }))
      .slice(-10)
      .reverse(),
    previews: (state.newsletter_jobs?.jobs ?? [])
      .filter((j) => j.status === "preview")
      .map((j) => {
        const task = state.email_delivery?.tasks.find(
          (t) => t.generation_id === j.id && t.status === "preview",
        );
        return {
          id: j.id,
          title: j.result?.title ?? "Preview",
          text: task?.render.text ?? "Preview unavailable",
        };
      })
      .slice(-3),
    waiting: !state.matching_runs.length
      ? "Waiting for a current confirmed profile and reviewed matching result."
      : null,
  };
}
export async function newsletterWrite(doctor: string, action: string, raw: unknown) {
  if (action === "email_retry") {
    const input = z
      .object({ id: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(raw);
    return changeDoctor(doctor, "email_retry_requested", (state) => {
      const mail = delivery(state),
        recipient = recipientFor(doctor);
      const task = mail.tasks.find((t) => t.id === input.id);
      if (
        !task ||
        !safeToRetry(task) ||
        mail.subscription.status !== "subscribed" ||
        !recipientMatches(state, recipient) ||
        !sendConfigured(recipient)
      )
        throw new Error("email_retry_not_safe");
      task.status = "queued";
      task.next_attempt_at = Date.now();
      task.error = null;
      return null;
    });
  }
  if (action === "email_subscription")
    return setSubscription(
      doctor,
      z.object({ subscribed: z.boolean() }).strict().parse(raw).subscribed,
    );
  if (action === "newsletter_retry") {
    const input = z.object({ id: z.string().uuid() }).strict().parse(raw);
    return changeDoctor(doctor, "newsletter_retry_requested", (state) => {
      const job = generation(state).jobs.find((j) => j.id === input.id);
      if (!job || !["failed", "preview"].includes(job.status))
        throw new Error("newsletter_retry_unavailable");
      if (job.status === "failed") throw new Error("newsletter_draft_attempts_exhausted");
      if (!sendConfigured(recipientFor(doctor)) || !recipientMatches(state, recipientFor(doctor)))
        throw new Error("newsletter_send_configuration_required");
      job.status = "retry";
      job.next_attempt_at = 0;
      return null;
    });
  }
  throw new Error("newsletter_action_invalid");
}
