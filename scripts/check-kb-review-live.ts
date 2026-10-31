/** Read-only live walkthrough. Never sends review/publish commands. No credentials logged. */
import { readFileSync, writeFileSync } from "node:fs";
import { strict as assert } from "node:assert";
const origin = process.env["APP_ORIGIN"] ?? "http://localhost:8081";
const secret = readFileSync("reviewer-credentials.local", "utf8");
const email = secret.match(/^Email: (.+)$/m)?.[1],
  password = secret.match(/^Password: (.+)$/m)?.[1];
if (!email || !password) throw new Error("Dedicated local reviewer credentials unavailable.");
let cookie = "";
async function call(action: string, input: unknown = null, expected = 200, foreign = false) {
  const response = await fetch(origin + "/api/review", {
    method: "POST",
    headers: {
      Origin: foreign ? "https://foreign.invalid" : origin,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ action, input }),
  });
  assert.equal(response.status, expected, `Unexpected ${action} status`);
  const result = await response.json();
  return { response, result };
}
await call("list", null, 401);
const login = await call("sign_in", { email, password });
cookie = login.response.headers.get("set-cookie")!.split(";")[0]!;
const directory = (await call("list")).result;
assert.ok(directory.entries.length > 0);
const first = directory.entries[0];
const detail = (await call("detail", { id: first.candidate.id, version: first.candidate.version }))
  .result;
assert.equal(detail.snapshot_hash, first.snapshot_hash);
const preview = (
  await call("preview", { candidate_set_id: directory.sets[0].id, cutoff: "2026-10-30" })
).result;
assert.equal(preview.errors.length, 0);
await call("list", null, 403, true);
const html = await fetch(origin + "/review");
assert.equal(html.status, 200);
assert.ok((await html.text()).includes("Evidence review"));
const { executeSql } = await import("../src/integrations/databricks/sql.server");
const { immutableWriteStatement } = await import("../src/lib/msl/kb/store.server");
const plan = await executeSql("EXPLAIN " + immutableWriteStatement(true), [
  { name: "rows", value: "[]" },
  { name: "fence", value: directory.current.revision },
]);
assert.ok(plan.rows.length > 0, "Fenced SQL plan missing");
assert.ok(
  !plan.rows.some((r) => (r[0] ?? "").includes("Error occurred")),
  "Fenced SQL failed analysis",
);
const report = {
  verified_at: new Date().toISOString(),
  origin,
  mode: "read-only-live-Databricks-through-authenticated-local-review-API",
  counts: directory.counts,
  candidate_count: directory.entries.length,
  current_release: directory.current,
  preview_item_count: preview.items.length,
  preview_excluded_count: preview.excluded.length,
  review_decisions_written: 0,
  clinical_releases_published: 0,
  checks: [
    "anonymous denied",
    "dedicated reviewer signed in",
    "canonical list/detail read",
    "canonical preview validated",
    "foreign origin denied",
    "review page HTTP 200",
    "fenced immutable MERGE analyzed via EXPLAIN only (no write)",
  ],
};
writeFileSync("kb/exports/live-review-ui-readback.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
