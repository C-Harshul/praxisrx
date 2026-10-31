# Packaging validation snapshot

31 October 2026, America/New_York. Existing application branch `codex/gemini-doctor-profiling`, HEAD `dab3e49`; substantial concurrent uncommitted component work was present. Packaging adds documentation/fixtures/hygiene, preserves code and records this inspected state. Shared parent decision/context/plan were copied into the repository as labeled snapshots; later concurrent updates require reconciliation.

## Checks performed

| Check                                                                             | Result                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                        | 142 tests / 30 files passed, offline test transports                                                                                                                                                                                                                      |
| `npx tsc --noEmit`                                                                | Passed                                                                                                                                                                                                                                                                    |
| `npx tsc --noEmit --project kb/tsconfig.json`                                     | Passed                                                                                                                                                                                                                                                                    |
| `npm run check:newsletter-scripts`                                                | Passed                                                                                                                                                                                                                                                                    |
| `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s kb -p test_acquire.py` | 2 tests passed                                                                                                                                                                                                                                                            |
| `npm run build`                                                                   | Passed, Nitro Node output. Existing Vite tsconfig-paths advisory and chunk-size warnings remain nonblocking.                                                                                                                                                              |
| Offline synthetic newsletter preview                                              | Passed with `NEWSLETTER_PREVIEW_DIR=/private/tmp/msl-packaging-newsletter-preview npm run preview:newsletter`; no model, canonical publication or email call. Existing live-model artifact was preserved.                                                                 |
| Synthetic aggregate contract                                                      | Parsed through the active strict upload schema; fixed demo snapshot, no canonical write                                                                                                                                                                                   |
| Markdown local links and paths                                                    | Repository README/current docs/component README local targets checked; no missing file targets after completion                                                                                                                                                           |
| Mermaid                                                                           | Common diagram, sequence and eight component diagrams embedded in Markdown; balanced blocks and supported headers reviewed. No installed Mermaid parser/CLI, so rendering/syntax execution is unverified.                                                                 |
| Git whitespace                                                                    | `git diff --check` and `git diff --cached --check` passed; new packaging Markdown formatted with installed Prettier                                                                                                                                                       |
| Hygiene                                                                           | Candidate tracked/unignored content scanned for recognizable Databricks/GitHub/Google refresh/private-key/OAuth-secret patterns; no matches. Variable names only inspected for historical `.env`, never values printed. Pattern scan is not a comprehensive secret audit. |
| Repository boundary                                                               | One existing application repository; original history/remote preserved; empty outer metadata archived; no staged gitlink/submodule                                                                                                                                        |

Credential/config checks confirm `.env`, `.env.local`, `.env.gmail.local`, local credential files, artifacts/logs and duplicate generated tree are ignored; sanitized `.env.example` remains addable. `.env` removal is staged; local file retained. Historical HEAD `.env` contains Supabase project/publishable/browser configuration names; prior history was not rewritten. No assumption that a browser publishable key is a server secret was used to change code or rotate anything.

## Installed versions inspected

| Package                         | Installed                     |
| ------------------------------- | ----------------------------- |
| Node                            | 24.3.0                        |
| React                           | 19.2.8                        |
| TanStack Start / Router / Query | 1.168.60 / 1.170.41 / 5.101.4 |
| Tailwind                        | 4.3.3                         |
| TypeScript / Zod                | 5.9.3 / 3.25.76               |
| Vite / Vitest                   | 8.1.5 / 4.1.11                |
| tsx / Nitro                     | 4.23.15 / 3.0.260603-beta     |

The manifest supplies ranges for several packages; the existing `bun.lock` pins a resolution including `tsx` via Drizzle tooling. No npm lock or directly installed Bun executable is present in the inspected environment. No clean dependency reinstall/frozen-lock bootstrap was performed. Startup commands were checked against the current scripts/configuration; packaging did not restart other chats' running app/workers or verify a new login/live write. These limits are explicit in setup.

## Recorded live evidence, not rerun by packaging

- [KB reviewer API readback](../kb/exports/live-review-ui-readback.json): authenticated read-only list/detail/preview/denial checks, 21 pending and zero approvals. No decisions or clinical releases written by that check.
- [KB release receipt](../kb/exports/live-release-receipt.json) and related live receipts: canonical recorded versions/hash acknowledgments.
- [Sanitized synthetic newsletter inference receipt](evidence/synthetic-newsletter-inference.json): Databricks hosted entity `system.ai.gpt-oss-20b`, config 1, verified at `2026-10-31T04:53:29.561Z`, 764 tokens, 2,926 ms, no clinical publication, zero email sends. Copied from existing local artifact; packaging did not invoke inference.
- Profile/app/hospital live verification is described in original component handoffs. Hospital's recorded checks do not demonstrate a live upload. No end-to-end approved clinical briefing/email/inbox receipt was found.

## Remaining gaps

Actual human clinical review/nonempty release; current doctor consent/acknowledged aggregate/confirmation as needed; authorized recipient metadata/subscription, sender OAuth and operator-configured local HTTPS. Current newsletter publication requires send-ready configuration/subscription. Cross-record races, no exactly-once Gmail guarantee, historical recall/archival and undecided project code licensing remain explicit. Production hosting is outside the local demo requirement. No commit, push, clinical approval, live data modification or email send was performed for packaging.
