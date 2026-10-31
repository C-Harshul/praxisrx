import type { DoctorState } from "../platform/types";
import type { DeliveryStatus, DeliveryTask } from "./types";
import { changeDoctor, delivery, hash } from "../newsletter/state.server";

/** Only authenticated provider lookup or an explicitly reviewed delivery report may call this. */
export function applyDeliveryEvidence(
  state: DoctorState,
  task: DeliveryTask,
  event: {
    id: string;
    type: "provider-accepted" | "delivered" | "bounced" | "complained";
    evidence: string;
    at: number;
  },
) {
  const digest = hash(event);
  const previous = task.events.find((e) => e.id === event.id);
  if (previous) {
    if (previous.hash !== digest) throw new Error("delivery_event_identity_conflict");
    return;
  }
  if (task.events.length >= 100) throw new Error("delivery_event_archival_required");
  task.events.push({ ...event, hash: digest });
  const rank: Partial<Record<DeliveryStatus, number>> = {
    "provider-accepted": 1,
    delivered: 2,
    bounced: 3,
    complained: 4,
  };
  if ((rank[event.type] ?? 0) > (rank[task.status] ?? 0)) task.status = event.type;
  if (event.type === "bounced" || event.type === "complained") {
    const mail = delivery(state);
    mail.subscription = {
      status: "suppressed",
      version: mail.subscription.version + 1,
      updated_at: new Date().toISOString(),
      reason: event.type,
    };
    for (const other of mail.tasks)
      if (other.id !== task.id && ["queued", "sending", "unknown"].includes(other.status)) {
        other.status = "cancelled";
        other.error = "address_suppressed";
      }
  }
}
export async function recordReviewedDeliveryEvidence(
  doctor: string,
  taskId: string,
  event: Parameters<typeof applyDeliveryEvidence>[2],
) {
  return changeDoctor(doctor, "email_reviewed_evidence", (state) => {
    const task = delivery(state).tasks.find((t) => t.id === taskId);
    if (!task || !task.provider_id) throw new Error("delivery_task_not_provider_accepted");
    applyDeliveryEvidence(state, task, event);
  });
}
