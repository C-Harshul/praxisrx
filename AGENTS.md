<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Required LLM hosting policy

All application LLM inference must use verified Databricks-hosted model services/endpoints in the designated workspace. This applies to profiling, KB extraction/classification, embeddings or model reranking if introduced, and newsletter generation. Do not call external inference platforms directly or through Databricks external-model/provider proxy endpoints. Verify actual model hosting; a Databricks URL alone is insufficient. No silent external fallback. The documented profiling endpoint is `databricks-gpt-oss-20b`; verify availability and workload capabilities before reuse. Keep credentials server-side, log endpoint/model/prompt/schema provenance, and preserve deterministic validation, citation gates and human review. On unavailability, record an explicit pending/failed state. This supersedes earlier Gemini/provider choices.

## Latest runtime decision

User directive: remove Supabase entirely. Active browser APIs now use app-managed server sessions and the Databricks app server. Canonical store is `workspace.msl_demo.app_state` (`msl-app-state.v1`), warehouse `bccde8ce8d366533`, in the designated workspace. Read `docs/DOCTOR-PROFILING.md` and the shared decision's latest section before changing persistence. Supabase sources under `legacy/` and PostgreSQL migrations are retained history only. They are not active setup instructions. Older rules about Supabase RPCs/triggers below describe that baseline; the current equivalent protections are canonical doctor revision CAS, stored consent/assignments, doctor review and append-only application audit history. Do not resurrect Supabase authentication or treat a local simulation as published data.

## Project rules
- Shared architecture: read `../docs/DATA-PLATFORM-DECISION.md` and `../AGENTS.md` before component work when present. The user designated Databricks workspace `https://dbc-85372395-9d08.cloud.databricks.com` (ID `7474660613250664`) as the canonical source of truth for project domain data, including synthetic hospital data, KB, profile versions, matching and briefing records. Supabase remains an auth/operational serving layer with explicit projection or pending-write semantics. Existing Supabase components are not yet migrated: preserve their protections, document migration gaps, and never claim mocks or local simulations are connected Databricks data. If the shared documents are absent in an isolated checkout, obtain the shared decision before changing persistence architecture. Canonical catalog names and programmatic access remain unverified. Respect the console's automated-browser-control restriction.
- All database reads/writes from the UI go through `src/lib/msl/api.ts` (query options in `queries.ts`); a future backend job writes newsletters/articles/citations straight into the tables, so the UI must not hard-code content.
- Business rules (onboarding validation, applicability badge text, aggregate ordering, citation parsing) live as pure functions in `src/lib/msl/rules.ts` with tests in `rules.test.ts`; keep them pure so they stay testable.
- Patient-data link fields on `doctors` change only via the `link_patient_data` / `unlink_patient_data` database functions (a trigger blocks direct edits), so audit rows and sample newsletter seeding cannot be skipped.
- `audit_log` is append-only (no UPDATE/DELETE grants plus a blocking trigger); bookmark audit rows are written by a trigger on `bookmarks`, other actions by the data layer or the link functions.
- Pages that need a finished onboarding live under `src/routes/_authenticated/_onboarded/`, whose layout redirects unfinished doctors to `/onboarding`.
