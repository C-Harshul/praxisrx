# Doctor profiling — Job 3

## Superseding data-platform decision

The shared `../../docs/DATA-PLATFORM-DECISION.md` supersedes the Supabase-only storage assumptions below. Databricks workspace `7474660613250664` at `https://dbc-85372395-9d08.cloud.databricks.com` is the canonical authority for stated/generated profile versions and profiling provenance. Supabase remains an operational/auth/serving layer; the existing queue, RPCs, confirmation controls and audit protections are an unmigrated baseline, not canonical Databricks publication.

No Databricks connector, programmatic access, catalog/schema, table contract or synchronization has been verified for profiling. `msl_demo` is not a confirmed namespace. The earlier setup instructions enable only the Supabase baseline; applying those migrations does not connect Databricks. Local tests use explicitly isolated fixtures and do not prove canonical connectivity. Preserve the baseline; do not remove working authorization, revocation, leases, validation or doctor review to satisfy the new target.

Before connected profiling, coordinate a single authoritative writer and canonical profile/aggregate IDs, versions and publication states. App-originated onboarding edits and doctor confirmations need a durable outbox or equivalent acknowledged transfer into Databricks, idempotent retries and an authorized serving projection reconciled to the canonical acknowledgment. The current queue is not a canonical publication outbox. A successful local Gemini job or local doctor confirmation must not be treated as a published canonical profile.

The profiling worker must pin compatible published stated-profile and approved aggregate versions; preserve doctor-stated, observed and AI-suggested fields separately. Approved aggregate metadata can be attached deterministically while keeping patient-level records within hospital processing and outside prompts. Matching must consume canonical-acknowledged profiles and their provenance; the Supabase-only consumption instructions below are a baseline contract requiring migration. Pending or unavailable synchronization must be visible and must block any claim of connected canonical operation. No local/mock/Supabase fallback may be silently substituted. Current operational consent denial or unlink always wins over delayed publication or stale projections.

No live migration, canonical write or data transfer has been performed. A storage-owner handoff must establish the bridge and publication acknowledgment contract before connecting this component. Browser code must never receive Databricks credentials or unrestricted SQL access; respect the console automation restriction.

Implemented locally on `codex/gemini-doctor-profiling`. No database migration, hosted secret, scheduler or deployment has been applied automatically.

## Decision and contract

Gemini runs server-side through its REST `generateContent` endpoint, using structured JSON output and an independent Zod/content gate. The API key stays in an HTTP header and server environment. The model is explicitly configured with `GEMINI_MODEL`; there is no silent provider fallback or synthetic result presented as a live result.

The existing UI uses mostly fixed-choice answers. The first version therefore structures those choices and proposes up to six combinations of selected cancer types and topics. It does not invent a specialty, research interest, treatment preference or patient cohort. A future free-text onboarding field would need its own input/privacy contract and reviewed extraction semantics. Do not quietly introduce unbounded retrieval into this profiler.

`src/lib/msl/profiling/contract.ts` defines `doctor-profile.v1` and prompt version `doctor-profiler.v1`. `output.stated` must equal every supplied field exactly, including nulls, empty arrays and array order. `output.suggested_focus` contains `{ cancer_type, topic }` pairs drawn only from the doctor's selected values; pairs are unranked AI suggestions. Every stated field's provenance is the corresponding key in the immutable job `input`; suggested pairs have provenance in `input.cancer_types` and `input.topics`. The original model output is retained. The doctor can exclude suggestions and confirm a subset, stored separately as `reviewed_focus`, or edit onboarding to regenerate.

Existing option strings from `src/lib/msl/options.ts` are the v1 vocabulary. Canonical IDs across the shared KB/matcher are still an integration decision: do not invent a separate taxonomy here. No clinical claims or evidence lookup belong in this job.

## Stored asynchronous boundary

On completed onboarding, doctor edits, patient-data link/unlink, and linked patient-mix inserts/updates, database triggers atomically supersede old jobs and enqueue a new `doctor_profile_jobs` version. Partial onboarding does not call Gemini. Existing onboarded doctors are queued when the migration is applied. Ordinary UI saves do not call the profiling worker or newsletter generator.

A scheduler calls `POST /api/profiling/run` using `Authorization: Bearer <LOVABLE_CRON_SECRET>`. Existing cron authentication also accepts `LOVABLE_CRON_SECRET_PREVIOUS` during rotation. Each invocation handles one job with a 45-second provider timeout; configure the hosting request limit above this plus database overhead (at least 60 seconds). Schedule frequently enough for the demo, typically once a minute. Use a POST-capable scheduler; a default GET-only Vercel cron does not match this endpoint. The repo's current build defaults to a Cloudflare Nitro target, despite Vercel being mentioned in the original project brief; configure scheduling on the actual deployed host.

