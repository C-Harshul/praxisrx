> Packaging status, 31 October 2026: see [current component architecture](architecture/doctor-profiling.md) and [local setup](demo/setup.md). Current runtime/setup takes precedence over historical baseline paragraphs. Shared project documents are bundled in this repository for isolated checkout.

# Doctor profiling on Databricks

The active application no longer uses Supabase or Gemini. All domain reads/writes go through the app server to the designated Databricks workspace. The old provider source and original profiling documentation are retained only under `legacy/`; PostgreSQL migrations and embedded database scripts are historical baselines, not setup for the active app.

## Verified connection

- Workspace: `https://dbc-85372395-9d08.cloud.databricks.com` / `7474660613250664`.
- Existing SQL warehouse: `bccde8ce8d366533` (Serverless Starter Warehouse).
- Provisioned app schema/table: `workspace.msl_demo.app_state`.
- Live profiling model: `databricks-gpt-oss-20b`, served by Databricks. A synthetic profile has completed live inference and deterministic validation.
- Local CLI OAuth profile: `msl-canonical`. Hosted Node deployments must supply a restricted server-side credential; browser credentials and browser SQL are prohibited.

## Required hosting enforcement

Only the explicitly approved `databricks-gpt-oss-20b` / `system.ai.gpt-oss-20b` pair may serve profiling. Before every inference call, `src/integrations/databricks/model-hosting.server.ts` reads live endpoint metadata from the designated workspace and verifies the managed foundation-model identity, single served entity, readiness, task, configuration version and routing. External-model/provider configuration, gateway fallback configuration, pending changes, unapproved endpoints and unavailable metadata are rejected. HTTP redirects are disabled for verification and inference. No external-provider or alternative-model fallback exists.

Hosting proof (workspace, endpoint, model entity, config version, verification timestamp and `databricks-hosted-only.v1` policy version) is recorded with model/prompt/schema audit provenance. Failed hosting approval records `model_hosting_unverified` on the canonical job; model failure does not bypass this policy. The endpoint's live serving metadata was verified through authorized API access. `scripts/check-model-hosting.ts` checks the same runtime guard without sending an inference request or printing a token. Earlier Gemini code is archived and inactive.

## State and provenance contract

The server owns `msl-app-state.v1` doctor documents keyed by canonical doctor account ID. Each Delta row has `record_type`, `id`, a UUID `revision`, JSON `payload` and `updated_at`. A doctor document contains stated details, authorized hospital assignments, consent/link state, approved aggregate snapshot/history, profile versions, matching runs, newsletters/articles/citations, bookmarks and audit history. The app owns doctor documents; reviewed KB publication belongs to its separate governed writer. A current reviewed KB pointer is read as record type `kb_release`, ID `published`, with `{version, published:true, payload:<matching-kb.v1>}`. No reviewed evidence is fabricated by app setup.

Provisioning is an explicit administrative single-writer operation. Browser requests never insert identities or self-enroll staff. Existing provisioned rows are preserved. Delta primary keys are not assumed to be enforced: readers reject duplicate canonical IDs. Writes update one doctor document with `WHERE id=:id AND revision=:expected`, require exactly one affected row, and change the revision. Concurrent or ambiguous writes fail visibly; refresh canonical state before retrying. The table uses Serializable isolation. There is no local/Supabase fallback or distributed-transaction claim.

Profile changes, linking/unlinking and approved hospital snapshot publication append a new queued profile and supersede old results in the same doctor commit. A profile stores its stated answers and patient-mix snapshot ID. Raw records, names, doctor codes and patient percentages are excluded from model input. Job 3 uses a persisted lease before calling Databricks model serving. It preserves nulls/empty arrays and stated answers exactly; suggestions may only combine selected cancer types and topics. The deterministic gate rejects added preferences, unsupported fields, invalid vocabulary, duplicate focus pairs and incomplete responses.

Completion rechecks current job ID/status/lease. A stale result cannot replace a changed profile or revive a revoked link. Abandoned leases expire after five minutes, with at most three attempts. Provider/validation failures store a safe error code. Doctors can retry failed work after one minute, edit stated answers, exclude suggestions and confirm a subset. Hospital staff cannot confirm for a doctor.

