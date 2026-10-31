import assert from "node:assert/strict";
import { listRecords, commitDoctor, readRecord, audit } from "../src/lib/msl/platform/store.server";
import type { DoctorState } from "../src/lib/msl/platform/types";
const records = await listRecords<DoctorState>("doctor");
const before = records[0]!;
const next = structuredClone(before.state);
audit(next, "automated-synthetic-smoke-check", "canonical_write_verified", {
  synthetic: true,
  purpose: "Verify live revision CAS; no consent or clinical preference changed",
});
const revision = await commitDoctor(before, next);
const current = await readRecord<DoctorState>("doctor", before.id);
assert.equal(current?.revision, revision);
assert.equal(current?.state.audit.at(-1)?.action, "canonical_write_verified");
await assert.rejects(commitDoctor(before, next), /changed/);
console.log("PASS: live atomic state/audit commit and stale-revision rejection.");
