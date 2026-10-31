import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { writeFile, access, chmod } from "node:fs/promises";
const client = process.env["GMAIL_CLIENT_ID"],
  secret = process.env["GMAIL_CLIENT_SECRET"];
if (!client || !secret)
  throw new Error(
    "Configure your own Gmail OAuth client ID and secret in ignored server configuration first.",
  );
const destination = ".env.gmail.local";
try {
  await access(destination);
  if (!process.argv.includes("--replace"))
    throw new Error(
      "Credential file exists. Use --replace only for an intentional OAuth rotation.",
    );
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const state = randomBytes(32).toString("base64url"),
  verifier = randomBytes(48).toString("base64url");
const redirect = "http://127.0.0.1:8484/oauth/gmail";
const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.search = new URLSearchParams({
  client_id: client,
  redirect_uri: redirect,
  response_type: "code",
  scope:
    "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
  access_type: "offline",
  prompt: "consent",
  state,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
}).toString();
const server = createServer(async (req, res) => {
  try {
    const request = new URL(req.url ?? "/", redirect);
    const returned = request.searchParams.get("state") ?? "";
    if (
      request.pathname !== "/oauth/gmail" ||
      returned.length !== state.length ||
      !timingSafeEqual(Buffer.from(returned), Buffer.from(state))
    )
      throw new Error("Invalid OAuth state.");
    const code = request.searchParams.get("code");
    if (!code) throw new Error("Authorization was not completed.");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client,
        client_secret: secret,
        code,
        redirect_uri: redirect,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    if (!response.ok) throw new Error("OAuth exchange failed.");
    const token = await response.json();
    if (typeof token.refresh_token !== "string" || typeof token.access_token !== "string")
      throw new Error("No offline refresh token returned. Check the OAuth consent flow.");
    const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!profile.ok) throw new Error("Mailbox identity could not be verified.");
    const mailbox = await profile.json();
    if (
      typeof mailbox.emailAddress !== "string" ||
      !/^[^\r\n\s@]+@[^\r\n\s@]+$/.test(mailbox.emailAddress)
    )
      throw new Error("Invalid mailbox identity.");
    await writeFile(
      destination,
      `GMAIL_REFRESH_TOKEN=${JSON.stringify(token.refresh_token)}\nGMAIL_SENDER=${JSON.stringify(mailbox.emailAddress)}\n`,
      { mode: 0o600 },
    );
    await chmod(destination, 0o600);
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      "Gmail OAuth completed. Server credentials were saved locally; no email was sent. You may close this page.",
    );
    console.log(
      "Gmail OAuth completed. Ignored mode-0600 .env.gmail.local saved; load it into the app/worker environment. No email sent.",
    );
    server.close();
    clearTimeout(timeout);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Gmail authorization could not be completed. Check local setup and try again.");
  }
});
const timeout = setTimeout(() => {
  server.close();
  console.log("Gmail authorization timed out without sending email.");
}, 5 * 60_000);
server.listen(8484, "127.0.0.1", () =>
  console.log(
    `Open this Google authorization link yourself and review the Gmail send/read scopes. No email is sent by setup:\n${url}`,
  ),
);
