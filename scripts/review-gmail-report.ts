import { readFile } from "node:fs/promises";
import { z } from "zod";
import { readRecord } from "../src/lib/msl/platform/store.server";
import type { DoctorState } from "../src/lib/msl/platform/types";
import type { MailboxState } from "../src/lib/msl/delivery/mailbox.server";
import { updateMailbox } from "../src/lib/msl/delivery/mailbox.server";
import { gmailFetch } from "../src/lib/msl/delivery/gmail.server";
import { recipientFor } from "../src/lib/msl/delivery/config.server";
import { recordReviewedDeliveryEvidence } from "../src/lib/msl/delivery/events.server";
import { hash, changeDoctor, delivery } from "../src/lib/msl/newsletter/state.server";

// Deliberate operator action only. Gmail notifications themselves do not attest delivery.
const file = process.argv[2];
if (!file) throw new Error("Supply a reviewed evidence JSON file; see NEWSLETTER-DELIVERY.md.");
const input = z
  .object({
    doctor_id: z.string().uuid(),
    task_id: z.string(),
    report_id: z.string(),
    outcome: z.enum(["delivered", "bounced", "complained", "no_terminal_outcome"]),
    reviewer: z.string().min(1),
    authenticity_verified: z.literal(true),
    recipient_and_original_message_verified: z.literal(true),
  })
  .strict()
  .parse(JSON.parse(await readFile(file, "utf8")));
if (input.reviewer !== process.env["EMAIL_DELIVERY_REVIEWER"])
  throw new Error("Authorized evidence reviewer required.");
const mailbox = await readRecord<MailboxState>("email_mailbox", "gmail");
const report = mailbox?.state.reports.find((r) => r.id === input.report_id);
const doctor = await readRecord<DoctorState>("doctor", input.doctor_id);
const task = doctor?.state.email_delivery?.tasks.find((t) => t.id === input.task_id);
const recipient = recipientFor(input.doctor_id);
if (!report || !task?.provider_id || !recipient)
  throw new Error("Report, accepted task and verified recipient must exist canonically.");
const response = await gmailFetch(`/messages/${encodeURIComponent(report.message_id)}?format=raw`);
if (!response.ok) throw new Error("Report could not be read from Gmail.");
const data = await response.json();
const raw = Buffer.from(data.raw, "base64url").toString();
if (
  raw.length > 500000 ||
  !raw.includes(task.message_id) ||
  !raw.toLowerCase().includes(recipient.email.toLowerCase())
)
  throw new Error("Report does not correlate to this original message and recipient.");
const patterns = {
  delivered: /Action:\s*delivered\s*[\r\n]/i,
  bounced: /Action:\s*failed\s*[\r\n]/i,
  complained: /Feedback-Type:\s*abuse\s*[\r\n]/i,
};
if (input.outcome === "no_terminal_outcome") {
  if (Object.values(patterns).some((p) => p.test(raw)))
    throw new Error("The report contains a terminal outcome; review it explicitly.");
} else {
  if (!patterns[input.outcome].test(raw))
    throw new Error("Report does not contain the attested outcome; do not infer delivery.");
  await recordReviewedDeliveryEvidence(input.doctor_id, input.task_id, {
    id: report.id,
    type: input.outcome,
    evidence: `Human-reviewed Gmail report ${hash(raw)}; reviewer ${input.reviewer}`,
    at: report.at,
  });
}
if (input.outcome === "delivered" || input.outcome === "no_terminal_outcome") {
  await changeDoctor(input.doctor_id, "email_report_hold_resolved", (state) => {
    const mail = delivery(state);
    if (mail.subscription.reason === "delivery_report_pending_review") {
      mail.subscription = {
        status: "unsubscribed",
        version: mail.subscription.version + 1,
        updated_at: new Date().toISOString(),
        reason: "reviewed_report_hold_resolved",
      };
      for (const pending of mail.tasks)
        if (pending.status === "held" && pending.error === "delivery_report_pending_review") {
          pending.status = "cancelled";
          pending.error = "review_resolved_requires_new_subscription";
        }
    }
  });
}
await updateMailbox((state) => {
  const r = state.reports.find((r) => r.id === report.id)!;
  r.status = "reviewed";
});
console.log("Reviewed outcome recorded canonically. No email was sent by this operation.");
