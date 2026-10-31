import { randomUUID } from "node:crypto";
import { databricksConfig, executeSql } from "../src/integrations/databricks/sql.server";
import { readRecord } from "../src/lib/msl/platform/store.server";
import { emptyMailbox, updateMailbox } from "../src/lib/msl/delivery/mailbox.server";
import { gmailFetch } from "../src/lib/msl/delivery/gmail.server";

// Run with environment from the server secret manager. Never prints tokens or addresses.
if (process.argv.includes("--watch")) {
  const topic = process.env["GMAIL_PUBSUB_TOPIC"];
  if (!topic || !/^projects\/[\w-]+\/topics\/[\w.-]+$/.test(topic))
    throw new Error("Configure GMAIL_PUBSUB_TOPIC first.");
  const response = await gmailFetch("/watch", {
    method: "POST",
    body: JSON.stringify({ topicName: topic }),
  });
  if (!response.ok)
    throw new Error("Gmail watch setup failed. Check OAuth scopes and Pub/Sub grants.");
  const result = await response.json();
  if (!/^\d+$/.test(result.historyId) || !Number.isFinite(Number(result.expiration)))
    throw new Error("Invalid Gmail watch response.");
  await updateMailbox((state) => {
    state.history_id ??= result.historyId;
    state.watch_expires_at = Number(result.expiration);
  });
  console.log("Gmail watch acknowledged. Renew before its recorded expiry; no email was sent.");
} else {
  const existing = await readRecord("email_mailbox", "gmail");
  if (existing) {
    console.log("Canonical Gmail mailbox record already exists; preserved.");
  } else {
    const table = databricksConfig()
      .table.split(".")
      .map((s) => `\`${s}\``)
      .join(".");
    const revision = randomUUID();
    await executeSql(
      `INSERT INTO ${table} (record_type,id,revision,payload,updated_at) SELECT 'email_mailbox','gmail',:revision,:payload,current_timestamp() WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE record_type='email_mailbox' AND id='gmail')`,
      [
        { name: "revision", value: revision },
        { name: "payload", value: JSON.stringify(emptyMailbox()) },
      ],
    );
    const check = await readRecord("email_mailbox", "gmail");
    if (!check) throw new Error("Canonical mailbox setup unconfirmed; refresh before retrying.");
    console.log(
      "Canonical Gmail notification record provisioned; no email was sent. Use one setup writer.",
    );
  }
}
