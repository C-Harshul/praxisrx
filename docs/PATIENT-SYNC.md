> Packaging status, 31 October 2026: see [current component architecture](architecture/hospital-patient-sync.md) and [local setup](demo/setup.md). Current runtime/setup takes precedence over historical baseline paragraphs. Shared project documents are bundled in this repository for isolated checkout.

# Hospital portal and patient-data sync

## Inference hosting policy

Reread the updated root/repository `AGENTS.md` and shared data-platform decision. Hospital upload handlers do not invoke an LLM; they persist the independent profile job. Any downstream inference must use the shared verified-hosting gate, not an external provider or a Databricks external-model/proxy route. Earlier Gemini references in the historical baseline are superseded.

Read-only inspection in the designated workspace verified endpoint `databricks-gpt-oss-20b`: `llm/v1/chat`, READY, NOT_UPDATING, configuration version 1, one served entity `system.ai.gpt-oss-20b` and no external-model or fallback configuration. Official Databricks documentation lists GPT OSS 20B as Databricks-hosted inference: https://docs.databricks.com/aws/en/machine-learning/model-serving/foundation-model-overview . A developer's model brand alone does not determine where inference is hosted.

The shared `model-hosting.server.ts` rechecks endpoint/model identity, readiness/configuration and routing before invocation, blocks provider/external/fallback configurations and HTTP redirects, and records hosting provenance through the profiling worker audit. Unverified or unavailable hosting fails explicitly; there is no external fallback. New inference workloads require their own hosting/capability verification before reuse. This verification inspected configuration without invoking a model. Current full unit suite: 79 passed; TypeScript and targeted policy/adapter lint passed.

## Current canonical upload path

Hospital uploads now publish directly to Databricks workspace `7474660613250664` at `https://dbc-85372395-9d08.cloud.databricks.com`. The shared platform code provides the authenticated canonical store; this workstream adds an explicit hospital publication boundary and receipt. The earlier Supabase/simulation setup below is historical and does not describe the active server path.

Verified using the authorized Databricks CLI profile and APIs: catalog `workspace`, schema `msl_demo`, Delta table `workspace.msl_demo.app_state`, and SQL warehouse `bccde8ce8d366533`. The shared setup provisioned the schema/table; this chat verified them and successfully read the two canonical synthetic doctor records. At verification both DR-1001 and DR-1002 were unlinked and had no uploaded patient mix. No consent was fabricated and no hospital patient snapshot was written in this live check. Current committed source revisions come from the table's `revision` column; no fixed revision is assumed in documentation.

The active writer is the authenticated hospital application backend. It writes a validated, versioned aggregate snapshot, a queued fresh profiling version, and an append-only audit event in a **single compare-and-swap update of the doctor's canonical Delta document**. There is no separate local/Supabase acceptance or second authoritative copy. The existing asynchronous profiler consumes the persisted queue; the upload handler does not call an LLM or matcher. Databricks remains the canonical read source.

`publication.server.ts` performs a fresh canonical consent/assignment/onboarding/code check after directory lookup, rejects ambiguous duplicate mappings, validates source timestamps and snapshot expectations, and commits through the shared `commitDoctor` adapter. That adapter requires a successful SQL statement and exactly one affected row. Publication metadata `hospital-publication.v1` is stored alongside each new aggregate snapshot: `status`, designated workspace ID/URL, canonical doctor record ID, snapshot ID, and hospital actor ID. HTTP success adds `canonical_revision`, acknowledging the exact committed document revision. The snapshot's own ID/version remain stable as later profiling changes the document revision.

The portal button says **Publish to Databricks**, displays the destination, shows the unconfirmed/in-progress request, and reports publication plus its revision only after acknowledgment. If a commit times out or fails, the server returns HTTP 503 with publication explicitly unconfirmed. A timeout may have committed: refreshing and retrying the **same request UUID** checks canonical history and returns the existing snapshot without another write, audit event or profiling job. Raw files/individual patient rows are never silently saved elsewhere as a fallback. The current application publishes approved patient aggregates; this change does not implement raw-patient ingestion into separate hospital processing tables.

