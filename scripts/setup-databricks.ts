import { randomUUID } from "node:crypto";
import { executeSql, databricksConfig } from "../src/integrations/databricks/sql.server";
import type { DoctorState } from "../src/lib/msl/platform/types";
import { queueProfile } from "../src/lib/msl/platform/profile-state";
const { table } = databricksConfig();
if (table !== "workspace.msl_demo.app_state")
  throw new Error("Review setup SQL before provisioning a different namespace.");
await executeSql(
  "CREATE SCHEMA IF NOT EXISTS workspace.msl_demo COMMENT 'MSL synthetic app domain data; canonical workspace 7474660613250664'",
);
await executeSql(`CREATE TABLE IF NOT EXISTS ${table} (
  record_type STRING NOT NULL, id STRING NOT NULL, revision STRING NOT NULL, payload STRING NOT NULL, updated_at TIMESTAMP NOT NULL
) USING DELTA TBLPROPERTIES ('delta.isolationLevel'='Serializable', 'delta.enableChangeDataFeed'='true')`);
const accounts: { id: string; email: string; role: string }[] = JSON.parse(
  process.env["APP_ACCOUNTS_JSON"] ?? "[]",
);
const hospital = accounts.find((a) => a.role === "hospital");
if (!hospital) throw new Error("Provision a hospital account in server configuration first.");
const doctors = accounts.filter((a) => a.role === "doctor");
for (let index = 0; index < doctors.length; index++) {
  const account = doctors[index]!;
  const now = new Date().toISOString();
  const state: DoctorState = {
    schema_version: "msl-app-state.v1",
    assigned_code: `DR-${1001 + index}`,
    hospital_ids: [hospital.id],
    doctor: {
      id: account.id,
      full_name: index === 0 ? "Dr. Ananya Rao" : "Dr. Maya Chen",
      years_in_practice: index === 0 ? 14 : 8,
      practice_setting: "Community cancer centre",
      specialty: "Medical oncology",
      cancer_types: [index === 0 ? "Lung" : "Breast"],
      topics:
        index === 0
          ? ["Targeted therapy", "Immunotherapy", "Antibody-drug conjugates"]
          : ["Clinical trials", "Guidelines"],
      preferred_format: "Written",
      frequency: "Weekly",
      doctor_id_code: null,
      patient_data_linked: false,
      consent_given_at: null,
      onboarding_complete: true,
      created_at: now,
      updated_at: now,
    },
    patient_mix: null,
    sync_history: [],
    profiles: [],
    matching_runs: [],
    newsletters: [],
    bookmarks: [],
    audit: [
      {
        id: randomUUID(),
        actor: "synthetic-setup",
        action: "synthetic_fixture_provisioned",
        created_at: now,
        details: {
          synthetic: true,
          consent: false,
          source: "explicit synthetic demo fixture; not doctor-entered onboarding",
        },
      },
    ],
  };
  queueProfile(state, randomUUID, now);
  // Single administrative bootstrap writer. Never invoked from a browser request.
  await executeSql(
    `MERGE INTO ${table} target USING (SELECT :id AS id) source
    ON target.record_type='doctor' AND target.id=source.id
    WHEN NOT MATCHED THEN INSERT (record_type,id,revision,payload,updated_at) VALUES ('doctor',source.id,:revision,:payload,current_timestamp())`,
    [
      { name: "id", value: account.id },
      { name: "revision", value: randomUUID() },
      { name: "payload", value: JSON.stringify(state) },
    ],
  );
}
for (const [name, field] of [["doctor_profiles", "profiles"], ["doctor_patient_context", "patient_mix"], ["doctor_audit_history", "audit"], ["doctor_matching_runs", "matching_runs"], ["doctor_newsletters", "newsletters"]]) {
  await executeSql(`CREATE OR REPLACE VIEW workspace.msl_demo.${name} AS SELECT id AS doctor_id, revision AS canonical_revision, updated_at, get_json_object(payload, '$.${field}') AS data_json FROM ${table} WHERE record_type='doctor'`);
}
const verify = await executeSql(
  `SELECT record_type, count(*) AS records FROM ${table} GROUP BY record_type`,
);
console.log(
  JSON.stringify({
    table,
    records: verify.rows,
    message: "Synthetic setup complete; existing records were preserved.",
  }),
);
