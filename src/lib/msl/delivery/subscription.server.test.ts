import { beforeEach, describe, it, expect, vi } from "vitest";
import { unsubscribeToken, decodeUnsubscribe } from "./subscription.server";
const recipient = {
  doctor_id: "00000000-0000-4000-8000-000000000001",
  id: "00000000-0000-4000-8000-000000000009",
  email: "recipient@example.invalid",
  version: "v1",
  verified_at: "2026-10-31T00:00:00Z",
  authorized_at: "2026-10-31T00:00:00Z",
  modes: ["test" as const],
};
beforeEach(() => {
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "test-secret-".repeat(5));
  vi.stubEnv("EMAIL_RECIPIENTS_JSON", JSON.stringify([recipient]));
});
describe("unsubscribe capabilities", () => {
  it("scopes signed tokens without exposing a recipient address", () => {
    const token = unsubscribeToken(recipient.doctor_id, recipient, Date.now());
    expect(decodeUnsubscribe(token).recipient).toBe(recipient.id);
    expect(Buffer.from(token.split(".")[0]!, "base64url").toString()).not.toContain(
      recipient.email,
    );
    expect(() => decodeUnsubscribe(token + "x")).toThrow("invalid_unsubscribe");
  });
  it("rejects old address versions and expired capabilities", () => {
    const token = unsubscribeToken(recipient.doctor_id, recipient, Date.now() - 400 * 86400_000);
    expect(() => decodeUnsubscribe(token)).toThrow("expired");
    const changed = unsubscribeToken(
      recipient.doctor_id,
      { ...recipient, version: "old" },
      Date.now(),
    );
    expect(() => decodeUnsubscribe(changed)).toThrow("recipient");
  });
});
