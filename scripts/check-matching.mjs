import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;`);
for (const name of ["0000_migration.sql", "0001_doctor_profiling.sql", "0002_matching.sql", "0003_patient_sync.sql", "0004_hospital_portal.sql"])
  await db.exec(await readFile(new URL(`../drizzle/migrations/${name}`, import.meta.url), "utf8"));
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const first = "00000000-0000-0000-0000-000000000001";
const second = "00000000-0000-0000-0000-000000000002";
await db.exec(`INSERT INTO auth.users VALUES ('${first}'),('${second}');
UPDATE doctors SET cancer_types=ARRAY['Lung'],topics=ARRAY['Immunotherapy'],frequency='Weekly',onboarding_complete=true;`);
await db.exec(`UPDATE doctors SET frequency='Every two weeks' WHERE id='${second}'`);
assert.equal((await rows("SELECT enqueue_due_matching_jobs() AS count"))[0].count, 0);
await db.query("INSERT INTO matching_kb_releases(payload) VALUES ($1)", [
  { schema_version: "matching-kb.v1", items: [] },
]);
assert.equal(
  (await rows("SELECT enqueue_due_matching_jobs() AS count"))[0].count,
  0,
  "unconfirmed profile defers matching",
);
async function confirmNext() {
  const [p] = await rows("SELECT * FROM claim_doctor_profile_job()");
  await db.query(
    "SELECT finish_doctor_profile_job($1,$2,$3,NULL,'test-model','test-prompt','doctor-profile.v1')",
    [p.id, p.lease_token, { stated: p.input, suggested_focus: [] }],
  );
  await db.exec(
    `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${p.doctor}',false);`,
  );
  await db.query("SELECT confirm_doctor_profile($1,'[]')", [p.id]);
  await db.exec("RESET ROLE");
}
await confirmNext();
await confirmNext();
assert.equal((await rows("SELECT enqueue_due_matching_jobs() AS count"))[0].count, 2);
assert.equal(
  (await rows("SELECT enqueue_due_matching_jobs() AS count"))[0].count,
  0,
  "idempotent enqueue",
);
const claim = async () => (await rows("SELECT claim_matching_job() AS job"))[0].job;
const finish = async (j, error = null) =>
  (
    await rows("SELECT finish_matching_job($1,$2,$3,$4,'matching.v1') AS status", [
      j.id,
      j.lease_token,
      { matcher_version: "matching.v1", matches: [], excluded: [] },
      error,
    ])
  )[0].status;
let job = await claim();
assert.equal(JSON.stringify(job.input).includes("doctor_id_code"), false);
assert.equal(JSON.stringify(job.input).includes("full_name"), false);
await db.exec(
  `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${second}',false);`,
);
assert.equal((await rows("SELECT * FROM matching_jobs WHERE id=$1", [job.id])).length, 0);
for (const sql of [
  "SELECT enqueue_due_matching_jobs()",
  "SELECT claim_matching_job()",
  `SELECT current_matching_input('${first}')`,
  `SELECT read_current_matching_result('${job.id}')`,
  "INSERT INTO matching_kb_releases(payload) VALUES ('{}')",
  "UPDATE matching_jobs SET status='succeeded'",
])
  await assert.rejects(db.exec(sql));
