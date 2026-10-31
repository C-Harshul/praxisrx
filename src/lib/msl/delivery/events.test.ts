import { describe, it, expect } from "vitest";
import { applyDeliveryEvidence } from "./events.server";
import { testTask } from "../../../../scripts/fixtures/email-task";
import { fixtureDoctor } from "../../../../scripts/fixtures/newsletter";
import { safeToRetry } from "./retry";
describe("delivery evidence state machine", () => {
  it("never manually requeues ambiguity, acceptance or exhausted delivery bounds", () => {
    const task = testTask();
    task.created_at = Date.now();
    task.status = "held";
    expect(safeToRetry(task)).toBe(true);
    task.status = "unknown";
    expect(safeToRetry(task)).toBe(false);
    task.status = "failed";
    task.provider_id = "accepted";
    expect(safeToRetry(task)).toBe(false);
    task.provider_id = null;
    task.created_at = Date.now() - 2 * 86400_000;
    expect(safeToRetry(task)).toBe(false);
  });
  it("does not downgrade outcomes for late acceptance and deduplicates evidence", () => {
    const state = fixtureDoctor(),
      task = testTask();
    const delivered = {
      id: "e1",
      type: "delivered" as const,
      evidence: "explicit reviewed delivery receipt fixture",
      at: 1,
    };
    applyDeliveryEvidence(state, task, delivered);
    applyDeliveryEvidence(state, task, delivered);
    expect(task.events).toHaveLength(1);
    applyDeliveryEvidence(state, task, {
      id: "e2",
      type: "provider-accepted",
      evidence: "accepted fixture",
      at: 0,
    });
    expect(task.status).toBe("delivered");
    expect(() =>
      applyDeliveryEvidence(state, task, { ...delivered, evidence: "different" }),
    ).toThrow("identity_conflict");
  });
  it("hard bounce and complaint evidence suppress future email", () => {
    const state = fixtureDoctor(),
      task = testTask();
    applyDeliveryEvidence(state, task, {
      id: "bounce",
      type: "bounced",
      evidence: "reviewed report fixture",
      at: 1,
    });
    expect(task.status).toBe("bounced");
    expect(state.email_delivery!.subscription.status).toBe("suppressed");
    applyDeliveryEvidence(state, task, {
      id: "complaint",
      type: "complained",
      evidence: "reviewed report fixture",
      at: 2,
    });
    expect(task.status).toBe("complained");
  });
});
