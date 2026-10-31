import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { z } from "zod";
const roleSchema = z.enum(["doctor", "hospital", "reviewer"]);
export type Role = z.infer<typeof roleSchema>;
const accountSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: roleSchema,
  password_hash: z.string().regex(/^[0-9a-f]{32}:[0-9a-f]{128}$/),
});
export type Session = { id: string; email: string; role: Role };
const cookieName = (role: Role) => `msl_${role}_session`;
function config() {
  const secret = process.env["APP_SESSION_SECRET"];
  const origin = process.env["APP_ORIGIN"];
  if (!secret || secret.length < 32 || !origin)
    throw new Error("App authentication is not configured.");
  const accounts = z
    .array(accountSchema)
    .parse(JSON.parse(process.env["APP_ACCOUNTS_JSON"] ?? "[]"));
  if (accounts.length === 0 || new Set(accounts.map((a) => a.id)).size !== accounts.length)
    throw new Error("App accounts are not configured.");
  return { secret, origin: new URL(origin).origin, accounts };
}
const scrypt = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))),
  );
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await scrypt(password, salt)).toString("hex")}`;
}
function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function checkOrigin(request: Request) {
  if (request.headers.get("Origin") !== config().origin) throw new Error("Invalid request origin.");
}
const attempts = new Map<string, { count: number; until: number }>();
export async function signIn(request: Request, raw: unknown) {
  checkOrigin(request);
  const input = z
    .object({
      email: z.string().email().max(255),
      password: z.string().min(8).max(128),
      role: roleSchema,
    })
    .strict()
    .parse(raw);
  const settings = config();
  const key = input.email.toLowerCase() + ":" + input.role;
  const previous = attempts.get(key);
  if (previous && previous.until > Date.now() && previous.count >= 10)
    throw new Error("Too many sign-in attempts. Try again later.");
  if (attempts.size > 1000)
    for (const [k, v] of attempts) if (v.until <= Date.now()) attempts.delete(k);
  const account = settings.accounts.find(
    (a) => a.email.toLowerCase() === input.email.toLowerCase() && a.role === input.role,
  );
  const [salt, expected] = (
    account?.password_hash ?? "00000000000000000000000000000000:" + "0".repeat(128)
  ).split(":");
  const actual = (await scrypt(input.password, salt!)).toString("hex");
  if (!account || !equal(actual, expected!)) {
    attempts.set(key, {
      count: previous && previous.until > Date.now() ? previous.count + 1 : 1,
      until: Date.now() + 15 * 60_000,
    });
    throw new Error("That email and password don't match.");
  }
  attempts.delete(key);
  const payload = Buffer.from(
    JSON.stringify({
      sub: account.id,
      role: account.role,
      exp: Date.now() + 8 * 3600_000,
      credential_version: signature(account.password_hash, settings.secret),
    }),
  ).toString("base64url");
  const cookie = `${cookieName(account.role)}=${payload}.${signature(payload, settings.secret)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${settings.origin.startsWith("https:") ? "; Secure" : ""}`;
  return { session: { id: account.id, email: account.email, role: account.role }, cookie };
}
export function readSession(request: Request, role: Role): Session | null {
  const settings = config();
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName(role) + "="))
    ?.slice(cookieName(role).length + 1);
  if (!value || value.length > 3000) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig || !equal(signature(payload, settings.secret), sig)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    const account = settings.accounts.find((a) => a.id === data.sub && a.role === role);
    if (
      !account ||
      data.role !== role ||
      typeof data.exp !== "number" ||
      data.exp < Date.now() ||
      data.credential_version !== signature(account.password_hash, settings.secret)
    )
      return null;
    return { id: account.id, email: account.email, role };
  } catch {
    return null;
  }
}
export function requireSession(request: Request, role: Role) {
  const session = readSession(request, role);
  if (!session) throw new Error("Not signed in.");
  return session;
}
export function signOutCookie(role: Role) {
  return `${cookieName(role)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config().origin.startsWith("https:") ? "; Secure" : ""}`;
}