await db.exec("RESET ROLE; SET ROLE service_role");
assert.equal(await finish(job), "succeeded");
assert.ok((await rows("SELECT read_current_matching_result($1) AS data", [job.id]))[0].data);
await db.exec("RESET ROLE");
// A profile edit invalidates previously successful handoffs immediately.
await db.exec(`UPDATE doctors SET topics=ARRAY['Targeted therapy'] WHERE id='${first}'`);
assert.equal(
  (await rows("SELECT read_current_matching_result($1) AS data", [job.id]))[0].data,
  null,
);
job = await claim();
const oldLease = job.lease_token;
await db.query("UPDATE matching_jobs SET started_at=now()-interval '6 minutes' WHERE id=$1", [
  job.id,
]);
const reclaimed = await claim();
assert.notEqual(reclaimed.lease_token, oldLease);
assert.equal(await finish(job), "superseded");
assert.equal(await finish(reclaimed), "succeeded");
assert.equal(await finish(reclaimed), "superseded", "duplicate completion cannot replace result");
await db.query("UPDATE matching_jobs SET created_at=now()-interval '8 days' WHERE id=$1", [
  reclaimed.id,
]);
assert.equal(
  (await rows("SELECT enqueue_due_matching_jobs() AS count"))[0].count,
  0,
  "biweekly does not run at day eight",
);
await db.query("UPDATE matching_jobs SET created_at=now()-interval '15 days' WHERE id=$1", [
  reclaimed.id,
]);
assert.equal(
  (await rows("SELECT enqueue_due_matching_jobs() AS count"))[0].count,
  1,
  "biweekly runs after fourteen days",
);
const biweekly = await claim();
assert.equal(await finish(biweekly), "succeeded");
const [newsletter] = await rows(
  "INSERT INTO newsletters(doctor,title) VALUES ($1,'SYNTHETIC TEST') RETURNING id",
  [second],
);
await db.query(
  "INSERT INTO articles(newsletter,title,cancer_type,kb_item_id) VALUES ($1,'SYNTHETIC TEST','Lung','synthetic-delivered')",
  [newsletter.id],
);
assert.equal(
  (await rows("SELECT read_current_matching_result($1) AS data", [biweekly.id]))[0].data,
  null,
  "delivery state changes invalidate old handoffs",
);
const [current] = await rows("SELECT current_matching_input($1) AS data", [second]);
assert.deepEqual(current.data.delivered_item_ids, ["synthetic-delivered"]);
await db.query(
  "UPDATE matching_jobs SET created_at=now()-interval '8 days' WHERE doctor=$1 AND status='succeeded'",
  [first],
);
await confirmNext();
assert.equal((await rows("SELECT enqueue_due_matching_jobs() AS count"))[0].count, 1);
job = await claim();
// Linking and unlinking replace confirmed profile versions; a late worker cannot publish.
await db.exec(
  `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${first}',false); SELECT link_patient_data('DR-1001',true); SELECT unlink_patient_data(); RESET ROLE;`,
);
assert.equal(await finish(job), "superseded");
await confirmNext();
assert.equal((await rows("SELECT enqueue_due_matching_jobs() AS count"))[0].count, 1);
job = await claim();
assert.equal(await finish(job, "matching_input_or_evidence_invalid"), "failed");
assert.equal(
  (await rows("SELECT enqueue_due_matching_jobs() AS count"))[0].count,
  0,
  "failed jobs back off",
);
await db.exec(
  `UPDATE matching_jobs SET completed_at=now()-interval '6 minutes' WHERE status='failed'`,
);
assert.equal((await rows("SELECT enqueue_due_matching_jobs() AS count"))[0].count, 1);
job = await claim();
await db.query(
  "UPDATE matching_jobs SET attempts=3,started_at=now()-interval '6 minutes' WHERE id=$1",
  [job.id],
);
assert.equal(await claim(), null);
assert.equal(
  (await rows("SELECT status FROM matching_jobs WHERE id=$1", [job.id]))[0].status,
  "failed",
);
await assert.rejects(db.exec("UPDATE audit_log SET details='{}'"));
await assert.rejects(db.exec("DELETE FROM matching_kb_releases"));
await db.exec("SET ROLE service_role");
await db.query("SELECT publish_matching_kb_release($1)", [
  { schema_version: "matching-kb.v1", items: [] },
]);
await db.exec("RESET ROLE");
console.log(
  "PASS: matching migrations, confirmed profiles, due schedule, idempotency, owner isolation, service-only RPCs, privacy allowlist, stale profiles/unlink, lease recovery, failures/backoff, immutable KB and append-only audit",
);
await db.close();
