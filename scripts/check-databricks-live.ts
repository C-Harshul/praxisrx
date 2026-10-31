import { executeSql } from "../src/integrations/databricks/sql.server";
import { listRecords } from "../src/lib/msl/platform/store.server";
import type { DoctorState } from "../src/lib/msl/platform/types";
import { runProfilingJob } from "../src/lib/msl/profiling/worker.server";
const connected = await executeSql("SELECT current_catalog(), current_schema()");
console.log("Canonical SQL connection verified.", connected.rows);
console.log("Profiling worker:", await runProfilingJob());
const records = await listRecords<DoctorState>("doctor");
console.log(
  records.map((r) => ({
    profile_version: r.state.profiles.at(-1)?.version,
    status: r.state.profiles.at(-1)?.status,
    model: r.state.profiles.at(-1)?.model,
    audit_events: r.state.audit.length,
  })),
);
