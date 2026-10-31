import { listRecords } from "../src/lib/msl/platform/store.server";
import type { DoctorState } from "../src/lib/msl/platform/types";
import { currentPointer } from "../src/lib/msl/newsletter/context.server";
import { runNewsletterJob } from "../src/lib/msl/newsletter/worker.server";
// This command never permits Gmail calls or clinical publication.
process.env["EMAIL_MODE"] = "preview";
process.env["EMAIL_SEND_ENABLED"] = "false";
const pointer = await currentPointer();
if (!pointer) throw new Error("No valid published clinical KB pointer is available.");
let processing: "not-requested" | string = "not-requested";
if (process.argv.includes("--process-empty")) {
  if (pointer.state.payload.items.length !== 0)
    throw new Error("This verification only processes an empty approved clinical release.");
  processing = (await runNewsletterJob()).status;
}
const doctors = await listRecords<DoctorState>("doctor");
console.log(
  JSON.stringify(
    {
      workspace: "7474660613250664",
      kb_revision: pointer.revision,
      reviewed_items: pointer.state.payload.items.length,
      doctors: doctors.length,
      confirmed_profiles: doctors.filter((r) => r.state.profiles.at(-1)?.confirmed_at).length,
      matching_packages: doctors.reduce(
        (n, r) => n + r.state.matching_runs.filter((m) => m.evidence_package).length,
        0,
      ),
      generation_states: doctors.flatMap(
        (r) => r.state.newsletter_jobs?.jobs.map((j) => j.status) ?? [],
      ),
      canonical_document_bytes: doctors.map((r) => Buffer.byteLength(JSON.stringify(r.state))),
      processing,
      email_sent: false,
    },
    null,
    2,
  ),
);