Audit events append inside the same atomic doctor payload as the state change. The application forbids dropping/replacing its existing audit prefix. This is application enforcement plus Delta history/change data feed, not a claim that a privileged workspace owner cannot modify a table. The current demo document limit is 2 MB; writes fail visibly until a governed archival design is provided. Row-shaped read-only SQL views expose profile/context/audit/matching/newsletter JSON with canonical revisions. Do not grant unrestricted table access to browser users.

Matching reads current confirmed profile versions and current consented aggregate data, pins the profile/mix/reviewed-KB versions, and writes deterministic reasons into the same canonical document. Unlink clears the active patient snapshot and invalidates the current profile immediately in Databricks; relink never reactivates an old upload. The matcher waits visibly when no reviewed canonical evidence exists. Newsletter generation/publication still belongs to its separate workstream; the serving API reads canonical newsletters/articles/bookmarks and has no seeded clinical fallback.

## Sign-in

Supabase Auth is removed. This synthetic demo uses provisioned app accounts and signed HttpOnly, SameSite=Strict cookies with distinct doctor/staff sessions. Scrypt password hashes, the cookie secret and Databricks credentials stay in server configuration; authentication secrets are not analytical domain data. Accounts have no public self-signup. Removing an account or changing its hash invalidates its sessions. The in-process login limiter is for this local demo; a multi-instance hosted deployment needs shared rate limiting and a managed identity provider decision.

Local synthetic credentials are in ignored, mode-0600 `demo-credentials.local`. Do not commit it or `.env.local`. The two doctor accounts and staff account map to canonical records/assignments; they are not imported Supabase accounts. No hosted Supabase records have been copied or deleted.

## Run

Dependencies are installed. The local app is at `http://localhost:8081`; independent local workers check persisted jobs every 30 seconds. Credentials are in `demo-credentials.local`. Doctor: sign in, open My profile, review or edit, then confirm. Hospital: open `/hospital`, sign in with the staff account, select an assigned consenting doctor and publish only approved aggregates.

Reproducible local setup:

1. `databricks auth login --host https://dbc-85372395-9d08.cloud.databricks.com --profile msl-canonical`.
2. `npx --yes bun scripts/configure-databricks-local.ts` creates ignored config and random synthetic account credentials without printing secrets.
3. `npx --yes bun scripts/setup-databricks.ts` creates the schema/table/views and preserves existing rows.
4. Export `.env.local` into the Node server environment, then `npm run dev -- --port 8081 --strictPort`.
5. In a separate terminal, `npm run workers` (Bun loads `.env.local`). Hosted scheduling can POST independently to `/api/profiling/run` and `/api/matching/run` with `Authorization: Bearer <LOVABLE_CRON_SECRET>`.

Hosted builds now target a Node server (`vite.config.ts`). Set `APP_ORIGIN` to the actual HTTPS origin; keep keys server-only and use a restricted credential instead of the local CLI profile. Hosting, service identity grants and hosted schedules have not been configured.

## Verification

- `npm test`: profile content/privacy gate, model transport, canonical SQL parameters/errors, CAS/audit protection, app sessions and role isolation, doctor consent/review, deterministic matcher and hospital publication/UI tests.
- `npx tsc --noEmit`; targeted ESLint; `npm run build`.
- `scripts/check-databricks-live.ts`: explicitly runs a synthetic queued profile through the live canonical database/model.
- `scripts/check-app-live.ts`: local server login, doctor/profile/library reads, hospital directory, unauthorized access, role isolation and origin denial. It uses ignored synthetic credentials without printing them.
- `test:legacy-profiling-db` and other embedded Postgres scripts test historical baselines only.

References: [SQL Statement Execution API](https://docs.databricks.com/aws/en/dev-tools/sql-execution-tutorial), [Databricks structured outputs](https://docs.databricks.com/aws/en/machine-learning/model-serving/structured-outputs).
