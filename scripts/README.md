# Local operator and worker scripts

Run from the repository root. These are entry points into the shared application modules, not separate services. [Setup](../docs/demo/setup.md) provides Node/environment commands; [architecture](../docs/architecture/overview.md) defines ownership.

| Scripts                                                                 | Effect                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `configure-databricks-local.ts`, `provision-kb-reviewer.ts --create`    | Ignored local secrets/accounts; no clinical approval                                                                      |
| `setup-databricks.ts`, `setup-gmail.ts`, `configure-email-recipient.ts` | Explicit canonical provisioning/metadata writes; not startup checks                                                       |
| `run-databricks-workers.ts`                                             | Persisted profiling, matching, generation, delivery and Gmail notification loop; configured send modes can send real mail |
| `preview-newsletter.ts`                                                 | Default fictional offline HTML/text; `--live-model` performs explicit hosted inference                                    |
| `authorize-gmail.ts`                                                    | Interactive OAuth, writes ignored local refresh token; no email send                                                      |
| `review-gmail-report.ts`                                                | Explicit designated human delivery-evidence attestation/canonical write                                                   |
| `check-*-live.ts`, `check-canonical-write.ts`                           | Read source first: some sign in/read, others mutate queues/canonical state or invoke inference                            |
| `check-model-hosting.ts`                                                | Live hosted metadata check without inference                                                                              |
| `check-*.mjs` PostgreSQL checks                                         | Retired offline PGlite migration baselines, not active Databricks setup                                                   |

Never log credentials or copy local credentials into Git. `scripts/fixtures` is synthetic offline input. Tests/build and documentation validation must not approve clinical evidence or send mail. See [checks](../docs/PACKAGING-VALIDATION.md).
