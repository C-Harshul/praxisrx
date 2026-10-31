> Packaging status, 31 October 2026: see [current component architecture](architecture/evidence-matching.md) and [local setup](demo/setup.md). Newsletter, subscription, outbox, Gmail transport and notification/reconciliation code now exists in the shared runtime. Statements below that the consumer must still be implemented are original ownership requirements, not the latest implementation inventory. No real approved clinical newsletter or email receipt is established by them.

# Matching: canonical ranked evidence handoff

The active runtime uses only the designated Databricks workspace `7474660613250664`, warehouse `bccde8ce8d366533`, table `workspace.msl_demo.app_state`. Read the shared `DATA-PLATFORM-DECISION.md` and `DOCTOR-PROFILING.md` for the current app/session/CAS contract. Earlier Supabase matching documentation is archived in `legacy/MATCHING-SUPABASE.md`; its RPCs, SQL leases and migration instructions are historical, not active setup.

## Ownership and persisted boundary

Matching owns deterministic selection and the persisted ranked evidence package. It never calls the newsletter LLM or email provider. The separate newsletter-and-delivery worker owns generation, full clinical/citation validation, canonical publication, email outbox and provider outcomes. The product requires both the in-app library and email; matching success alone does not complete delivery. See `NEWSLETTER-DELIVERY-HANDOFF.md` for the required consumer protocol.

`POST /api/matching/run` runs independently using server cron authentication. The active Node worker reads the canonical reviewed-KB pointer (`record_type: kb_release`, `id: published`), validates `matching-kb.v1`, chooses a due confirmed doctor profile, computes matches and appends a run and audit through the canonical doctor revision CAS. No fixtures are substituted on missing/unavailable data. An absent/disabled pointer reports `waiting_for_reviewed_evidence`; an empty approved release produces an honest empty result. KB publication is owned solely by the governed KB writer; see `KNOWLEDGE-BASE.md`.

First matching is immediate after doctor confirmation. Later runs follow the stated weekly or fortnightly cadence (7/14 elapsed days); a newly confirmed profile or historical run lacking a current package is due immediately. Failed canonical computation/commit does not advance cadence. Each invocation handles at most one due doctor; failed/conflicting commits surface for refresh/retry. There is no asynchronous provider side effect to recover inside matching. Hosting and reliable worker schedules still need deployment configuration.

## Ranked evidence package v1

A new canonical `matching_runs[]` entry retains its stable run ID, timestamp, profile ID, patient snapshot ID, release version and result. Its `evidence_package` adds:

- `schema_version: ranked-evidence-package.v1`, `publication_state: published` (visible only after canonical commit).
- `input_doctor_revision`, profile version, patient snapshot version or null, KB pointer revision and matcher version.
- Exact allowlisted matching `input`: stated profile and its schema/prompt/model versions, reviewed focus, current consented numeric aggregates and already-published item IDs. No individual patient records, names, doctor codes or email addresses.
- Ranked `result`: item/version/population IDs, cohort percentages, deterministic scores/reasons/topic matches, and the supplied reviewed evidence with claim-to-source/passages.

The worker returns the run ID and acknowledged canonical revision only after commit. A failed/ambiguous commit does not claim publication; reload canonical state before retrying. Historical runs without the v1 package are not valid delivery inputs.

`readCurrentRankedPackage(doctorId, runId)` is a trusted server-side **generation** helper, not a public authorization API. The caller must obtain doctor identity from its authorized durable work item. The helper rereads canonical state, requires the current confirmed profile/input and snapshot versions, and requires a still-published, unchanged KB pointer/version. Canonical read failures propagate; stale packages return null. It returns the current doctor revision for the consumer's CAS. It does not reserve a generation job or atomically commit publication. The consumer must recheck at publication and again before send; cross-record KB invalidation cannot be advertised as a distributed transaction.

## Selection, suppression and provenance

Use exact cancer/topic vocabulary from `options.ts`; the KB adapter normalizes NSCLC/SCLC to Lung. Only selected cancer families are kept; optional cross-specialty additions are not enabled. Explicit canonical population aliases are in `POPULATION_LABELS`. Missing/conflicting aliases remain unknown. Score is `100 × known cohort percentage + 2 × distinct selected topic matches + 1 for a matching doctor-confirmed focus`. Unknown uses zero for scoring; a known zero sorts ahead of unknown at a tie, then stable item ID. Reasons and cited evidence remain in the persisted result.

`applicability_percent` stays null because broad aggregate categories do not prove the complete study eligibility definition. `cohort_percent` means potentially relevant cohort, including known zero; unknown remains null. Never multiply/sum overlapping marginals or promote these estimates to exact applicability badges. Hospital small-cell suppression stays unknown.

**Suppression event: validated canonical newsletter publication into the doctor's library.** Only newsletters with explicit `publication.status: published` suppress their `articles[].kb_item_id` across item versions. Drafts, test previews, matching success, provider acceptance, delivery and reading do not independently alter suppression. Published content remains available in-app when email fails; email retries must resend that same newsletter. The generation owner must atomically commit the publication marker, stable matching-run reference, article item IDs, provenance and durable delivery task. Legacy `sent_at` is only a library timestamp and is never evidence of an email event.

One generation/publication identity per doctor and matching run prevents duplicate content. If generation is still pending when a later matching cycle occurs, the consumer must serialize per doctor, claim/reserve selected item IDs in durable generation state and reconcile against newly published IDs before final publication. A stale overlapping package must be discarded/rematched, not published twice. Matching never suppresses an item merely because an unvalidated draft exists.

## Remaining integration and verification

The matching producer and generation-side read are implemented locally. The separate Newsletter Generation and Email Delivery workstream now implements the consumer, gates, canonical publication/outbox, preview UI, recipient/subscription control, Gmail transport and Google-signed Pub/Sub notification handling. See `NEWSLETTER-DELIVERY.md` for actual setup and remaining Google/human-review blockers. Matching itself never sends mail. Do not schedule live email without explicit verified-recipient authorization and subscription. The reviewed clinical release documented by the KB workstream is empty pending human approval. No email is claimed sent or delivered.

Run `npm test`, `npx tsc --noEmit`, targeted ESLint and `npm run build`. Matching fixtures are offline nonclinical tests. Databricks runtime verification recorded by other workstreams is distinct from these local changes; no live canonical write or provider call was made for this handoff update.