## Current local use and prerequisites

The verified configured local origin is `http://localhost:8081`; open `/hospital` there. Sign in with the provisioned hospital test account; generated credentials are kept only in the ignored `demo-credentials.local` file. The doctor must first sign in to their own portal, link their assigned code and consent. Staff cannot grant consent. Once linked, hospital staff select the assigned doctor, load the aggregate JSON or the supplied synthetic CSV, review/authorize the aggregate panel and publish it. CSV rows are reduced to the allowlisted aggregates in the browser. Matching still waits for the doctor to confirm the newly generated profile.

Server setup is now the shared Databricks app configuration, not the historical Supabase configuration. `DATABRICKS_HOST`, `DATABRICKS_WAREHOUSE_ID`, `DATABRICKS_APP_TABLE` and server-only authentication identify this canonical store. Local authorized CLI access uses `DATABRICKS_AUTH_PROFILE=msl-canonical`; hosted deployments require their supported server credential setup. Session/account/origin settings and profiler model/cron configuration are owned by the shared platform workstream. Never copy secrets into browser code or docs. The current route has no unauthenticated simulation fallback. `simulation.server.ts` is an isolated test fixture and does not publish anything.

Revocation and assignment edits serialize against the upload through canonical document revisions. A stale upload must fail compare-and-swap rather than overwrite a current denial. Upload failure does not make any local profile current. Existing baseline Supabase migrations are retained; applying them is no longer the way to connect this active Databricks path.

## Current verification

- Live read-only CLI/API checks verified the designated workspace, warehouse/table and unlinked synthetic doctors. Unauthenticated GET at the configured local `/api/hospital` returned a valid staff-sign-in response. No console automation, live consent changes or patient upload was performed.
- New canonical publisher tests cover atomic snapshot/profile/audit contents, acknowledged receipts, idempotent retries, ambiguous committed responses, Databricks failures without local fallback, current consent, unauthorized/duplicate mappings and rejection of raw fields.
- Hospital UI tests ensure no published-success message appears until the canonical response resolves, then display the publication revision. All 56 current unit tests, TypeScript, targeted ESLint and production build pass. These tests use explicitly injected store fixtures, not a claimed live upload.

## Historical baseline (superseded setup and integration details)

The sections below retain the original local simulation and Supabase migration history for reference. The active path, setup and verification are defined above.

The user clarified that the hospital uploads patient panels, not the doctor. `/hospital` is a separate portal with its own navigation, staff authentication, doctor directory, upload screen, activity and profile-status views. It shares the application deployment and backend contracts with the doctor application. The doctor portal has no upload controls; `/patient-sync` redirects to `/hospital` for old bookmarks.

## Try it locally

Run `npm run dev`, open the printed origin followed by `/hospital`, choose DR-1001, and click **Use demo patient panel**, or choose the supplied aggregate JSON. For the supplied synthetic CSV, check the synthetic-only checkbox before selecting the file. Review the aggregate preview, authorize the panel and click **Sync to doctor profile**.

Local development defaults to an **isolated synthetic simulation**. It needs no hospital/doctor login, hosted migrations or Gemini. It saves temporary aggregate snapshots in server memory, queues a synthetic profile version, and an independent timer advances queued → processing → succeeded. The portal polls and displays the new profile version/current context and an activity entry. The new profile is labeled awaiting doctor review; hospital staff cannot approve it. State resets on restart or development module reload. This simulator neither calls Gemini nor updates any connected doctor account. Its status is clearly labeled throughout the UI.

Set `HOSPITAL_SYNC_MODE=connected` in the local server environment and restart to use the real integration described below. Production always uses connected authorization; the unauthenticated simulator is development-only.

## Connected mode

