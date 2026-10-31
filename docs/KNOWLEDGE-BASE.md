> Packaging status, 31 October 2026: see [current component architecture](architecture/research-knowledge-base.md) and [local setup](demo/setup.md). The authenticated `/review` UI, canonical exact-version decisions and explicit release preview/publication are now implemented; references below to a future UI or nonexistent newsletter consumer describe the earlier workstream snapshot. Latest recorded clinical release still has zero items and zero human approvals.

# Oncology knowledge base

Status: local reviewer UI implemented and authenticated canonical reads verified on **31 October 2026** (America/New_York). The underlying KB was provisioned on 30 October. Human-reviewed clinical content is still pending. No real clinical decision, clinical publication or newsletter was created by this UI workstream.

## Local reviewer page — current workflow

Open **http://localhost:8081/review**. This is separate from the doctor and hospital portals, with its own `msl_reviewer_session` HttpOnly, SameSite=Strict cookie. The app is running locally; hosting and production deployment are out of scope.

The user explicitly authorized a dedicated local demo reviewer. Its sign-in details are in **ignored, mode-0600 `reviewer-credentials.local`**, alongside ignored `.env.local`. Open that file privately; do not paste its password into chat, logs, tracked files or Databricks. Doctor/staff accounts were preserved and do not gain reviewer access. No public reviewer registration exists.

For a fresh local setup only, run the explicit provisioning command once:

```sh
node --import tsx scripts/provision-kb-reviewer.ts --create
node --env-file=.env.local node_modules/vite/bin/vite.js --port 8081 --strictPort
```

Provisioning refuses to overwrite an existing reviewer. It adds a separate reviewer account to the existing server account configuration, a UUID identity to `KB_AUTHORIZED_REVIEWERS`, and an explicit `KB_REVIEWER_REGISTRY_JSON` entry `{account_id,reviewer_id,can_publish:true}`. It prints no secrets. The user must explicitly authorize any additional grants; do not reuse a doctor/staff role as a reviewer. Registry removal, allowlist removal or account/credential changes revoke the corresponding access. Registry and credentials are server configuration, not browser inputs or analytical domain data.

1. Sign in using the dedicated reviewer file. The page reads the canonical KB, shows pending/approved/rejected counts, and filters/searches by status, family, specialty, topic, title, drug/trial names and identifiers where present.
2. Select a candidate. Inspect the exact item/source/claim versions, original source links, passages and locators, population/exclusions/unknowns, limitations, maturity, funding/conflicts, dated regulatory unknowns, taxonomy and review history.
3. Enter an actual review note and explicitly attest to human review of the displayed scope. Choose **Approve exact version** or **Reject exact version**. Wait for **Decision acknowledged in Databricks**. Approval is recorded separately from inclusion in the active release. Rejection takes precedence; remediation needs a new item version and new review. There is no bulk or automatic approval.
4. In Release publication, choose the canonical candidate set and source cutoff, then **Preview complete release**. Inspect the full resulting membership, added/removed/changed IDs and every exclusion reason. Preview is read-only and uses the actual strict matcher validator.
5. Confirm that the displayed complete membership **replaces** the active release, including all removals. Choose **Publish reviewed release**. Only an authorized publisher can do this. Wait for **Available to matching**, with the canonical release ID/hash, pointer revision and count. Publication does not call matching, generation, email or a model.

Connected failures show an error; neither lists nor decisions use local candidate exports as fallback. Stale decisions require refreshed detail. Changed previews, candidates, reviews, invalidations, allowlists or pointer revisions require refreshed previews. An unchanged mutation retry reuses its request UUID and reconciles canonical records before reporting success.

### Shared services and concurrency

`src/lib/msl/kb/store.server.ts` now owns the canonical transport used by UI and CLI; `review.server.ts` owns review snapshots, authorization, pinned decisions, release preview and publication. `http.server.ts` implements `/api/review` with strict schemas, 16 KB request bounds, same-origin checks on every POST, no-store responses and server-only reviewer identity. Doctor/staff/anonymous requests are denied. No browser value selects the actor, grants a role or becomes shell/SQL text.

