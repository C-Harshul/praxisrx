> Packaging status, 31 October 2026: see [current component architecture](architecture/email-delivery.md) and [local setup](demo/setup.md). Newsletter, subscription, outbox, Gmail transport and notification/reconciliation code now exists in the shared runtime. Statements below that the consumer must still be implemented are original ownership requirements, not the latest implementation inventory. No real approved clinical newsletter or email receipt is established by them.

# Newsletter and Gmail delivery handoff v1

Status: implemented locally by the Newsletter Generation and Email Delivery workstream, 31 October 2026. Databricks availability and a synthetic exact-claim inference/preview were verified live. Clinical publication and Gmail transport have not been exercised live: the reviewed release is empty, neither live doctor profile is confirmed, and Google/email configuration is pending. See `NEWSLETTER-DELIVERY.md` for runnable setup, safeguards, limitations and receipts.

## Producer: Matching

Matching owns the canonically persisted `ranked-evidence-package.v1`, including confirmed profile/mix versions, reviewed KB pointer revision, ranked item/claim/source evidence and deterministic reasons. It never calls the LLM or sends email. The generation worker consumes the existing `readCurrentRankedPackage` boundary, requires a governed clinical release/hash/review membership, and recomputes matching against it. Historical runs without the current package are not publishable inputs. An empty approved result records an empty cycle, not invented content.

## Consumer: Newsletter generation

`runNewsletterJob` is a separate persisted, CAS-leased worker. It owns one stable generation/newsletter identity per doctor/matching run, at most three bounded draft attempts and explicit empty/preview/failure/superseded states. Its Databricks-hosted model selects/organizes only supplied reviewed claim IDs. Deterministic rendering copies exact approved wording, builds item-scoped numbered citations and checks every clinical text surface. No external inference or silent fallback exists. Unsupported free text, references, numbers or disclosures fail; unknown eligibility/exclusions/funding stay explicit. Scientific correctness remains the human KB review responsibility, not an assertion made by citation-ID checks.

Generation rechecks current profile, consent, aggregate snapshot and evidence immediately before publication. A doctor CAS atomically commits validated newsletter/articles/citations, model/review/version provenance, publication marker, audit and frozen delivery task. Ambiguous commits are reconciled by canonical operation receipts. A separate KB pointer check before/after publication and before send fences changed evidence without claiming distributed transactions or historical recall.

Without configured Gmail transport and an explicitly authorized, canonically verified recipient, content stays in a labeled no-send preview outside the published library. The doctor can inspect its escaped text in Library. Once normal publication is configured, unsubscribe affects the email task, not the availability of future in-app publications. Current previews can later promote using their frozen gated content, without another model call.

## Suppression and identity

**Validated canonical in-app publication suppresses the published stable KB item IDs from future matching.** Matching completion, drafts, previews, Gmail acceptance, delivery and reading do not independently suppress. A failed email never causes the same research to be regenerated as another newsletter. Generation serializes per doctor and checks already-published overlaps before committing. Newsletter/article IDs are stable derivatives of the generation identity.

`sent_at` remains a compatibility/library timestamp, not evidence of an email event. Publication provenance records `published_at` separately. Email delivery tasks preserve a stable newsletter/recipient logical key, RFC Message-ID, render/content hash, recipient/sender fingerprints and bounded attempt/event history. Doctor reading is an independent authenticated `article_opened` audit event; it never gates worker completion or cadence.

## Consumer: Gmail delivery

`runDeliveryJob` independently claims the canonical outbox and performs a final verified-recipient, canonical subscription, consent/profile/snapshot/evidence check immediately before sending. Recipient facts are canonically published by an explicit administrative attestation; server configuration is an additional allowlist. Synthetic sign-in/persona names never imply a real email address. Default is unsubscribed and preview-only. Weekly/fortnightly elapsed scheduling uses an explicit UTC default and throttles against the previous accepted send.

Email is rendered as accessible HTML/plain text from an allowlisted DTO, with public source links, normal authenticated article URLs, sender identity and scoped unsubscribe/preferences links. Doctor-specific aggregate percentages/counts/cohort labels, applicability badges, hospital assignments and patient records are excluded. Research text/URLs are escaped and checked. The outbox reuses frozen content; email errors never call the LLM.

Statuses distinguish queued, sending, provider-accepted, delivered, bounced, complained, failed, unknown, cancelled, held and preview. A positive Gmail response or correlated Sent message means acceptance only. Explicit rate-limit rejection may retry at most five times in 24 hours with bounded backoff. Gmail has no send idempotency guarantee: timeouts, server errors and expired send leases become unknown and never blindly resend. At most five hourly Sent/header reconciliation checks recover prior acceptance; missing results leave the outcome unknown for operator resolution.

`receiveGmailPush` verifies Google's signed Pub/Sub OIDC signature, issuer, audience, verified service-account identity and token lifetime, then validates subscription/mailbox identity and persists event-ID/hash deduplication before acknowledgment. Identity conflicts and unmatched reports are quarantined. `runGmailNotificationJob` reconciles paged mailbox history and renews watches while preserving checkpoints. Durable CAS guards concurrent checkpoint updates. Signed mailbox notifications do not prove recipient delivery.

Gmail supplies no transactional delivered/bounced/complaint webhook. Correlated delivery reports conservatively suppress future sending pending human review; an explicit designated reviewer can attest actual report outcomes with the provided operation script. Unsupported or absent delivery evidence remains unknown, never fabricated. Hard bounces and complaints suppress future sends. This Gmail capability limitation is separate from implemented transport and notification security.

## Ownership and remaining setup

- App/profile owner: preserve authenticated ownership, doctor review, current profile/mix/consent invalidation and the canonical doctor CAS. Do not expose provider credentials, raw SQL or unverified recipients to browser code.
- KB owner: publish human-reviewed clinical releases with exact item/source/claim versions. Non-unknown funding/status disclosures and any explicit eligibility statements need atomic approved claims for this conservative renderer. Retraction/invalidation must disable the pointer; consumers recheck it.
- Newsletter/delivery owner: generation/gates, canonical publication, frozen email rendering, subscription/unsubscribe, queue/lease/retry/reconciliation, Gmail OAuth transport, Pub/Sub verification/history, preview UI and operations scripts are implemented. Relevant tests, TypeScript and build are required; offline simulations are labeled.
- Operator/user: create/configure the chosen Google project and sender OAuth, authenticated Pub/Sub push and grants, actual HTTPS app origin, server secrets, explicit verified recipient authorization, doctor subscription and hosted schedules. No paid account, recipient grant, Google resources, live email or provider acceptance/delivery is claimed by implementation alone.

Full setup and commands: `NEWSLETTER-DELIVERY.md`. Preview artifacts and live model receipt: `artifacts/newsletter-preview/`. No clinical fixture is inserted into Databricks; no human approval or doctor confirmation was fabricated.
