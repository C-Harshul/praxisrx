/** Explicit local-only provisioning. No account is created unless --create is passed. */
import { readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../src/lib/msl/platform/auth.server";
if (!process.argv.includes("--create")) throw new Error("Explicit provisioning requires --create.");
if (process.env["NODE_ENV"] === "production")
  throw new Error("This setup is for the local hackathon only.");
const file = ".env.local";
let text = readFileSync(file, "utf8");
const env = parseEnv(text);
const accounts = JSON.parse(env["APP_ACCOUNTS_JSON"] ?? "[]") as {
  id: string;
  email: string;
  role: string;
  password_hash: string;
}[];
const registry = JSON.parse(env["KB_REVIEWER_REGISTRY_JSON"] ?? "[]") as {
  account_id: string;
  reviewer_id: string;
  can_publish: boolean;
}[];
if (accounts.some((a) => a.role === "reviewer") || registry.length)
  throw new Error("A reviewer already exists; no account was changed.");
if (existsSync("reviewer-credentials.local"))
  throw new Error("Reviewer credential file already exists; inspect it locally.");
const id = randomUUID(),
  password = randomBytes(24).toString("base64url"),
  email = "reviewer@msl.demo";
accounts.push({ id, email, role: "reviewer", password_hash: await hashPassword(password) });
const allowed = (env["KB_AUTHORIZED_REVIEWERS"] ?? "").split(",").filter(Boolean);
allowed.push(id);
const set = (key: string, value: string) => {
  const line = `${key}='${value}'`;
  const rx = new RegExp(`^${key}=.*$`, "m");
  text = rx.test(text) ? text.replace(rx, () => line) : text + "\n" + line + "\n";
};
set("APP_ACCOUNTS_JSON", JSON.stringify(accounts));
set("KB_AUTHORIZED_REVIEWERS", [...new Set(allowed)].join(","));
set(
  "KB_REVIEWER_REGISTRY_JSON",
  JSON.stringify([{ account_id: id, reviewer_id: id, can_publish: true }]),
);
writeFileSync(
  "reviewer-credentials.local",
  `Dedicated local MSL reviewer. Keep this ignored file private.\nEmail: ${email}\nPassword: ${password}\nReviewer ID: ${id}\n`,
  { mode: 0o600, flag: "wx" },
);
writeFileSync(file, text, { mode: 0o600 });
chmodSync(file, 0o600);
chmodSync("reviewer-credentials.local", 0o600);
console.log(
  "Dedicated reviewer provisioned. Credentials are in ignored reviewer-credentials.local. Restart the local app; no secrets printed. No clinical review or publication performed.",
);