All current UI/CLI KB writers serialize through a **ten-minute persisted CAS lease on the existing KB pointer**. Insert-only KB writes are fenced by its exact revision. Reviews and their audit/provenance rows are written together and read back, followed by a pointer revision/audit acknowledgment. Publication rereads canonical state under that lease, revalidates the exact preview token/membership, writes and reads back an immutable release plus a **prepared** audit event, then publishes the complete pointer with the actual publication event. A prepared event is not a claim that publication succeeded. Lost CAS/failed publication preserves the old active payload. Pointer audit prefixes are preserved. An unconfirmed lease may remain busy until readback/expiry; never clear somebody else's lease or bypass it using direct writes. These changes can conservatively invalidate in-flight downstream packages through a pointer revision change even when release membership is unchanged.

This is coordinated local-demo writing, not a distributed transaction across KB, doctor records and external delivery. The existing newsletter consumer must continue its own current-pointer/consent checks. Raw privileged writes bypassing the governed service are unsupported. Hosted service identities, scheduling and deployment remain out of scope.

### Verification boundary

`node --env-file=.env.local --import tsx scripts/check-kb-review-live.ts` performs **read-only** verification: dedicated reviewer login, canonical list/detail/preview, anonymous denial, foreign-origin denial and page HTTP response. It also submits **EXPLAIN only** for the fenced immutable MERGE, validating Databricks SQL analysis without writing a review or release. Receipt: `kb/exports/live-review-ui-readback.json`.

Verified live counts: **21 pending, 0 approved, 0 rejected; active clinical release 0 items**. Its prior revision/hash remain unchanged. Actual approval, rejection and clinical publication remain human user actions; mutations were tested against isolated fixtures, not live research candidates. The browser sign-in page was checked, and component tests exercise detail, attestation, acknowledgment and unconfirmed errors.

## Verified state

- Workspace `7474660613250664`, `https://dbc-85372395-9d08.cloud.databricks.com`; supported CLI profile `msl-canonical`, existing warehouse `bccde8ce8d366533`. No console automation, new credentials, privileges or compute were provisioned.
- Canonical Delta table `workspace.msl_demo.kb_records`; append-only Delta property enabled. Typed entity views expose evidence, source versions, relationships, populations, claims, review decisions, releases and audits. Separate logical layers share one physical immutable record log for this small vertical slice.
- 21 candidate items, including 15 Lung (8 NSCLC, 7 SCLC), plus Breast, Pancreas, Liver, Gastric, Colorectal and Other/melanoma. All **pending human review**. Medical, Radiation and Surgical oncology classifications are stored separately from cancer families. Classification is provisional.
- Two older pivotal sources (KEYNOTE-671, ADRIATIC) are acquired as dated context, not recent results. Study-report relationships preserve KEYNOTE-671's original report and five-year update as reports of the same registered study.
- Canonical `app_state` record `{record_type:'kb_release', id:'published'}` contains the strict `matching-kb.v1` payload and a separate release envelope. The acknowledged clinical release has **zero items**, because no human approvals exist. The existing matcher can consume it directly.
- Local receipts in `kb/exports/live-*.json` contain hashes, revision IDs and readback status. They are evidence of the recorded executions, not a promise of perpetual connectivity. Local staging/exports are never substituted when a connected read fails.

## Research coverage and limits

See [research coverage](../kb/RESEARCH-COVERAGE.md), [source registry](../kb/data/source-registry.json), [review queue](../kb/exports/review-queue.json) and [acquisition metadata](../kb/data/acquisitions.json).

The executed recent search covers **1 August–30 October 2026**. Publication date is first publication. Retrieval timestamps are separate; conference dates and registry updates are nullable and never relabeled publication dates. Europe PMC's MED core API provided indexed original author abstracts and metadata. Selected primary publisher links were corroborated, but **full text was not acquired**. Only metadata and up to 24 abstract words per source are retained; open-access availability alone is not treated as a redistribution license.

The first pass fetched all 165 lung search hits and 30 results per other family. Other-family searches are explicitly partial, with no completed watermark. Reviews, irrelevant hits and protocols can appear among discovery results; only the separate curated subset is the candidate collection. 333 discovery documents include the two older context sources; most discovery records stay local. No numeric effect estimates, funding disclosures, full eligibility criteria or current regulatory labels have been clinically verified in this collection. Unknown values are explicit. Do not treat titles, classification or candidate excerpt selection as verified treatment conclusions.

