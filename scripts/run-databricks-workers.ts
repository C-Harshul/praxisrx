import { runNewsletterJob } from "../src/lib/msl/newsletter/worker.server";
import { runDeliveryJob } from "../src/lib/msl/delivery/worker.server";
import { runGmailNotificationJob } from "../src/lib/msl/delivery/notifications.server";
import { runProfilingJob } from "../src/lib/msl/profiling/worker.server";
import { runMatchingJob } from "../src/lib/msl/matching/worker.server";
const statuses = new Map<string, string>();
async function run(name: string, fn: () => Promise<{ status: string }>) {
  try {
    const result = await fn();
    if (statuses.get(name) !== result.status) console.log(`${name}: ${result.status}`);
    statuses.set(name, result.status);
  } catch {
    if (statuses.get(name) !== "unavailable")
      console.log(`${name}: canonical service unavailable; retrying later`);
    statuses.set(name, "unavailable");
  }
}
console.log(
  "Independent local Databricks workers started. Persisted jobs are checked every 30 seconds.",
);
while (true) {
  await run("profiling", runProfilingJob);
  await run("matching", runMatchingJob);
  await run("newsletter", runNewsletterJob);
  await run("delivery", runDeliveryJob);
  await run("gmail-notifications", runGmailNotificationJob);
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}
