import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;`);
for (const name of [
  "0000_migration",
  "0001_doctor_profiling",
  "0002_matching",
  "0003_patient_sync",
])
  await db.exec(await readFile(`drizzle/migrations/${name}.sql`, "utf8"));
const owner = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const request = "10000000-0000-0000-0000-000000000001";
const request2 = "10000000-0000-0000-0000-000000000002";
const request3 = "10000000-0000-0000-0000-000000000003";
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const rpc = async (payload, expected = null, id = request, consent = true) =>
  (
    await rows("SELECT public.sync_patient_context($1,$2,$3,$4,$5) AS result", [
      payload,
      consent,
      "aggregate_json",
      id,
      expected,
    ])
  )[0].result;
const login = async (id) =>
  db.exec(
    `RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',false)`,
  );
const context = async () =>
  (await rows("SELECT public.read_patient_context() AS result"))[0].result;
const payload = {
  doctor_id_code: "DR-1001",
  synced_at: "2026-10-30T09:00:00Z",
  panel_size: 180,
  min_cell_size: 5,
  aggregates: { NSCLC: 85, SCLC: 15, "KRAS G12C": 12, "ALK-positive": null, "Post-osimertinib": 0 },
};
await db.exec(
  `INSERT INTO auth.users VALUES ('${owner}'),('${other}'); UPDATE public.doctors SET onboarding_complete=true;`,
);
await login(owner);
await assert.rejects(rpc(payload)); // no linked consent
await db.query("SELECT public.link_patient_data('DR-1001',true)");
await assert.rejects(rpc(payload, null, request, false));
await assert.rejects(rpc({ ...payload, doctor_id_code: "DR-OTHER" }));
await assert.rejects(rpc({ ...payload, patient_records: [] }));
await assert.rejects(rpc({ ...payload, aggregates: { "Free text patient name": 12 } }));
await assert.rejects(rpc({ ...payload, aggregates: { NSCLC: "85" } }));
await assert.rejects(rpc({ ...payload, aggregates: { NSCLC: 101 } }));
await assert.rejects(rpc({ ...payload, aggregates: { NSCLC: 1 } }));
await assert.rejects(rpc({ ...payload, panel_size: 180.5 }));
await assert.rejects(rpc({ ...payload, min_cell_size: 4 }));
await assert.rejects(rpc({ ...payload, synced_at: "2099-01-01T00:00:00Z" }));
const saved = await rpc(payload);
assert.equal(saved.id, request);
assert.equal((await context()).id, request);
assert.equal((await rpc(payload)).id, request); // retry is idempotent
await assert.rejects(rpc({ ...payload, aggregates: { NSCLC: 80 } })); // conflicting request ID
assert.equal((await rows("SELECT count(*)::int AS n FROM public.patient_sync_snapshots"))[0].n, 1);
await login(other);
assert.equal((await rows("SELECT * FROM public.patient_sync_snapshots")).length, 0);
await db.query("SELECT public.link_patient_data('DR-1001',true)");
assert.equal((await context()).id, undefined); // shared demo code doesn't share upload
await assert.rejects(rpc(payload, null, request));
await assert.rejects(
  db.query("INSERT INTO public.patient_sync_snapshots(id,doctor) VALUES ($1,$2)", [
    request2,
    other,
  ]),
);
await assert.rejects(db.query("SELECT public.current_patient_context($1)", [owner]));
await login(owner);
await assert.rejects(rpc(payload, null, request2)); // stale preview
await assert.rejects(rpc({ ...payload, synced_at: "2026-10-29T00:00:00Z" }, request, request2));
const second = await rpc({ ...payload, aggregates: { NSCLC: 80 } }, request, request2);
assert.ok(second.version > saved.version);
const jobs = await rows("SELECT * FROM public.doctor_profile_jobs ORDER BY version DESC");
assert.equal(jobs.filter((j) => j.status === "queued").length, 1);
assert.equal(jobs[0].input.patient_mix, undefined); // no patient data in Gemini input
await db.exec("RESET ROLE");
let [job] = await rows("SELECT * FROM public.claim_doctor_profile_job()");
while (job.doctor !== owner) {
  await db.query("SELECT public.finish_doctor_profile_job($1,$2,NULL,$3,$4,$5,$6)", [
    job.id,
    job.lease_token,
    "test_skip",
    "test",
    "test",
    "doctor-profile.v1",
  ]);
  [job] = await rows("SELECT * FROM public.claim_doctor_profile_job()");
}
await db.query("SELECT public.finish_doctor_profile_job($1,$2,$3,NULL,$4,$5,$6)", [
  job.id,
  job.lease_token,
  { stated: job.input, suggested_focus: [] },
  "test",
  "test",
  "doctor-profile.v1",
]);
await login(owner);
await db.query("SELECT public.confirm_doctor_profile($1,$2)", [job.id, []]);
await db.exec("RESET ROLE");
let input = (await rows("SELECT public.current_matching_input($1) AS result", [owner]))[0].result;
assert.deepEqual(input.patient_mix.aggregates, { NSCLC: 80 });
await login(owner);
await rpc(payload, request2, request3);
await db.exec("RESET ROLE");
input = (await rows("SELECT public.current_matching_input($1) AS result", [owner]))[0].result;
assert.equal(input, null); // new sync invalidates old confirmed profile immediately
await login(owner);
await db.query("SELECT public.unlink_patient_data()");
assert.equal(await context(), null);
await assert.rejects(rpc(payload, request3, "10000000-0000-0000-0000-000000000004"));
await db.query("SELECT public.link_patient_data('DR-1001',true)");
assert.equal((await context()).id, undefined); // old uploads stay revoked
await db.exec("RESET ROLE");
await assert.rejects(db.exec("UPDATE public.patient_sync_snapshots SET panel_size=200"));
await assert.rejects(db.exec("DELETE FROM public.patient_sync_snapshots"));
await assert.rejects(db.exec("TRUNCATE public.patient_sync_snapshots"));
assert.equal(
  (
    await rows("SELECT count(*)::int AS n FROM public.audit_log WHERE action='patient_data_synced'")
  )[0].n,
  3,
);
console.log(
  "PASS: upload validation, consent, per-account isolation, idempotency, stale-preview protection, immutable history, reprofile, matching invalidation and revocation",
);
await db.close();