1. Apply `0000_migration.sql` through `0004_hospital_portal.sql` in order using the project's deployment migration workflow. Keep the Drizzle journal/migration ledger consistent. Do not generate migrations from the blank `drizzle/schema.ts`.
2. Configure the existing browser-safe and server Supabase settings in `.env.example`. Server-only service/Gemini/cron secrets remain required for the existing independent workers. Never expose them as VITE variables.
3. Create a staff account through your trusted identity/admin workflow. Staff authenticate at `/hospital` using a separate `msl-hospital-staff` browser session; a doctor's login/session does not grant staff access or get replaced by hospital login.
4. As a trusted administrator, create a `hospitals` row, a `hospital_staff(user_id,hospital_id)` membership, and `hospital_doctor_links(hospital_id,doctor_id_code,doctor)` mappings to the exact doctor auth UUIDs. These are admin-only tables, not self-service role claims. One doctor is assigned to one hospital in this demo schema. Do not bind an arbitrary account merely because it types a known code.
5. The doctor completes onboarding and links the same doctor ID with consent in the doctor portal. The hospital directory shows an inactive link until that is done. Hospital staff cannot give or renew the doctor's consent.
6. Sign into the hospital portal with the provisioned staff account, select an assigned doctor and sync a panel. The upload immediately saves aggregate context and queues a fresh profiling job for that mapped doctor UUID. Configure the POST profiling/matching schedulers as documented in `DOCTOR-PROFILING.md` and `MATCHING.md` to process jobs in the background.
7. The doctor reviews/confirms the new profile in their existing portal. Matching resumes against that confirmed profile plus current consented hospital aggregate snapshot. Hospital staff can see status; they cannot confirm on the doctor's behalf.

No hosted schema changes, staff grants, provider calls, scheduling, deployment or GitHub pushes have been performed by this workstream.

## Authorization and datastore boundaries

- `hospitals`, `hospital_staff`, `hospital_doctor_links`: RLS enabled, no direct doctor/staff writes or reads. Trusted service/admin provisioning only.
- `hospital_directory()`: authenticated hospital staff directory; only mapped doctors and that hospital's upload history. Nonstaff get an unauthorized/empty response. No global doctor-code lookup or account enumeration.
- `hospital_sync_patient_context(payload, source_kind, request_id, expected_id)`: verifies staff membership, assigned doctor code, the doctor's current consent/onboarding/link, then writes context through a private helper under a doctor lock. It cannot target arbitrary doctor UUIDs supplied by a browser.
- `hospital_write_patient_context(...)`: private SECURITY DEFINER helper; no PUBLIC/anon/authenticated execute. Shares the prior upload's strict SQL validation, optimistic concurrency, retry, timestamp and immutable snapshot semantics. The original doctor-upload `sync_patient_context` RPC is revoked from authenticated users by migration 0004.
- `/api/hospital`: same-origin GET/POST adapter. Connected requests forward only the staff session to Supabase; membership is checked in SQL. No service-role key is sent to the browser. POST rejects other origins and oversized aggregate payloads. Local simulation uses the same validated frontend contract.
- All UI reads/writes stay behind `src/lib/msl/api.ts`, with query definitions in `queries.ts`.

Each accepted connected sync **transactionally** saves a per-doctor immutable snapshot, appends `patient_data_synced` including hospital/staff actor provenance and snapshot/version IDs, and enqueues/supersedes profiling. Snapshots add `hospital_actor` and `hospital_id` in migration 0004. Uploads never overwrite the shared DR-1001 demo row. A second account linked to the same demo code does not receive the first account's hospital upload.

A client UUID makes retries idempotent, without duplicate snapshot, audit or profile job. The preview pins the current snapshot ID; conflicting writes require a refreshed preview. Older export timestamps cannot replace newer uploaded context. The latest 20 hospital uploads appear in activity, with all versions retained in aggregate storage.

Unlink stops reads/use and future hospital uploads. Relinking requires renewed doctor consent and cannot reactivate older uploaded snapshots. Immutable aggregate history remains for audit; unlink is revocation of use, not deletion. Account deletion/retention management is not implemented.

## Patient-data contract and privacy

