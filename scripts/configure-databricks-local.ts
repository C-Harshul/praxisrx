import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../src/lib/msl/platform/auth.server";
const path = ".env.local";
let text = existsSync(path) ? readFileSync(path, "utf8") : "";
const has = (key: string) => new RegExp(`^${key}=`, "m").test(text);
const add = (key: string, value: string) => {
  if (!has(key)) text += `\n${key}='${value}'\n`;
};
add("DATABRICKS_HOST", "https://dbc-85372395-9d08.cloud.databricks.com");
add("DATABRICKS_WAREHOUSE_ID", "bccde8ce8d366533");
add("DATABRICKS_APP_TABLE", "workspace.msl_demo.app_state");
add("DATABRICKS_AUTH_PROFILE", "msl-canonical");
add("DATABRICKS_MODEL_ENDPOINT", "databricks-gpt-oss-20b");
add("APP_ORIGIN", "http://localhost:8081");
add("APP_SESSION_SECRET", randomBytes(48).toString("hex"));
add("LOVABLE_CRON_SECRET", randomBytes(48).toString("hex"));
if (!has("APP_ACCOUNTS_JSON")) {
  const accounts = [];
  const credentials = ["Synthetic demo accounts only. Keep this ignored file local."];
  for (const [email, role] of [
    ["rao@msl.demo", "doctor"],
    ["chen@msl.demo", "doctor"],
    ["staff@msl.demo", "hospital"],
  ] as const) {
    const password = randomBytes(18).toString("base64url");
    accounts.push({ id: randomUUID(), email, role, password_hash: await hashPassword(password) });
    credentials.push(`${email} (${role})\nPassword: ${password}\n`);
  }
  add("APP_ACCOUNTS_JSON", JSON.stringify(accounts));
  writeFileSync("demo-credentials.local", credentials.join("\n"), { mode: 0o600 });
  chmodSync("demo-credentials.local", 0o600);
}
writeFileSync(path, text, { mode: 0o600 });
chmodSync(path, 0o600);
console.log(
  "Local Databricks configuration saved. Synthetic sign-in details are in demo-credentials.local; no secrets printed.",
);