Claims use `FOR UPDATE SKIP LOCKED`, a unique lease token, and a five-minute lease. Abandoned work can be reclaimed up to three times. Completion checks the token and current job status inside a transaction. Profile edits and unlinking during generation prevent an old result from publishing. Provider/validation failures are terminal for that attempt, retain only a safe error code, and do not overwrite stated doctor answers. The doctor may retry failed work after one minute. All enqueue/start/success/failure/discard/confirmation events append audit records. Discarded late responses retain model/prompt/schema metadata in the audit log. Supersession is tied to the next `profiling_queued` event and the source doctor's existing action audit; no audit entry is updated or deleted.

`doctor_profile_jobs` is readable only by its owner through RLS. Authenticated users cannot directly write jobs, claim work, or finish it. Only the service-role worker may claim/finish; doctor confirmation/retry use narrowly scoped owner-checking functions.

## Patient-data and matcher integration

Names, doctor codes, raw patient records, and aggregate percentages never enter the Gemini request. This component deliberately attaches no patient statistics to generated output. The matcher reads current, consented aggregates deterministically from the separately owned patient-mix store, preserving zero versus unknown. No marginal percentages are multiplied or synthesized.

Job 4 should select the current `status = 'succeeded' AND confirmed_at IS NOT NULL` profile for the authenticated doctor, pin `id`, `version`, `schema_version`, `prompt_version` and `model`, and use `output.stated` plus `reviewed_focus`. Never use unconfirmed suggestions or a superseded profile. With no confirmed profile, defer generation or explicitly use the doctor's stated answers under the matcher's documented fallback policy. Do not use inferred suggestions as hard clinical eligibility filters.

The matcher must independently pin the current consent/link state and patient-mix version when it runs; the job's creation time is not a patient-mix snapshot. Recheck consent before use/publication. Link/unlink and sync trigger new profiling versions even though no patient statistics go to Gemini. A transactional cross-component snapshot for newsletter publication remains the matcher/storage workstream's responsibility.

## Setup

1. Apply `drizzle/migrations/0001_doctor_profiling.sql` to the existing Supabase database after `0000_migration.sql`, using your deployment migration workflow or Supabase SQL editor. This repo has no configured migration command; do not run schema generation from its intentionally blank `drizzle/schema.ts`. The Drizzle journal includes this migration. When using the SQL editor, keep your deployment migration ledger consistent to avoid replaying it later.
2. Configure server secrets from `.env.example`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, and `LOVABLE_CRON_SECRET`. Use your hosting secret manager or an ignored `.env.local` for local development. Do not put secrets into the tracked `.env`, browser variables, chat, or Git.
3. Deploy the app and schedule the authenticated POST endpoint. For an initial run, invoke the same endpoint manually with your configured bearer secret. An empty queue returns `{"status":"idle"}`; configuration/database failures return HTTP 503; a recorded generation failure returns `{"status":"failed"}`.
4. Complete onboarding or edit an existing profile. Visit My profile to see preparation status, review/uncheck suggested focus areas and confirm. The app polls status; the original stated answers remain editable.

A live Gemini call still requires a valid key/model, applied migration, and deployed scheduler. No live provider test is claimed by local mocked tests.

## Verification

- `npm test`: existing tests plus model-output gate, privacy allowlist, provider failure/truncation handling, and worker lifecycle tests.
- `npm run test:profiling-db`: applies both migrations to isolated embedded Postgres and checks ownership isolation, restricted worker RPCs/writes, review restrictions, stale completions, unlink, retry, lease recovery, patient sync triggers, and append-only audit. Requires no live credentials and never touches Supabase.
- `npx tsc --noEmit` and `npm run build`.

References: [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [TanStack server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes).

## Hospital patient-data integration

Uploads now belong to the separate `/hospital` portal. Migration 0004 adds assigned-doctor hospital staff authorization and retires the doctor upload RPC; staff authentication uses a separate browser session. Hospital syncs still save immutable account-specific aggregate snapshots and transactionally enqueue profiling. Existing doctor consent and profile confirmation remain required. The matching input schema is unchanged; current context pins the aggregate snapshot timestamp and numeric percentages, with suppressed values unknown. See `PATIENT-SYNC.md` for setup, local simulation versus connected mode, and the integration contract.