`src/lib/msl/patient-sync/contract.ts` accepts the supplied aggregate JSON and synthetic lung-panel CSV. The Python generator is reference code, not executable upload input.

```json
{
  "doctor_id_code": "DR-1001",
  "synced_at": "2026-10-30T09:00:00Z",
  "panel_size": 180,
  "min_cell_size": 5,
  "aggregates": { "NSCLC": 85, "KRAS G12C": 12, "ALK-positive": null }
}
```

Files are limited to 5 MB. CSV is processed entirely in the browser, with no individual rows/files/names/free-text fields in network upload payloads, app tables, audit or model prompts. Only the known synthetic header/category vocabulary, a single doctor code and unique SYN-prefixed patient IDs are supported. This is an EHR simulation, not a general production EHR or de-identification importer. CSV has a 50,000-row bound and supports quoted commas/newlines.

CSV counts 1–4 are suppressed before conversion. JSON declares a minimum cell threshold >=5; percentages that cannot represent that threshold under whole-percent rounding are rejected. Unknown keys and extra fields fail in both frontend and SQL. Aggregate uploads cannot independently certify source counts, anonymization or complementary suppression; those remain the exporter's responsibility.

The denominator is the whole active panel (`active_panel.v1`). Categories overlap; never sum them or multiply marginals to infer intersection sizes. Null means suppressed/unknown, zero means a known absent observed category. The matching adapter omits nulls to preserve unknown. A whole-panel denominator does not establish full trial eligibility; existing matching continues to emit cohort relevance, with exact `applicability_percent` null.

`synthetic-lung-cohorts.v1` reproduces the supplied generator's definitions: NSCLC/SCLC, observed EGFR mutation, prior osimertinib in NSCLC, MET amplification/overexpression in that group, observed KRAS G12C/ALK positivity, observed PD-L1 >=50 or zero, extensive-stage SCLC with maintenance marker, and Stage IV including IV/Extensive. These are cohort labels, not complete evidence eligibility definitions. The chemo-IO category follows the generator's maintenance marker rather than independently verifying trial regimen criteria. The supplied 180-row CSV reproduces all 11 supplied JSON percentages.

## Profiling, matching and newsletter handoff

The real matching profile is the composite of a **current confirmed generated doctor profile plus current consented patient aggregate snapshot**. It is not limited to the fields rendered on My profile. Every connected hospital sync invalidates previous current/confirmed profiling versions immediately and queues a fresh version. The existing independent Gemini worker consumes stated doctor answers, excluding patient statistics. Hospital sync does not invoke Gemini, matching or newsletter generation directly.

Migration 0003's current-matching-input adapter is unchanged by hospital transport: it pins the immutable snapshot's server receipt timestamp and numeric aggregate content. Snapshot ID/version, source/export timestamp, panel size, minimum cell size, denominator/cohort-definition versions and hospital/staff actor remain in storage/audit. Missing/suppressed populations remain unknown.

Until the new profile is confirmed by the doctor, matching defers. After confirmation, the new profile identity/mix snapshot makes a match due. Existing completion/current-result checks discard stale results. The newsletter worker still owns atomic current-input validation at publication as specified in `MATCHING.md`.

## Verification

- `npm test`: aggregate parsing/suppression, hospital UI preview/authorization, independent staff sign-in surface, simulation lifecycle/idempotency/isolation, plus existing profiling/matching suites.
- `npm run test:hospital-db`: isolated embedded Postgres, all five migrations; hospital/doctor account separation, assigned-doctor scope, retired doctor-upload RPC, private helper protection, consent/unlink/relink, validation, idempotency, account isolation, queueing, actor audit and immutable history.
- `npm run test:profiling-db` and `npm run test:matching-db`: existing regressions with all five migrations.
- `npm run test:patient-sync-db`: historical migration-0003 upload validation checks before hospital authorization is applied; final authorization is tested by `test:hospital-db`.
- TypeScript, targeted ESLint, production build and local browser demo sync. These checks do not claim a hosted EHR connection, live doctor update or Gemini run.
