import { beforeEach, describe, it, expect, vi } from "vitest";
import { sendGmail, gmailMime, reconcileGmail } from "./gmail.server";
const recipient = {
  doctor_id: "00000000-0000-4000-8000-000000000001",
  id: "00000000-0000-4000-8000-000000000009",
  email: "recipient@example.invalid",
  version: "test",
  verified_at: "2026-10-31T00:00:00Z",
  authorized_at: "2026-10-31T00:00:00Z",
  modes: ["test" as const],
};
import { testTask } from "../../../../scripts/fixtures/email-task";
beforeEach(() => {
  vi.stubEnv("GMAIL_SENDER", "sender@example.invalid");
  vi.stubEnv("GMAIL_CLIENT_ID", "fixture");
  vi.stubEnv("GMAIL_CLIENT_SECRET", "fixture");
  vi.stubEnv("GMAIL_REFRESH_TOKEN", "fixture");
});
const oauth = () => new Response(JSON.stringify({ access_token: "fixture-token" }));
describe("Gmail transport (no network)", () => {
  it("uses stable RFC MIME and records only the provider response identity", async () => {
    const task = testTask();
    expect(gmailMime(task, recipient)).toBe(gmailMime(task, recipient));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(oauth())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ emailAddress: "sender@example.invalid" })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "gmail123" })));
    expect(await sendGmail(task, recipient, fetcher, async () => true)).toBe("gmail123");
    const [url, init] = fetcher.mock.calls[2]!;
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    const mime = Buffer.from(JSON.parse(init.body).raw, "base64url").toString();
    expect(mime).toContain(`Message-ID: ${task.message_id}`);
    expect(mime).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(mime).not.toContain("Bcc:");
  });
  it("makes no send call if final authorization changed", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(oauth())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ emailAddress: "sender@example.invalid" })),
      );
    await expect(
      sendGmail(testTask(), recipient, fetcher, async () => false),
    ).rejects.toMatchObject({ kind: "rejected", code: "final_authorization_changed" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("treats a lost/malformed send response as ambiguous rather than unsent", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(oauth())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ emailAddress: "sender@example.invalid" })),
      )
      .mockRejectedValueOnce(new Error("timeout"));
    await expect(sendGmail(testTask(), recipient, fetcher, async () => true)).rejects.toMatchObject(
      { kind: "unknown" },
    );
  });
  it("does not infer a resend or delivery from an empty sent-mail search", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(oauth())
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] })));
    expect(await reconcileGmail(testTask(), fetcher)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