No official ESMO abstract results were acquired. SAFFRON and daraxonrasib approval examples from the original brief remain unverified backlog leads. ClinicalTrials.gov, regulator and conference connectors are registered but disabled. Guidelines, broader rare cancers and non-English coverage remain gaps. This is a maintainable thin slice, not an exhaustive research library.

## Canonical model and ownership

The KB workstream's trusted administrative writer owns all KB records and the published KB pointer. The app/matcher reads only the pointer; it does not author the KB. There is no Supabase copy or independently editable evidence store. If a serving projection is added, its owner must acknowledge the exact canonical release ID/hash/revision and never merge local edits into it.

`kb_records` columns: `record_type`, `id`, `version`, `content_hash`, JSON `payload`, `created_at`. Identity is `(record_type,id,version)`. An insert-only MERGE is followed by exact-key/hash readback; conflicting content or duplicate keys fails visibly. Delta append-only storage rejects update/delete. Use only the shared governed writer/lease for all mutations. Delta does not enforce unique primary keys; direct concurrent writers that bypass the lease are unsupported. Production needs a dedicated least-privilege writer identity and single-concurrency job; neither was provisioned here.

| Entity kind / view | Contents and layer |
|---|---|
| `source_registry`, `acquisition_run` | Connector scope, cadence, watermark/cursor, retries, success/partial/quarantine; acquisition layer |
| `document` | Stable PMID/DOI, URL, first publication, access/license, retained exact excerpt, full-abstract input hash, retrieval/run provenance; permitted raw source versions |
| `study`, `study_report` | Registered NCT identity and report relationships; unresolved reports are not counted as verified separate trials |
| `evidence_item` | Immutable rich candidate: cancer arrays, specialty arrays, topics, subtype, design, population, limitations, funding/conflicts, dated regulatory unknowns |
| `item_taxonomy` | Many-to-many relationship records `{item_id,item_version,axis,value}`; multiple cancer/specialty/topic classifications are supported |
| `population` | Definition/version, explicit inclusion/exclusion/unknowns, structured predicates, required fields, denominator requirement |
| `claim` | Atomic exact source excerpt, claim version, source version, locator, extraction model/prompt/schema/input hashes; contextual effect schema is available but no numbers were extracted |
| `review` | Exact item/snapshot hash, human decision/attestation, reviewer and scope; independently versioned immutable event |
| `candidate_set` | Explicit item-version selection, so later curation does not silently rewrite release inputs |
| `invalidation` | Correction, supersession, withdrawal or retraction event, actor, reason and affected item/version |
| `release` | Immutable payload, membership with claim/source/review versions, cutoff, hashes and validation outcome |
| `audit`, `taxonomy` | Append-only publication/sync/invalidation history and versioned shared vocabulary |

Views are named `kb_<kind>` and expose versioned JSON. Query relationships using `get_json_object(payload,'$.item_id')`, `$.axis`, `$.value`, etc. They are logical relational products over the immutable log, not separate independently writable stores. Schemas are enforced in the TypeScript writer; SQL consumers must not infer unvalidated schema from arbitrary JSON.

Source versions hash retained identity metadata plus the full abstract input hash; retrieval time and run ID do not create new document versions. DOI/PMID and content hashes detect unchanged reports. Different reports preserve their own identifiers and analyses. Six initial truncated feed runs were corrected from succeeded to partial in new immutable acquisition metadata versions; the earlier versions remain audit history, not completed watermarks. NCT links group reports; missing links retain `unresolved-report:*` identifiers. Trial identity does not prove clinical equivalence or mature results.

## Setup and operation

Run from the application repository. Node 24, existing `tsx`/Zod dependencies and Python 3.9+ are used. No extra dependencies were installed.

```sh
python3 kb/acquire.py --as-of 2026-10-30 --days 90
python3 kb/acquire.py --pmids 37272513,39268857
node --import tsx kb/curate.ts
node --import tsx kb/example.ts
python3 kb/coverage.py
```

