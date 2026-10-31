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
  "0004_hospital_portal",
])
  await db.exec(await readFile(`drizzle/migrations/${name}.sql`, "utf8"));
const doctor = "00000000-0000-0000-0000-000000000001";
const otherDoctor = "00000000-0000-0000-0000-000000000002";
const staff = "00000000-0000-0000-0000-000000000003";
const outsider = "00000000-0000-0000-0000-000000000004";
const hospital = "20000000-0000-0000-0000-000000000001";
const otherHospital = "20000000-0000-0000-0000-000000000002";
const id = "10000000-0000-0000-0000-000000000001";
const id2 = "10000000-0000-0000-0000-000000000002";
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const login = async (user) =>
  db.exec(
    `RESET ROLE;SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${user}',false)`,
  );
const sync = async (payload, request = id, expected = null) =>
  (
    await rows("SELECT public.hospital_sync_patient_context($1,$2,$3,$4) AS result", [
      payload,
      "aggregate_json",
      request,
      expected,
    ])
  )[0].result;
const directory = async () =>
  (await rows("SELECT public.hospital_directory() AS result"))[0].result;
const payload = {
  doctor_id_code: "DR-1001",
  synced_at: "2026-10-30T09:00:00Z",
  panel_size: 180,
  min_cell_size: 5,
  aggregates: { NSCLC: 85, "KRAS G12C": 12, "ALK-positive": null },
};
await db.exec(`INSERT INTO auth.users VALUES ('${doctor}'),('${otherDoctor}'),('${staff}'),('${outsider}');
UPDATE public.doctors SET onboarding_complete=true WHERE id IN ('${doctor}','${otherDoctor}');
INSERT INTO public.hospitals(id,name) VALUES ('${hospital}','Test hospital'),('${otherHospital}','Other hospital');
INSERT INTO public.hospital_staff VALUES ('${staff}','${hospital}'),('${outsider}','${otherHospital}');
INSERT INTO public.hospital_doctor_links VALUES ('${hospital}','DR-1001','${doctor}');`);
await login(doctor);
await db.query("SELECT public.link_patient_data('DR-1001',true)");
await assert.rejects(sync(payload)); // doctors cannot act as staff
await assert.rejects(
  db.query("SELECT public.sync_patient_context($1,true,$2,$3,NULL)", [
    payload,
    "aggregate_json",
    id,
  ]),
); // old upload endpoint disabled
await assert.rejects(
  db.query("SELECT public.hospital_write_patient_context($1,$2,$3,$4,true,$5,$6,NULL)", [
    doctor,
    staff,
    hospital,
    payload,
    "aggregate_json",
    id,
  ]),
);
assert.equal((await directory()).authorized, false);
await login(staff);
let result = await directory();
assert.equal(result.doctors.length, 1);
assert.equal(result.doctors[0].doctor_id_code, "DR-1001");
await assert.rejects(sync({ ...payload, doctor_id_code: "DR-OTHER" }));
await assert.rejects(
  db.query("INSERT INTO public.hospital_staff VALUES ($1,$2)", [doctor, hospital]),
);
await assert.rejects(sync({ ...payload, patients: [] }));
await assert.rejects(sync({ ...payload, aggregates: { NSCLC: 150 } }));
const saved = await sync(payload);
assert.equal(saved.id, id);
assert.equal((await sync(payload)).id, id);
result = await directory();
assert.equal(result.doctors[0].context.id, id);
assert.equal(result.doctors[0].profile.status, "queued");
assert.equal(result.doctors[0].history.length, 1);
await assert.rejects(sync({ ...payload, aggregates: { NSCLC: 80 } }, id2, null));
await login(outsider);
assert.equal((await directory()).doctors.length, 0);
await assert.rejects(sync(payload));
await login(otherDoctor);
await db.query("SELECT public.link_patient_data('DR-1001',true)");
assert.equal(
  (await rows("SELECT public.read_patient_context() AS result"))[0].result.id,
  undefined,
); // same code doesn't leak hospital upload
await login(doctor);
assert.equal((await rows("SELECT public.read_patient_context() AS result"))[0].result.id, id);
await db.query("SELECT public.unlink_patient_data()");
await login(staff);
assert.equal((await directory()).doctors[0].linked, false);
await assert.rejects(sync(payload, id2, id));
await login(doctor);
await db.query("SELECT public.link_patient_data('DR-1001',true)");
await login(staff);
assert.equal((await directory()).doctors[0].context.id, undefined); // renewed consent cannot reactivate upload
await sync(payload, id2);
await db.exec("RESET ROLE");
const [audit] = await rows(
  "SELECT * FROM public.audit_log WHERE action='patient_data_synced' ORDER BY created_at DESC LIMIT 1",
);
assert.equal(audit.doctor, doctor);
assert.equal(audit.details.hospital_actor, staff);
assert.equal(audit.details.hospital_id, hospital);
assert.equal(
  (
    await rows("SELECT count(*)::int AS n FROM public.audit_log WHERE action='patient_data_synced'")
  )[0].n,
  2,
);
assert.equal(
  (
    await rows(
      "SELECT count(*)::int AS n FROM public.doctor_profile_jobs WHERE doctor=$1 AND status='queued'",
      [doctor],
    )
  )[0].n,
  1,
);
await assert.rejects(db.exec("UPDATE public.patient_sync_snapshots SET panel_size=200"));
console.log(
  "PASS: hospital staff auth, assigned-doctor scope, doctor RPC retirement, per-account isolation, consent/revocation, idempotency, validation, queueing, actor audit and immutable history",
);
await db.close();
