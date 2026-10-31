import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;`);
for (const migration of ["0000_migration.sql", "0001_doctor_profiling.sql", "0002_matching.sql", "0003_patient_sync.sql", "0004_hospital_portal.sql"]) {
  await db.exec(await readFile(`${process.cwd()}/drizzle/migrations/${migration}`, "utf8"));
}
const id = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
await db.exec(
  `INSERT INTO auth.users VALUES ('${id}'),('${other}'); UPDATE public.doctors SET specialty='Medical oncology',cancer_types=ARRAY['Lung'],topics=ARRAY['Immunotherapy'],onboarding_complete=true WHERE id='${id}';`,
);
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
let [job] = await rows("SELECT * FROM public.claim_doctor_profile_job()");
assert.equal(job.status, "processing");
const output = {
  stated: job.input,
  suggested_focus: [{ cancer_type: "Lung", topic: "Immunotherapy" }],
};
const finish = async (j, result = output, error = null) =>
  (
    await rows("SELECT public.finish_doctor_profile_job($1,$2,$3,$4,$5,$6,$7) AS status", [
      j.id,
      j.lease_token,
      result,
      error,
      "test-model",
      "test-prompt",
      "doctor-profile.v1",
    ])
  )[0].status;
assert.equal(await finish(job), "succeeded");
await db.exec(
  `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${other}',false);`,
);
assert.equal((await rows("SELECT * FROM public.doctor_profile_jobs")).length, 0);
await assert.rejects(db.query("SELECT public.confirm_doctor_profile($1,$2)", [job.id, []]));
await assert.rejects(db.query("SELECT public.claim_doctor_profile_job()"));
await assert.rejects(
  db.query("INSERT INTO public.doctor_profile_jobs(doctor,input) VALUES ($1,$2)", [other, {}]),
);
await db.exec(`SELECT set_config('request.jwt.claim.sub','${id}',false);`);
assert.equal((await rows("SELECT * FROM public.doctor_profile_jobs")).length, 1);
await assert.rejects(db.query("SELECT public.confirm_doctor_profile($1,$2)", [job.id, [{}]]));
await db.query("SELECT public.confirm_doctor_profile($1,$2)", [job.id, []]);
assert.deepEqual(
  (await rows("SELECT reviewed_focus FROM public.doctor_profile_jobs"))[0].reviewed_focus,
  [],
);
await db.exec(
  `RESET ROLE; UPDATE public.doctors SET topics=ARRAY['Targeted therapy'] WHERE id='${id}';`,
);
assert.equal(
  (await rows("SELECT status FROM public.doctor_profile_jobs WHERE id=$1", [job.id]))[0].status,
  "superseded",
);
[job] = await rows("SELECT * FROM public.claim_doctor_profile_job()");
await db.exec(
  `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',false); SELECT public.link_patient_data('DR-1001',true); SELECT public.unlink_patient_data(); RESET ROLE;`,
);
assert.equal(await finish(job), "superseded");
assert.equal(
  (
    await rows(
      "SELECT count(*)::int AS count FROM public.doctor_profile_jobs WHERE status='queued'",
    )
  )[0].count,
  1,
);
[job] = await rows("SELECT * FROM public.claim_doctor_profile_job()");
assert.equal(await finish(job, null, "test_failure"), "failed");
await db.exec(
  `UPDATE public.doctor_profile_jobs SET created_at=now()-interval '2 minutes' WHERE id='${job.id}'; SET ROLE authenticated; SELECT public.retry_doctor_profile(); RESET ROLE;`,
);
[job] = await rows("SELECT * FROM public.claim_doctor_profile_job()");
await db.exec(
  `UPDATE public.doctor_profile_jobs SET started_at=now()-interval '6 minutes' WHERE id='${job.id}';`,
);
const [reclaimed] = await rows("SELECT * FROM public.claim_doctor_profile_job()");
assert.equal(reclaimed.attempts, 2);
assert.notEqual(reclaimed.lease_token, job.lease_token);
assert.equal(await finish(job), "superseded");
assert.equal(
  await finish(reclaimed, { stated: reclaimed.input, suggested_focus: [] }),
  "succeeded",
);
await assert.rejects(db.exec("UPDATE public.audit_log SET details='{}'"));
await assert.rejects(db.exec("DELETE FROM public.audit_log"));
await db.exec(`UPDATE public.patient_mix SET synced_at=now() WHERE doctor_id_code='DR-1001';`);
assert.equal(
  (
    await rows(
      "SELECT count(*)::int AS count FROM public.doctor_profile_jobs WHERE status='queued'",
    )
  )[0].count,
  0,
);
await db.exec(
  `SET ROLE authenticated; SELECT public.link_patient_data('DR-1001',true); RESET ROLE;`,
);
const before = (await rows("SELECT count(*)::int AS count FROM public.doctor_profile_jobs"))[0]
  .count;
await db.exec(`UPDATE public.patient_mix SET synced_at=now() WHERE doctor_id_code='DR-1001';`);
assert.equal(
  (await rows("SELECT count(*)::int AS count FROM public.doctor_profile_jobs"))[0].count,
  before + 1,
);
console.log(
  "PASS: migrations, RLS isolation, service-only writes/claims, doctor review, stale results, unlink, retry, lease recovery, sync triggers, append-only audit",
);
await db.close();
