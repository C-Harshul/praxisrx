> Packaging snapshot copied from the shared workspace on 31 October 2026. In the shared workspace, the parent `docs/` copy remains the coordination source. In an isolated checkout, use this copy plus [current architecture](architecture/overview.md) and [setup](demo/setup.md). Older Supabase/Gemini, proposed namespaces, delivery exclusions and unimplemented-consumer descriptions below are historical; later explicit decisions and inspected runtime supersede them.

# Proposed Databricks architecture — discussion draft

Superseded storage boundary: the user subsequently designated this workspace as the canonical source of truth across all components, including evidence KB and profile/matching/briefing history. Read `DATA-PLATFORM-DECISION.md` for the current decision. The narrower hospital-only placement and Supabase KB recommendation below are retained as earlier design context, not current implementation instructions.

Status: architecture proposal; no infrastructure has been provisioned or modified. The user confirmed entirely synthetic demo hospital data and an existing Databricks workspace. Workspace URL, cloud, permissions and compute capabilities are pending.

## Responsibility boundary

Databricks is the hospital-data processing and aggregate publication platform. Supabase remains the operational application store for authentication, stated profiles, consent, authorized doctor linkage, published aggregate snapshots, newsletters and bookmarks. The frontend talks only to the application backend. No browser credentials or unrestricted SQL access to Databricks.

A shared development workspace supports component work. A workspace alone is not an isolation boundary: Unity Catalog grants and service identities separate raw hospital tables, normalization jobs, aggregate export and evidence curation. Real hospital tenants require their own isolation design before integration.

## Data paths

Hospital source → raw hospital tables → normalized oncology facts → versioned doctor cohort snapshots → restricted export → consent/ownership validation → Supabase aggregate snapshot → profile/matcher.

Doctor onboarding → Supabase stated profile and linking consent → deterministic profile composition, optionally server-side LLM normalization of stated answers → versioned effective profile.

Primary research → separate reviewed evidence KB → deterministic matcher using profile and approved aggregate snapshots → structured LLM drafting → citation validation → persisted newsletter.

Jobs communicate through persisted state and published snapshots. Publishing hospital aggregates does not synchronously invoke newsletter generation. Store change versions or events for a separate job to consume.

## Suggested Databricks layout

| Schema | Tables | Purpose |
| --- | --- | --- |
| `msl_demo.bronze` | `hospital_patients`, `hospital_encounters`, `hospital_diagnoses`, `hospital_biomarkers`, `hospital_treatment_events`, `hospital_care_team` | Synthetic source records, ingestion timestamps and source versions |
| `msl_demo.silver` | `patients`, `oncology_cases`, `biomarker_results`, `treatment_lines`, `doctor_patient_assignments`, `doctor_directory` | Validated IDs, coded diagnoses, temporal facts and attribution |
| `msl_demo.gold` | `doctor_population_snapshots`, `doctor_cohort_metrics`, `publication_manifest` | App-approved aggregate data products and publication status |
| `msl_demo.reference` | `population_definitions`, `code_mappings` | Versioned cohort rules and canonical vocabulary |

No direct patient identifiers or patient-level facts are exported to Supabase, the evidence KB or any LLM. Synthetic data should also be labeled synthetic throughout.

## Minimum normalized relationships

- Every source key is scoped by hospital_id; patient IDs and doctor IDs are not globally unique by assumption.
- `doctor_patient_assignments`: hospital_id, clinician_id, patient_id, role, valid_from, valid_to. Define primary treating oncologist as the initial attribution rule; allow care-team roles later. Use distinct patients within each doctor's panel.
- `oncology_cases`: patient/case IDs, cancer family/subtype, histology, stage and relevant effective dates. Multi-primary cancers require explicit case semantics.
- `biomarker_results`: case ID, marker, result, specimen date, result date, source. Unknown is distinct from negative.
- `treatment_lines`: case ID, regimen codes, line number, start/end dates, progression status/date where known. Do not infer progression from a treatment end alone.
- `doctor_directory`: hospital clinician identity and organizational affiliation. Supabase stores the authorized mapping from app user to hospital clinician identity; a typed doctor code alone does not establish authorization.

## Cohort computation contract

Define the panel precisely, for example: distinct patients assigned to the doctor as primary treating oncologist on the snapshot date with an oncology encounter in a configurable lookback window. The lookback is a product choice, not a clinical standard.

