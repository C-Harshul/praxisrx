# Repository packaging handoff

The repository root is the existing `screenshot-exact-match` directory. Its history, existing `origin` (`https://github.com/C-Harshul/screenshot-exact-match.git`), branch `codex/gemini-doctor-profiling` and HEAD `dab3e49` are preserved. Lovable project `9f271c6a-15ea-4d03-aa9f-e2461d3aa310` remains connected; pushes to a connected branch can synchronize there. No commit or push was made. Existing remote publication is not publication of this packaging work.

The enclosing project directory had a second, empty Git repository: unborn `main`, no commits/tracked files/remote. Its metadata was archived, not deleted, at `/private/tmp/msl-empty-wrapper-git-20261031-01a1905b`. Temporary-directory retention is not a long-term backup promise. The application `.git` was not moved or rewritten. There is now one repository boundary and no gitlink/submodule. Application code stays in place; shared runtime modules were not split into services.

## What changed

- Root README; eight detailed architecture pages and component READMEs; common architecture and sequence; local setup/walkthrough/troubleshooting.
- Shared decision/context/plan/architecture draft/KB prompt copied into repository `docs/` as explicitly dated snapshots. Parent originals preserved; handoff appended to shared plan. If another workstream updates parent documents, reconcile deliberately rather than treating snapshots as live synchronization.
- Script/fixture navigation, source licensing limits and a synthetic aggregate JSON derived from the built-in demo constant. No original patient CSV or generator was relocated or invented.
- `.gitignore` excludes all environment files except sanitized `.env.example`, local credentials, private artifacts and the pre-existing duplicate generated route tree. `.env` removal from the index is staged; the local file remains. This is the only packaging staging operation. The remaining packaging files are working-tree/untracked changes for review.

## Working tree and provenance

There were substantial concurrent tracked/untracked changes before packaging, including Databricks cutover, KB/review, hospital, matching and newsletter/delivery modules. They remain present and uncommitted. Do not treat the entire diff as documentation-only, discard it or commit it blindly. No implementation was moved or edited by packaging. Tests/build may regenerate standard local outputs. The branch name predates the hosted-only policy and does not describe an active external model path.

The prior tracked `.env` remains in published history. Removing it from the next tree does not rewrite that history; no secret rotation or historical cleanup is claimed. Token scans report only paths/categories and exclude ignored local secrets. Review and classify any genuine historical credential separately; do not print its value.

Clinical/runtime provenance remains version-pinned in existing source receipts and contracts. Latest packaged reviewer receipt: `2026-10-31T05:06:17.424Z`, release `kb-397404dd8e9883e092893f895a8c778fb67c7964aadf6734ab2b9b33500d2e72`, revision `89312ebe-fb56-4858-98b8-62cbfa0305d2`, 21 pending/zero approved/zero clinical items. The earlier synthetic hosted newsletter receipt is layout/inference evidence only, zero sends. Packaging did not rerun those live operations. [Validation](PACKAGING-VALIDATION.md) records new offline checks.

## Remaining developer decisions

Actual human clinical review and a nonempty release gate the clinical demo. A real authorized send additionally needs verified recipient metadata, subscription, sender OAuth and a configured HTTPS origin/proxy. No proxy is bundled, so do not claim the full send setup is one-command reproducible. Library publication currently depends on send-ready configuration/subscription. Clean install with the current frozen lock/transitive `tsx` remains unverified; coordinate any dependency changes with the implementation owner. Code licensing is undecided.

No new remote destination is required: the existing repository connection is preserved. Any later push/new destination is a separate user-authorized action; packaging does not request or imply it.