`acquire.py` defaults to the current America/New_York date and a 90-day lookback. It uses cursor pagination within a feed and overlapping full-window retrieval on each run. Source versions make reruns idempotent and catch delayed indexing/changed abstracts. A partial result never advances a complete watermark. Four bounded retries cover rate limiting/transient errors; failures quarantine one feed without stopping others. Daily cadence is a plan: no scheduler was deployed. The current curation selection and regulatory-as-of are pinned to this dated research snapshot; edit/review that selection deliberately when expanding coverage.

Use server-only environment configuration, never browser variables or checked-in secrets:

```sh
export DATABRICKS_AUTH_PROFILE=msl-canonical
export DATABRICKS_WAREHOUSE_ID=bccde8ce8d366533
export DATABRICKS_APP_TABLE=workspace.msl_demo.app_state
export KB_NAMESPACE=workspace.msl_demo
node --import tsx kb/operate.ts setup
node --import tsx kb/operate.ts sync
node --import tsx kb/operate.ts verify
```

`KB_NAMESPACE` parameterizes the KB schema, and the existing transport pins the designated workspace. The SQL setup creates only the KB log; views are created by `setup`. `sync` stages selected candidates, context and relationships under the shared KB write lease; new decisions use the direct review service; it never invokes profiling, matching or generation. A partial/ambiguous write is unconfirmed; rerun after canonical readback. Insert-only writes recover by key/hash. Do not rerun broad app bootstrap scripts for KB setup.

## Classification and human review

Lifecycle: discovered → retrieved → deterministic extraction/classification → structural validation → pending review → human approval/rejection → release. Fetch errors are quarantined. Corrections, supersession, retractions and withdrawals are independent append-only invalidations. The local review UI is the primary workflow; the JSON queue remains a reproducible inspection artifact.

This slice uses deterministic title taxonomy rules and a limited abstract-sentence extractor. **No LLM extraction was executed.** Every claim records method, null model, `no-llm.v1`, schema and source input hash. A future server-side LLM may produce the same constrained candidate schema; treat its source text as untrusted data, pin model/prompt/schema/source hashes, validate it and put it through the same human gate. Never allow retrieved text to execute commands or grant approval.

For richer curation, edit a copy of a candidate, retaining acquired sources and exact passage links. Recompute changed claim versions as `hash({...claim,version:''})`, then the item version as `hash({...item,version:''})` using `core.ts`. Validate/stage with `node --import tsx kb/operate.ts classify proposals.json`. Source integrity and the strict schema are checked. Old canonical versions remain intact. This command cannot approve evidence.

A designated human reviews the original accessible research, full population scope, classifications, limitations, funding/conflicts and dated regulatory status. Unknowns may remain if explicitly approved and surfaced. Complete a decision JSON with:

```json
{
  "id": "unique-review-event-id",
  "item_id": "copy from queue",
  "item_version": "copy exact version hash",
  "decision": "approved",
  "reviewer": "authorized human identity",
  "reviewed_at": "actual ISO timestamp with timezone",
  "human_attestation": true,
  "scope": "claims-population-funding-limitations-regulatory-classification",
  "note": "actual review findings and retained uncertainties",
  "snapshot_hash": "copy exact snapshot hash from queue"
}
```

The legacy JSON shape above remains accepted by the trusted CLI, but **review import now writes directly to Databricks through the same service as the UI**: `node --env-file=.env.local --import tsx kb/operate.ts review decision.json`. It pins the canonical snapshot, validates the registered/allowlisted human identity, records a server timestamp and appends exact source/claim provenance. Repeating the identical input uses a stable request identity. It does not create a separate local approval authority or require a later sync. The original administrative allowlist is supplemented by the explicit reviewer registry. Approval never transfers after a source, claim or item change.

## Release and matcher contract

```sh
node --env-file=.env.local --import tsx kb/operate.ts export 2026-10-30 candidate-set-HASH_FROM_SYNC_RECEIPT
# Set KB_OPERATOR_REVIEWER privately to your registered reviewer ID, then:
node --env-file=.env.local --import tsx kb/operate.ts release
```

