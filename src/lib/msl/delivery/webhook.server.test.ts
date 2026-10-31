import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("./mailbox.server", () => ({ updateMailbox: mocks.update }));
import { verifyPubSub, receiveGmailPush } from "./webhook.server";
import type { MailboxState } from "./mailbox.server";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = {
  ...pair.publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
const audience = "https://example.invalid/api/email/gmail-webhook";
function jwt(extra: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString(
    "base64url",
  );
  const body = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: audience,
      email: "push@example.invalid",
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 1800,
      ...extra,
    }),
  ).toString("base64url");
  return `${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), pair.privateKey).toString("base64url")}`;
}
const keys = () => vi.fn().mockResolvedValue(new Response(JSON.stringify({ keys: [key] })));
function request(token = jwt(), history = "123") {
  return new Request(audience, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      subscription: "projects/test/subscriptions/gmail",
      message: {
        messageId: "event1",
        data: Buffer.from(
          JSON.stringify({ emailAddress: "sender@example.invalid", historyId: history }),
        ).toString("base64"),
      },
    }),
  });
}
let state: MailboxState;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GMAIL_PUBSUB_AUDIENCE", audience);
  vi.stubEnv("GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL", "push@example.invalid");
  vi.stubEnv("GMAIL_PUBSUB_SUBSCRIPTION", "projects/test/subscriptions/gmail");
  vi.stubEnv("GMAIL_SENDER", "sender@example.invalid");
  state = {
    schema_version: "gmail-mailbox.v1",
    history_id: null,
    watch_expires_at: null,
    events: [],
    reports: [],
  };
  mocks.update.mockImplementation(async (fn) => {
    const next = structuredClone(state);
    const result = fn(next);
    state = next;
    return result;
  });
});
describe("signed Gmail notifications", () => {
  it("verifies Google signatures/audience and durably deduplicates provider events", async () => {
    expect(await receiveGmailPush(request(), keys())).toEqual({ status: "queued" });
    expect(await receiveGmailPush(request(), keys())).toEqual({ status: "duplicate" });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]!.status).toBe("pending");
    expect(await receiveGmailPush(request(jwt(), "124"), keys())).toEqual({
      status: "quarantined",
    });
    expect(state.conflicts).toHaveLength(1);
  });
  it("rejects invalid signatures, identities, audiences and expired tokens", async () => {
    for (const token of [
      jwt({ aud: "wrong" }),
      jwt({ email_verified: false }),
      jwt({ email: "attacker@example.invalid" }),
      jwt({ exp: 1 }),
      jwt() + "a",
    ])
      await expect(verifyPubSub(request(token), keys())).rejects.toThrow("signature_invalid");
    expect(state.events).toHaveLength(0);
  });
  it("does not acknowledge notifications when canonical persistence fails", async () => {
    mocks.update.mockRejectedValue(new Error("canonical unavailable"));
    await expect(receiveGmailPush(request(), keys())).rejects.toThrow("canonical unavailable");
  });
});
