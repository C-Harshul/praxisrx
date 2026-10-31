import { beforeEach, describe, it, expect, vi } from "vitest";
import type { MailboxState } from "./mailbox.server";
const mock = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), gmail: vi.fn() }));
vi.mock("../platform/store.server", () => ({ readRecord: mock.read, listRecords: vi.fn() }));
vi.mock("./mailbox.server", () => ({ updateMailbox: mock.update }));
vi.mock("./gmail.server", () => ({ gmailFetch: mock.gmail }));
import { runGmailNotificationJob } from "./notifications.server";
let mailbox: MailboxState;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  mailbox = {
    schema_version: "gmail-mailbox.v1",
    history_id: "10",
    watch_expires_at: Date.now() + 10000,
    events: [
      { id: "event", hash: "hash", history_id: "14", at: 1, status: "pending", error: null },
    ],
    reports: [],
  };
  mock.read.mockImplementation(async () => ({ state: structuredClone(mailbox) }));
  mock.update.mockImplementation(async (fn) => {
    const next = structuredClone(mailbox);
    const result = fn(next);
    mailbox = next;
    return result;
  });
});
describe("Gmail mailbox reconciliation", () => {
  it("persists pagination before moving the history checkpoint and never infers delivery", async () => {
    mock.gmail
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ history: [], historyId: "14", nextPageToken: "page-two" })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ history: [], historyId: "14" })));
    expect(await runGmailNotificationJob()).toEqual({ status: "scanning" });
    expect(mailbox.history_id).toBe("10");
    expect(mailbox.page_token).toBe("page-two");
    expect(await runGmailNotificationJob()).toEqual({ status: "processed" });
    expect(mailbox.history_id).toBe("14");
    expect(mailbox.events[0]!.status).toBe("processed");
    expect(mock.gmail.mock.calls[1]![0]).toContain("pageToken=page-two");
  });
  it("quarantines expired history instead of skipping unprocessed evidence", async () => {
    mock.gmail.mockResolvedValue(new Response("", { status: 404 }));
    expect(await runGmailNotificationJob()).toEqual({ status: "quarantined" });
    expect(mailbox.history_id).toBe("10");
    expect(mailbox.events[0]!.error).toBe("gmail_history_expired_resync_required");
  });
  it("leaves a durable pending event intact when the provider is unavailable", async () => {
    mock.gmail.mockRejectedValue(new Error("unavailable"));
    await expect(runGmailNotificationJob()).rejects.toThrow("unavailable");
    expect(mailbox.events[0]!.status).toBe("pending");
  });
});