`export` now reads canonical state and saves a clearly labeled local **preview** at `kb/exports/release-preview.json`, with its exact token and complete replacement membership. It does not consume local candidate content. With exactly one candidate set the final export argument may be omitted; otherwise select it explicitly. `release` consumes that preview token and requires an explicitly registered/allowlisted publisher identity in `KB_OPERATOR_REVIEWER`, then uses the same canonical lease, reread, validation, immutable write, pointer CAS and readback as the UI. A stale preview fails; export again and inspect its full membership before a new publication. No automatic downstream calls occur.

The strict matcher payload is **only** `{schema_version:'matching-kb.v1',items:[...]}`. Envelope/provenance stays outside it. Actual `evidenceReleaseSchema` is used for both export and publication. Claims resolve to included HTTPS sources; source/claim/item versions and reviewer hashes appear in membership. Empty clinical releases are valid. Synthetic fixtures are rejected by clinical publication even if they contain simulated approval fields.

Stable item identity is report/analysis based (`evidence-pmid-*`); changing that report creates a version, preserving delivery deduplication across versions. Distinct reports of the same study are deliberately separate updates, not independent trial evidence. NSCLC/SCLC map to Lung. `POPULATION_LABELS` aliases are reused exactly; broad cohorts never prove trial eligibility. No marginal multiplication is performed; the matcher continues to emit `cohort_percent` and `applicability_percent:null`.

V1 has one cancer family and does not filter specialty. The rich store supports many families/specialties, but **multi-family candidates are blocked from v1 publication**, with an explicit error. A curator must define justified indication-specific children and coordinate a cross-child delivery policy before releasing them. Automatic fan-out would create duplicate delivery for multi-family doctors; silently selecting the first family would lose indications. Specialty filtering/multi-family deduplication needs a coordinated v2 contract; it was not smuggled into v1. No matching algorithm or newsletter logic was changed.

`invalidate event.json` requires an authorized curator and exact invalidation schema (`id,item_id,item_version|null,kind,reason,actor,created_at`). It first atomically disables the active pointer and embeds the event/audit, then persists the standalone invalidation. A failed second write is repairable: pointer-embedded invalidations also gate future releases. Corrections and supersession block the affected old version just as retractions do. Publish a new reviewed candidate set to restore service. Historical release membership is preserved.

**Downstream gap:** already-produced matching results/newsletters are not recalled by this workstream. The current matcher checks pointer revision before committing a result, but a cross-record race with invalidation remains possible after that check. Newsletter publication must recheck current release validity, consent and pinned profile/snapshot inside its own atomic publication boundary. Until that consumer exists, do not claim end-to-end retraction enforcement. Scheduled retraction discovery, external alerts and historical newsletter recall are not implemented.

## Worked trace and validation

`kb/exports/synthetic-worked-example.json` traces a clearly fictional source passage → claim → item → simulated fixture approval → strict fixture release → actual matcher with a synthetic doctor → newsletter input. It is local only. The cohort is 60%; exact applicability is null. No real reviewer or real clinical result is used. The separate real clinical export is empty. The real trace currently ends at pending review, honestly.

Downstream clinical prose may use only supplied approved claims; it must not infer absent exclusions or approval status. Population descriptions have their own reviewed definition provenance. Deterministic cohort percentages and ranking reasons cite profile/snapshot provenance rather than research efficacy claims. A citation-ID gate checks permitted references, not semantic entailment. All substantive titles, summaries, coverage, flags, funding and body text need appropriate provenance. The newsletter worker is outside this implementation.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s kb -p test_acquire.py
npx vitest run
npx tsc --noEmit
npx tsc --noEmit --project kb/tsconfig.json
npx eslint src/lib/msl/kb/*.ts
```

Local checks cover repeat ingestion, changed source versions, failed/partial watermarks, review authorization/pinning, claim/source integrity, study grouping, taxonomy boundaries, synthetic isolation, immutable release identity, invalidation exclusion, delivery deduplication and the actual matcher schema. Databricks setup, insert/readback, repeat sync and pointer readback are separate live verification, not inferred from unit tests. See receipts for exact revision/hash evidence. No other component was deployed or migrated.