Every population rule has a canonical ID, description, predicate/rule version, denominator definition and required data fields. Compute intersections from normalized patient facts; never estimate intersections by multiplying marginal percentages.

An internal metric includes hospital_id, clinician_id, snapshot_id, population_id, numerator_count, denominator_count, percent, as_of, source_watermark, rule_version, data_quality_status and suppression_status. Define each metric's denominator explicitly. Incomplete eligibility information must be reported, not treated as a negative result.

The external export uses a strict allowlist: authorized clinician mapping key, snapshot ID, canonical population ID, approved percentage or null, denominator description, timestamp, definition version and coarse quality/suppression indicators. Export counts only if separately approved. Aggregation alone does not guarantee anonymity: real-data deployment needs release rules addressing small cohorts and inference across overlapping or repeated snapshots.

## Profile composition

Preserve three separate objects:

1. Stated profile: specialty, cancer types, interests, preferences, doctor edits and provenance.
2. Observed practice mix: versioned aggregate snapshots with freshness and coverage metadata.
3. Effective matching profile: deterministic composition linking the first two versions, with recorded inclusion rules and reasons.

Observed data enriches relevance; it does not silently rewrite specialty, preferences or expertise. A doctor can treat a small cohort and still explicitly request research about it. Unknown, zero, stale, suppressed and unlinked are different states. The UI should explain discrepancies and allow corrections.

## Synchronization

For the demo, use manual refresh plus a scheduled batch, not streaming. Publish gold snapshots only after validation, then a backend worker reads the approved export using a restricted Databricks service principal. SQL Statement Execution API is one supported transport; no arbitrary SQL is exposed to the frontend.

The worker validates schema, snapshot completeness, active consent and ownership, writes an immutable aggregate version, and atomically advances the current snapshot pointer. Idempotency key: hospital_id + clinician_id + snapshot_id. Supabase owns consent and linkage; Databricks owns the computed aggregates. Do not create bidirectional writes to the same fields.

Unlink stops publication/use for the app user, removes the active link and invalidates pending profile or newsletter work that requires it. Recheck consent at generation and publication. Historical newsletter retention versus deletion needs a product policy; append-only audit records should store event metadata, not sensitive patient content.

## Evidence KB placement

Keep the first reviewed seed KB in Supabase for straightforward app integration. If research ingestion or review later moves into Databricks, publish versioned reviewed items and claims to Supabase through a distinct data product. Matching consumes only the published reviewed set. Avoid two writable sources of truth.

## First vertical slice

Generate one synthetic hospital with two oncologists and internally consistent patient, biomarker, treatment and assignment records. Produce distinct cohort snapshots, link each doctor to the correct app user, display stated versus observed profile, and demonstrate a changed newsletter ranking after a synthetic panel update. Verify no patient rows leave Databricks, one doctor cannot retrieve another's mix, repeated sync is idempotent, and unlink prevents further use.

## Decisions pending

- Workspace URL, cloud, permissions and available compute (workspace existence confirmed).
- Panel lookback, primary-doctor attribution and multi-hospital semantics.
- Whether the evidence KB should remain in Supabase for the first build.

## Confirmed first-build scope

Workspace inspection: authenticated landing page identifies Databricks Free Edition. The console displays an automated-browser-control restriction and directs agents to Genie One MCP. Catalogs, compute and privileges have not been inspected. Databricks Genie was found in plugin discovery, but the plugin suggestion tool reported it ineligible in this environment; the specific reason was not established. No workspace objects or permissions were changed.

- Entirely synthetic hospital data; no real patient records.
- Use the user's existing Databricks workspace.
- Proposed first slice: one hospital, two doctors, deterministic synthetic records and reproducible aggregate snapshots. Panel sizes and refresh window remain configurable demo parameters.
- Next deliverable: runnable setup SQL, a deterministic synthetic-data generator, cohort aggregation SQL and the aggregate export contract after workspace capabilities are established. No paid compute or workspace changes have been initiated.

## Platform references

- Layering: https://docs.databricks.com/aws/en/ldp/best-practices
- Unity Catalog access boundaries: https://docs.databricks.com/aws/en/data-governance/unity-catalog/access-control/
- Backend OAuth: https://docs.databricks.com/aws/en/dev-tools/auth/oauth-m2m
- SQL transport: https://docs.databricks.com/aws/en/dev-tools/sql-execution-tutorial
