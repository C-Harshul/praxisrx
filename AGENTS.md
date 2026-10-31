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

## Project rules
- All database reads/writes from the UI go through `src/lib/msl/api.ts` (query options in `queries.ts`); a future backend job writes newsletters/articles/citations straight into the tables, so the UI must not hard-code content.
- Business rules (onboarding validation, applicability badge text, aggregate ordering, citation parsing) live as pure functions in `src/lib/msl/rules.ts` with tests in `rules.test.ts`; keep them pure so they stay testable.
- Patient-data link fields on `doctors` change only via the `link_patient_data` / `unlink_patient_data` database functions (a trigger blocks direct edits), so audit rows and sample newsletter seeding cannot be skipped.
- `audit_log` is append-only (no UPDATE/DELETE grants plus a blocking trigger); bookmark audit rows are written by a trigger on `bookmarks`, other actions by the data layer or the link functions.
- Pages that need a finished onboarding live under `src/routes/_authenticated/_onboarded/`, whose layout redirects unfinished doctors to `/onboarding`.
