> Packaging snapshot copied from the shared workspace on 31 October 2026. In the shared workspace, the parent `docs/` copy remains the coordination source. In an isolated checkout, use this copy plus [current architecture](architecture/overview.md) and [setup](demo/setup.md). Older Supabase/Gemini, proposed namespaces, delivery exclusions and unimplemented-consumer descriptions below are historical; later explicit decisions and inspected runtime supersede them.

# Decision: shared Databricks source of truth

## User directive: Databricks-hosted LLM inference only

All application LLM inference must use verified Databricks-hosted model services/endpoints in the designated workspace. This applies to profiling, KB extraction/classification, embeddings or model reranking if introduced, and newsletter generation. Do not call external inference platforms directly or through Databricks external-model/provider proxy endpoints. Verify actual model hosting; a Databricks URL alone is insufficient. No silent external fallback. The documented profiling endpoint is `databricks-gpt-oss-20b`; verify availability and workload capabilities before reuse. Keep credentials server-side, log endpoint/model/prompt/schema provenance, and preserve deterministic validation, citation gates and human review. On unavailability, record an explicit pending/failed state. This supersedes earlier Gemini/provider choices.

Matching remains deterministic; this policy does not introduce an LLM into ranking. Databricks-hosted open models are permitted regardless of the original model developer; externally hosted inference through a Databricks gateway is excluded. This is an application runtime requirement, not a ban on fetching primary research publications or using this coding chat. Email transport is a separate integration decision, not LLM inference. Reuse a Databricks-compatible SDK only with a verified Databricks-hosted destination and no external fallback.

Platform references: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/supported-models and https://docs.databricks.com/aws/en/machine-learning/foundation-models/external-models . These distinguish hosting arrangements; verify the specific selected model rather than assuming all available services are hosted identically.

Status: user-directed target architecture. Applies to every MSL component. Integration and migration are not yet complete.


## Latest user directive: remove Supabase entirely

The user explicitly superseded the optional Supabase operational/auth layer: all active app domain paths now target Databricks, and Supabase Auth has been replaced by app-managed server sessions for the synthetic local demo. Earlier optional-Supabase paragraphs below are historical transition context, not the current runtime architecture. Authentication credentials stay in server secrets rather than analytical domain tables.

Verified through supported CLI OAuth (`msl-canonical`) and REST APIs in the designated workspace:

- Existing catalog `workspace`, SQL warehouse `bccde8ce8d366533` (Serverless Starter Warehouse).
- Provisioned `workspace.msl_demo.app_state`, using Delta Serializable isolation and change data feed.
- Schema contract `msl-app-state.v1`: `record_type`, `id`, UUID `revision`, JSON `payload`, `updated_at`. Canonical doctor documents carry stated details, hospital assignments, consent, aggregate snapshots/history, profile versions, matching results, newsletter/article/citation records, bookmarks and append-only application audit history. The app server is the authoritative writer of these doctor documents; no browser SQL or provider credential is exposed.
- Explicit single-writer bootstrap creates synthetic account records only; existing records are preserved. Reads reject duplicate canonical IDs. Doctor writes use one-row revision compare-and-swap with affected-row verification, committing state plus audit atomically. Audit history has application-enforced prefix immutability; this is not a database-level guarantee against privileged workspace owners. Keep the demo's 2 MB per-document bound visible and coordinate archival/scaling before expanding the build.
- Profile worker persists leases and calls Databricks model endpoint `databricks-gpt-oss-20b`; live synthetic profile generation and validation have succeeded. No Gemini key is needed by the active app.
- Matcher consumes only doctor-confirmed current profiles/current consented aggregates and reviewed canonical KB releases, and pins their versions. Current reviewed-KB serving pointer contract: record type `kb_release`, ID `published`, payload `{version, published:true, payload:<matching-kb.v1>}`. The reviewed-KB workstream owns publication. No reviewed clinical release was created by app setup; matching reports waiting rather than substituting fixtures.
- Read-only inspection views under `workspace.msl_demo`: `doctor_profiles`, `doctor_patient_context`, `doctor_audit_history`, `doctor_matching_runs`, `doctor_newsletters`. They expose the canonical revision and the corresponding JSON field; they are not independently writable stores.
- Local app sign-in/read/role/origin checks against live Databricks passed. Random synthetic account credentials and hashes are held in ignored mode-0600 local files, not in Git or Databricks tables. Hosted identity grants, credential management, deployment and schedules remain unconfigured. Existing hosted Supabase records have not been imported or deleted.

Detailed active contract and setup: `../docs/DOCTOR-PROFILING.md`. Retained Supabase source under `legacy/` and PostgreSQL migrations are historical/offline baselines; no active app runtime depends on Supabase.

## Canonical workspace

- URL: https://dbc-85372395-9d08.cloud.databricks.com
- Workspace ID: `7474660613250664`
- Edition observed: Databricks Free Edition.
- Data scope: entirely synthetic hospital data for the first build.
- Catalog/schema names, compute, permissions and programmatic access remain unverified. `msl_demo` is a proposal only.

## Authority and storage

Databricks is the canonical source of truth for project domain data: hospital records and clinician assignments, population definitions and aggregate snapshots, reviewed evidence sources/items/claims, versioned stated and generated doctor profiles, match runs/reasons, and generated briefing/publication records with audit provenance.

Supabase can remain responsible for authentication, sessions, request-time authorization/consent enforcement, transactional app operations and serving published domain-data projections. Existing Supabase code is a migration baseline, not evidence that Databricks synchronization exists. Operational records such as bookmarks, consent events and pending onboarding edits may be captured transactionally there; the integration must define their durable canonical publication into Databricks and reconciliation behavior. Do not move authentication credentials into analytical tables.

