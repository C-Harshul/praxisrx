import type { DeliveryTask } from "./types";
/** Manual retries cannot erase ambiguity, acceptance, elapsed limits or attempt counts. */
export function safeToRetry(task: DeliveryTask) {
  return (
    ["held", "failed"].includes(task.status) &&
    !task.provider_id &&
    task.attempts.length < 5 &&
    Date.now() - (task.send_not_before ?? task.created_at) < 86400_000 &&
    task.attempts.every(
      (a) =>
        !["unknown", "sending", "provider-accepted", "delivered", "bounced", "complained"].includes(
          a.outcome,
        ) && !a.provider_id,
    )
  );
}
