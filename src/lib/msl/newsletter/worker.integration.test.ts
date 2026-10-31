import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  fixtureDoctor,
  fixturePackage,
  fixtureDraft,
  fixturePointer,
  doctorId,
} from "../../../../scripts/fixtures/newsletter";
import type { DoctorState } from "../platform/types";
const mock = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  commit: vi.fn(),
  model: vi.fn(),
  context: vi.fn(),
  valid: vi.fn(),
  send: vi.fn(),
  reconcile: vi.fn(),
  configured: vi.fn(),
  recipient: vi.fn(),
}));
vi.mock("../platform/store.server", () => ({
  listRecords: mock.list,
  readRecord: mock.read,
  commitDoctor: mock.commit,
  audit: (s: DoctorState, _actor: string, action: string, details: Record<string, unknown>) =>
    s.audit.push({ id: "test-event", actor: "test", action, details, created_at: "test" }),
}));
vi.mock("./databricks.server", () => ({
  generateNewsletterDraft: mock.model,
  NEWSLETTER_MODEL: "fixture-only",
}));
vi.mock("./context.server", () => ({
  generationContext: mock.context,
  newsletterStillValid: mock.valid,
}));
vi.mock("../delivery/config.server", () => ({
  recipientFor: mock.recipient,
  recipientMatches: () => true,
  sendConfigured: mock.configured,
  emailOrigin: () => "https://app.example.invalid",
}));
vi.mock("../delivery/gmail.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../delivery/gmail.server")>();
  return { ...original, sendGmail: mock.send, reconcileGmail: mock.reconcile };
});
import { runNewsletterJob } from "./worker.server";
import { runDeliveryJob } from "../delivery/worker.server";
import { GmailError } from "../delivery/gmail.server";
import { setSubscription } from "../delivery/subscription.server";
import { publishedItemIds } from "../matching/handoff";
let state: DoctorState;
let revision: number;
let ambiguous: boolean;
const recipient = {
  doctor_id: doctorId,
  id: "00000000-0000-4000-8000-000000000009",
  email: "test@example.invalid",
  version: "test-v1",
  verified_at: "2026-10-31T00:00:00Z",
  authorized_at: "2026-10-31T00:00:00Z",
  modes: ["test"],
};
beforeEach(() => {
  vi.resetAllMocks();
  state = fixtureDoctor();
  revision = 1;
  ambiguous = false;
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "test-secret-".repeat(5));
  vi.stubEnv("GMAIL_SENDER", "sender@example.invalid");
  mock.list.mockImplementation(async () => [
    { id: doctorId, revision: String(revision), state: structuredClone(state) },
  ]);
  mock.read.mockImplementation(async (kind: string) =>
    kind === "email_mailbox"
      ? { state: { schema_version: "gmail-mailbox.v1", watch_expires_at: Date.now() + 86400_000 } }
      : {
          id: doctorId,
          revision: String(revision),
          state: structuredClone(state),
        },
  );
  mock.commit.mockImplementation(async (before: { revision: string }, next: DoctorState) => {
    if (before.revision !== String(revision)) throw new Error("CAS conflict");
    state = structuredClone(next);
    revision++;
    if (ambiguous) {
      ambiguous = false;
      throw new Error("ambiguous commit");
    }
    return String(revision);
  });
  // These are explicitly OFFLINE simulated boundaries, never a clinical Databricks release.
  mock.context.mockImplementation(async () =>
    state.profiles.at(-1)?.confirmed_at
      ? {
          doctor_id: doctorId,
          matching_run_id: state.matching_runs[0]!.id,
          doctor_revision: String(revision),
          release_version: "fixture-release",
          evidence_package: structuredClone(state.matching_runs[0]!.evidence_package!),
          pointer: { state: fixturePointer() },
        }
      : null,
  );
  mock.model.mockResolvedValue({
    draft: fixtureDraft,
    hosting: {
      hosting: "databricks",
      workspace_id: "7474660613250664",
      endpoint: "fixture-only",
      model_entity: "fixture-only",
      config_version: 1,
      verified_at: "2026-10-31T00:00:00Z",
      hosting_policy_version: "test",
    },
    usage: { total_tokens: 10 },
    latency_ms: 5,
  });
  mock.valid.mockImplementation(async (s: DoctorState) => !!s.profiles.at(-1)?.confirmed_at);
  mock.recipient.mockReturnValue(recipient);
  mock.configured.mockReturnValue(false);
  mock.send.mockImplementation(
    async (
      _task: unknown,
      _recipient: unknown,
      _fetcher: unknown,
      check: () => Promise<boolean>,
    ) => {
      if (!(await check())) throw new GmailError("rejected", "final_authorization_changed");
      return "gmail-provider-id";
    },
  );
  mock.reconcile.mockResolvedValue(null);
});
async function publish() {
  mock.configured.mockReturnValue(true);
  state.email_delivery = {
    schema_version: "email-delivery.v1",
    subscription: { status: "subscribed", version: 1, updated_at: "test", reason: null },
    tasks: [],
  };
  expect(await runNewsletterJob()).toEqual({ status: "published" });
}
describe("offline synthetic newsletter/delivery integration", () => {
  it("previews without publication, suppression or any provider call; retry is stable", async () => {
    expect(await runNewsletterJob()).toEqual({ status: "preview" });
    expect(state.newsletters).toHaveLength(0);
    expect(publishedItemIds(state)).toEqual([]);
    expect(state.email_delivery!.tasks[0]!.render.text).toContain("NO EMAIL SENT");
    expect(await runNewsletterJob()).toEqual({ status: "idle" });
    expect(mock.model).toHaveBeenCalledTimes(1);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("keeps in-app publication independent of an unsubscribed email channel", async () => {
    mock.configured.mockReturnValue(true);
    expect(await runNewsletterJob()).toEqual({ status: "published" });
    expect(state.newsletters).toHaveLength(1);
    expect(state.email_delivery!.tasks[0]!.status).toBe("cancelled");
    expect(await runDeliveryJob()).toEqual({ status: "idle" });
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("promotes a current frozen preview without regenerating or duplicate publication", async () => {
    await runNewsletterJob();
    mock.configured.mockReturnValue(true);
    state.email_delivery!.subscription.status = "subscribed";
    expect(await runNewsletterJob()).toEqual({ status: "published" });
    expect(mock.model).toHaveBeenCalledTimes(1);
    expect(state.newsletters).toHaveLength(1);
    expect(publishedItemIds(state)).toEqual(["SYNTHETIC-ONLY"]);
    expect(state.email_delivery!.tasks).toHaveLength(1);
    expect(state.email_delivery!.tasks[0]!.status).toBe("queued");
  });
  it("rejects edited clinical text in a frozen preview without another model call", async () => {
    await runNewsletterJob();
    state.newsletter_jobs!.jobs[0]!.result!.articles[0]!.full_summary =
      "An invented clinical conclusion";
    mock.configured.mockReturnValue(true);
    state.email_delivery!.subscription.status = "subscribed";
    await runNewsletterJob();
    expect(state.newsletters).toHaveLength(0);
    expect(state.newsletter_jobs!.jobs[0]!.status).toBe("superseded");
    expect(mock.model).toHaveBeenCalledTimes(1);
  });
  it("records an empty cycle without model or email calls", async () => {
    state.matching_runs[0]!.evidence_package!.result.matches = [];
    expect(await runNewsletterJob()).toEqual({ status: "empty" });
    expect(state.newsletter_jobs!.jobs[0]!.status).toBe("empty");
    expect(mock.model).not.toHaveBeenCalled();
  });
  it("bounds draft attempts and never publishes failed content", async () => {
    mock.model.mockRejectedValue(new Error("invalid claims"));
    for (let n = 0; n < 3; n++) {
      await runNewsletterJob();
      state.newsletter_jobs!.jobs[0]!.next_attempt_at = 0;
    }
    expect(state.newsletter_jobs!.jobs[0]!.status).toBe("failed");
    expect(state.newsletters).toHaveLength(0);
    expect(mock.model).toHaveBeenCalledTimes(3);
  });
  it("rejects consent/profile changes during generation", async () => {
    mock.model.mockImplementation(async () => {
      state.profiles[0]!.confirmed_at = null;
      return { draft: fixtureDraft };
    });
    await runNewsletterJob();
    expect(state.newsletters).toHaveLength(0);
    expect(state.newsletter_jobs!.jobs[0]!.status).toBe("superseded");
  });
  it("resolves ambiguous canonical commits from their durable audit receipt", async () => {
    ambiguous = true;
    expect(await runNewsletterJob()).toEqual({ status: "preview" });
    expect(state.newsletter_jobs!.jobs).toHaveLength(1);
  });
  it("only one concurrent worker wins the canonical lease", async () => {
    const result = await Promise.allSettled([runNewsletterJob(), runNewsletterJob()]);
    expect(result.some((r) => r.status === "fulfilled")).toBe(true);
    expect(mock.model).toHaveBeenCalledTimes(1);
    expect(state.newsletter_jobs!.jobs).toHaveLength(1);
  });
  it("distinguishes API acceptance from delivery and never waits for a read", async () => {
    await publish();
    expect(await runDeliveryJob()).toEqual({ status: "provider-accepted" });
    const task = state.email_delivery!.tasks[0]!;
    expect(task.provider_id).toBe("gmail-provider-id");
    expect(task.status).not.toBe("delivered");
    expect(await runDeliveryJob()).toEqual({ status: "idle" });
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect(mock.model).toHaveBeenCalledTimes(1);
  });
  it("holds ambiguous send outcomes and never blindly resends Gmail messages", async () => {
    await publish();
    mock.send.mockRejectedValue(new GmailError("unknown", "gmail_send_outcome_unknown"));
    expect(await runDeliveryJob()).toEqual({ status: "unknown" });
    for (let n = 0; n < 5; n++) {
      state.email_delivery!.tasks[0]!.next_attempt_at = 0;
      await runDeliveryJob();
    }
    expect(state.email_delivery!.tasks[0]!.status).toBe("unknown");
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect(mock.reconcile).toHaveBeenCalledTimes(5);
  });
  it("reconciles prior sending to acceptance only, without another send", async () => {
    await publish();
    mock.send.mockRejectedValue(new GmailError("unknown", "timeout"));
    await runDeliveryJob();
    state.email_delivery!.tasks[0]!.next_attempt_at = 0;
    mock.reconcile.mockResolvedValue("recovered-gmail-id");
    expect(await runDeliveryJob()).toEqual({ status: "provider-accepted" });
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
  it("reuses the newsletter and logical key after an explicit transient rejection", async () => {
    await publish();
    const key = state.email_delivery!.tasks[0]!.idempotency_key;
    mock.send.mockRejectedValueOnce(new GmailError("retry", "rate_limited"));
    await runDeliveryJob();
    state.email_delivery!.tasks[0]!.next_attempt_at = 0;
    await runDeliveryJob();
    expect(state.email_delivery!.tasks[0]!.idempotency_key).toBe(key);
    expect(mock.model).toHaveBeenCalledTimes(1);
    expect(state.newsletters).toHaveLength(1);
  });
  it("cancels queued tasks on unsubscribe and preserves address suppression", async () => {
    await publish();
    await setSubscription(doctorId, false);
    await runDeliveryJob();
    expect(mock.send).not.toHaveBeenCalled();
    state.email_delivery!.subscription.status = "suppressed";
    await setSubscription(doctorId, false);
    expect(state.email_delivery!.subscription.status).toBe("suppressed");
    await expect(setSubscription(doctorId, true)).rejects.toThrow("suppressed");
  });
  it("blocks unsubscribe during the final provider preparation check", async () => {
    await publish();
    mock.send.mockImplementationOnce(async (_t, _r, _f, check) => {
      await setSubscription(doctorId, false);
      if (!(await check())) throw new GmailError("rejected", "final_authorization_changed");
      throw new Error("must not send");
    });
    expect(await runDeliveryJob()).toEqual({ status: "cancelled" });
    expect(state.email_delivery!.tasks[0]!.provider_id).toBeNull();
  });
  it("converts expired send leases to unknown instead of issuing a duplicate send", async () => {
    await publish();
    const t = state.email_delivery!.tasks[0]!;
    t.status = "sending";
    t.lease_until = 0;
    expect(await runDeliveryJob()).toEqual({ status: "unknown" });
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("respects fortnightly cadence even when another profile update prepared content early", async () => {
    await publish();
    state.doctor.frequency = "Every two weeks";
    const prior = structuredClone(state.email_delivery!.tasks[0]!);
    prior.id = "prior";
    prior.provider_id = "prior-provider";
    prior.status = "provider-accepted";
    prior.created_at = Date.now() - 8 * 86400_000;
    prior.attempts = [];
    state.email_delivery!.tasks.push(prior);
    expect(await runDeliveryJob()).toEqual({ status: "held" });
    expect(state.email_delivery!.tasks[0]!.next_attempt_at).toBeGreaterThan(
      Date.now() + 5 * 86400_000,
    );
    expect(mock.send).not.toHaveBeenCalled();
  });
});
