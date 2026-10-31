import { recipientFor, addressHash } from "../src/lib/msl/delivery/config.server";
import { changeDoctor, delivery } from "../src/lib/msl/newsletter/state.server";
const doctor = process.argv[2];
if (!doctor || !process.argv.includes("--attest-verified-and-authorized"))
  throw new Error(
    "Supply doctor ID and --attest-verified-and-authorized only after verifying ownership and recipient authorization. Never infer an address.",
  );
const recipient = recipientFor(doctor);
if (!recipient)
  throw new Error(
    "Configure the exact verified/authorized EMAIL_RECIPIENTS_JSON entry in server secrets first.",
  );
const revoke = process.argv.includes("--revoke");
await changeDoctor(
  doctor,
  revoke ? "email_recipient_revoked" : "email_recipient_published",
  (state) => {
    const mail = delivery(state);
    if (
      mail.recipient?.version === recipient.version &&
      (mail.recipient.address_hash !== addressHash(recipient.email) ||
        (!revoke && mail.recipient.status === "revoked"))
    )
      throw new Error(
        "Use a new recipient version for changed or previously revoked authorization.",
      );
    if (
      mail.recipient &&
      (mail.recipient.id !== recipient.id || mail.recipient.version !== recipient.version)
    ) {
      mail.subscription = {
        status: "unsubscribed",
        version: mail.subscription.version + 1,
        updated_at: new Date().toISOString(),
        reason: "recipient_changed",
      };
      for (const task of mail.tasks)
        if (["queued", "sending", "unknown"].includes(task.status)) {
          task.status = "cancelled";
          task.error = "recipient_changed";
        }
    }
    mail.recipient = {
      schema_version: "email-recipient.v1",
      id: recipient.id,
      version: recipient.version,
      address_hash: addressHash(recipient.email),
      email: recipient.email,
      status: revoke ? "revoked" : "verified",
      verified_at: recipient.verified_at,
      authorized_at: recipient.authorized_at,
      modes: recipient.modes,
    };
    if (revoke) {
      mail.subscription = {
        status: "unsubscribed",
        version: mail.subscription.version + 1,
        updated_at: new Date().toISOString(),
        reason: "recipient_revoked",
      };
      for (const task of mail.tasks)
        if (["queued", "sending", "unknown"].includes(task.status)) {
          task.status = "cancelled";
          task.error = "recipient_revoked";
        }
    }
  },
);
console.log(
  "Recipient metadata acknowledged in Databricks. Subscription remains a separate doctor choice. No email was sent.",
);
