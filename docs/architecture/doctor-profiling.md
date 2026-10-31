# Doctor profiling

Keep stated interests, generated suggestions and doctor-confirmed focus separate. Generated output proposes combinations of selected cancer families/topics; it cannot silently rewrite stated expertise or practice context.

```mermaid
flowchart LR
  Edit[Stated edit, consent change or aggregate publication] --> CAS[(Persist queued profile version and audit)]
  CAS --> W[Local profiling worker claims lease]
  W --> Verify[Verify Databricks model hosting metadata]
  Verify --> M[Databricks gpt-oss-20b structured inference]
  M --> Gate[Deterministic schema and stated-input gate]
  Gate --> Fresh[Check current version and lease]
  Fresh --> DB[(Validated suggestion awaiting review)]
  DB --> D[Doctor selects focus and confirms]
  D --> C[(Confirmed profile for matching)]
```

**Files:** `profiling/contract.ts`, `databricks.server.ts`, `worker.server.ts`; `platform/profile-state.ts`, `doctor.server.ts`; `GeneratedProfile.tsx`; `/api/profiling/run`. [Detailed handoff](../DOCTOR-PROFILING.md).

**Contracts/data:** `doctor-profile.v1`, prompt `doctor-profiler.v1`, inside canonical doctor `profiles[]` with stated answers, patient snapshot ID, status, lease, model/provenance and confirmation. Model input omits names, doctor IDs, raw rows and patient percentages. Suggestions must preserve stated answers/nulls and use selected vocabulary only; duplicate pairs, added preferences and malformed fields fail validation.

**Hosting:** endpoint `databricks-gpt-oss-20b`, entity `system.ai.gpt-oss-20b`. The shared server verifier requires the approved endpoint/entity, ready chat service, one managed entity, stable config and no external/proxy/fallback route. Redirects/unavailable metadata fail closed. Audit pins workspace, endpoint, entity, config version, time, hosting policy, prompt/schema/model. `model_hosting_unverified` is an explicit failure; no external inference fallback.

**Lifecycle:** edits/snapshot/consent changes enqueue/supersede atomically. Worker persists a five-minute lease, max three attempts, before inference; completion rechecks job/status/lease so stale output cannot replace current consent/profile. Doctors can retry failed work after one minute, edit and confirm a subset; staff cannot confirm. Matching requires the current confirmed version, not merely successful inference.

**Configuration:** `DATABRICKS_MODEL_ENDPOINT`, shared Databricks and session variables; `LOVABLE_CRON_SECRET` for worker HTTP invocation. No external model key. Run the common local worker or authenticated `POST /api/profiling/run`; do not expose the cron secret to the browser.

**Rationale/verification:** constrained suggestions plus deterministic gates and doctor confirmation give a small auditable use of model serving. They do not establish clinical correctness. Prior handoffs record successful live synthetic profiles and hosted metadata verification. `npm test -- src/lib/msl/profiling src/integrations/databricks/model-hosting.server.test.ts` covers validation/leases/hosting. `check-model-hosting.ts` is a separate read-only live check; `check-databricks-live.ts` can execute inference and mutate queued canonical work, so it is not documentation validation.