Every dataset needs a single authoritative writer, canonical ID, version, publication state and an explicit synchronization direction. Databricks-published evidence and aggregates flow to app projections. App-originated profile/consent/activity events use a durable outbox or equivalent acknowledged transfer into canonical versions, then reconcile the serving projection. No unrestricted bidirectional edits to the same records.

Local consent denial and unlink take effect immediately even if canonical publication is delayed. Generation and publication must check current operational authorization as well as pinned data versions. A delayed snapshot cannot restore revoked access. Pending edits must be visible as pending, and must not silently combine with an incompatible canonical version.

The precise table contracts, bridge mechanism and commit/publication semantics still require implementation review. This decision does not claim distributed transactions or exactly-once delivery between platforms; use idempotent operations, retries and explicit acknowledgments.

## Cross-component requirements

1. Hospital-data pipeline publishes validated, versioned aggregate data products.
2. KB work publishes reviewed claim/source releases in this workspace; Supabase may cache them for serving.
3. Profiling pins stated-profile and aggregate versions; preserve doctor-stated versus observed information.
4. Matching consumes published compatible profile, aggregate and KB versions and persists reproducible reasons.
5. Briefing uses those pinned inputs and records model/prompt and citation-gate results before publication.
6. App views consume authorized published projections and show freshness or synchronization errors.
7. All workstreams document migration gaps. Tests may use clearly marked fixtures; demo simulation is never described as live Databricks integration.

## Existing implementation transition

The local application already contains Supabase-based profiling, matching and hospital-portal work. Inventory their tables, RPCs, job queues and audit triggers before designing adapters. Retain their ownership, consent, lease and validation protections while adding canonical publication. No live schema migration, data transfer or hosted configuration is authorized merely by writing this document.

This decision supersedes earlier recommendations that the evidence KB or profile history should remain independently authoritative in Supabase.

## Sharing across chats

Root and repository `AGENTS.md` files point component chats to this decision. Already-running chats must explicitly reread these files before continuing storage/integration work. Chats outside this folder or isolated worktrees need these instructions copied or committed into their checkout. Conversation history itself is not the shared data contract.

## Verified hospital publication integration update

The shared platform now supplies a direct canonical application store. The patient-sync workstream verified the designated workspace via the authorized `msl-canonical` CLI profile, confirmed warehouse `bccde8ce8d366533` and Delta table `workspace.msl_demo.app_state`, and successfully read the two synthetic doctor records. These resources supersede the earlier unverified namespace/compute status for this particular app-state slice; other domain contracts and migrations still need their own verification.

Hospital uploads use the authenticated application backend as the single writer of aggregate publications in each canonical doctor document. A compare-and-swap Delta update commits the snapshot/history, pending profiling job and audit event together; a successful response includes the canonical document revision. This is direct canonical publication, not a separate Supabase/local pending-write outbox. Unconfirmed/failed writes never receive a local-only success response. Snapshot ID/version plus `hospital-publication.v1` metadata identify the publication; later doctor-document revisions preserve that snapshot identity. Raw-patient processing is not implemented by this aggregate upload path. See `screenshot-exact-match/docs/PATIENT-SYNC.md` and the shared platform adapter for current ownership and retry semantics. The patient-sync live verification was read-only; both doctors required explicit consent before a hospital upload.

## Verified KB publication integration update

The oncology KB workstream verified supported CLI/OAuth SQL access to workspace `7474660613250664` and existing warehouse `bccde8ce8d366533`. Canonical research source/item/claim versions, population definitions, many-to-many classification relationships, review/invalidation history and release products now use append-only `workspace.msl_demo.kb_records`, with `kb_<entity>` read views. This confirms this KB namespace/table slice; it does not imply every proposed medallion schema or hosted integration exists.

The trusted KB writer owns immutable candidate sets/releases and the single `workspace.msl_demo.app_state` record `kb_release/published`. A complete validated payload and envelope are made visible with a revision CAS/readback. The matcher reads this pointer asynchronously; no Supabase KB authority or projection was added. The initial canonical release is intentionally empty: all 21 clinical candidates await human review. Source/claim versions and the clinical-empty release were verified live; synthetic examples remain local and cannot enter clinical publication.

KB Delta history is append-only; active pointer changes append publication audit within the pointer document. Production still requires a restricted writer identity and single-concurrency scheduler; table uniqueness is application-checked, not an enforced Delta primary key. Retraction/correction events disable the active pointer and gate new releases; recalling existing matches/newsletters and atomic downstream release-validity checks remain consumer integration work. See `screenshot-exact-match/docs/KNOWLEDGE-BASE.md` and the project-plan handoff for exact versions, research coverage and limitations.

## Email delivery publication boundary

The user requires email alongside the in-app library. Canonical doctor publication must atomically persist validated newsletter/provenance, stable matching-run identity and durable email outbox intent through the app-server CAS. Matching produces `ranked-evidence-package.v1`; the separate newsletter-and-delivery worker owns subscriptions/verified recipients, generation/gates, canonical publication, provider attempts and signed event evidence. Suppression occurs at validated in-app publication, independently of email outcomes and reading. External provider effects are not a Databricks transaction: reconcile ambiguous responses using stable idempotency identity, and never equate acceptance with delivery. See `screenshot-exact-match/docs/NEWSLETTER-DELIVERY-HANDOFF.md` for consumer implementation requirements and current gaps. This decision does not authorize guessed recipients or claim configured email service.
