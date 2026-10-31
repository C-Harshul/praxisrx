# Local setup

All commands run from the repository root, `screenshot-exact-match`. Node 24.3.0 and the installed dependencies were used for packaging checks; Python 3.9+ is needed only for research acquisition. Use an authorized Databricks CLI supporting `auth login`/`auth token`. No console automation or production hosting is needed.

## Dependencies and configuration

`bun.lock` is the existing tracked dependency lock. With Bun installed, `bun install --frozen-lockfile` is the intended frozen install; packaging did not reinstall dependencies or verify a clean install. Alternatively `npm install --package-lock=false` resolves the manifest without creating a competing lock, but is not frozen. `tsx` is installed transitively today and used by existing scripts; if a future clean resolution loses it, coordinate a direct devDependency and lock update. Do not silently switch lock formats.

For an existing demo checkout, preserve `.env.local`, `demo-credentials.local` and `reviewer-credentials.local`. The account UUIDs must agree with canonical doctor records; replacing them does not migrate accounts. Do not copy `.env.example` over a working `.env.local`, or put its placeholder session secret into service. The example is a sanitized variable reference.

First-time local configuration only:

```sh
node --import tsx scripts/configure-databricks-local.ts
databricks auth login --host https://dbc-85372395-9d08.cloud.databricks.com --profile msl-canonical
```

The first command writes missing server defaults/random secrets, synthetic account hashes and ignored mode-0600 local credentials. It does not provision Databricks rows. CLI login is interactive OAuth. No token is printed or placed in browser code.

## Canonical prerequisites

Designated workspace: `7474660613250664`; warehouse `bccde8ce8d366533`; app table `workspace.msl_demo.app_state`; KB table `workspace.msl_demo.kb_records`. These exist according to recorded handoffs. Reuse them; do not create a competing workspace/catalog.

Only if synthetic account rows/views are genuinely missing, a trusted single operator may run this explicit canonical write. It preserves existing IDs, but new local account UUIDs create new doctors:

```sh
node --env-file=.env.local --import tsx scripts/setup-databricks.ts
```

Only if the KB needs initial setup/ingestion, the governed operator runs the documented KB commands below. They perform network acquisition/local curation and canonical writes. They are not required to start an already configured demo and were not run by packaging:

```sh
python3 kb/acquire.py --as-of 2026-10-30 --days 90
node --import tsx kb/curate.ts
node --env-file=.env.local --import tsx kb/operate.ts setup
node --env-file=.env.local --import tsx kb/operate.ts sync
node --env-file=.env.local --import tsx kb/operate.ts verify
```

The dated curation is intentionally pinned. New research needs deliberate selection/review. An initial empty clinical pointer may need the governed `export`/`release` procedure in [KB handoff](../KNOWLEDGE-BASE.md); do not invent approval to fill it. Current recorded pointer already exists. The app and workers do not substitute local exports when canonical reads fail.

A trusted operator can provision the dedicated local reviewer once:

```sh
node --import tsx scripts/provision-kb-reviewer.ts --create
```

It adds the account, reviewer registry and allowlist to ignored local server config and saves `reviewer-credentials.local`; it fails if a reviewer already exists. It does not approve or publish research. Registry identity must represent the actual human doing the review.

## Start the application and persisted workers

Terminal 1:

```sh
node --env-file=.env.local node_modules/vite/bin/vite.js dev --port 8081 --strictPort
```

Terminal 2:

```sh
EMAIL_MODE=preview EMAIL_SEND_ENABLED=false node --env-file=.env.local --import tsx scripts/run-databricks-workers.ts
```

The explicit environment overrides ensure this documented startup never enables sending even if local secrets contain email settings. Node loads environment files into the server; no `source` or secret dump is needed. Open `http://localhost:8081/auth`, `/hospital` and `/review`. Use credentials locally; do not paste them into an issue/chat. `APP_ORIGIN` must equal `http://localhost:8081`. Strict port refuses a conflicting server rather than moving silently; reuse the existing server or resolve its owner before starting another.

The runner calls five independent worker functions, one due item per invocation, then sleeps 30 seconds. Queues, leases and results persist in Databricks. `gmail-notifications: setup_required` is expected without optional mailbox setup. Standalone HTTP triggers use POST `/api/profiling/run`, `/api/matching/run`, `/api/newsletter/run`, `/api/delivery/run`, `/api/gmail-notifications/run` with a server-only Bearer `LOVABLE_CRON_SECRET`. No scheduler is deployed.

## Optional authorized Gmail setup

Full send is blocked until a real recipient is verified/authorized, sender OAuth is complete and the app has an operator-configured HTTPS origin. Packaging performs none of those actions. `test` mode sends real email. [Email architecture](../architecture/email-delivery.md) explains outcomes and OAuth scopes.

1. Configure Google OAuth client/Gmail API and server-only `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`. Allow the script's loopback callback `http://127.0.0.1:8484/oauth/gmail` for the chosen client configuration.
2. Explicit sender consent: `node --env-file=.env.local --import tsx scripts/authorize-gmail.ts`. The human opens the printed consent URL. `.env.gmail.local` receives refresh token/sender; keep both environment files private. This does not send email.
3. Put an actual authorized `EMAIL_RECIPIENTS_JSON` entry in server secrets: fields `doctor_id`, `id`, `email`, `version`, `verified_at`, `authorized_at`, `modes:["test"]`. UUIDs must refer to the correct doctor/recipient. Use actual verification/permission timestamps, never guessed recipients or fabricated attestations. Set a random `EMAIL_UNSUBSCRIBE_SECRET` privately.
4. Explicit metadata publication: `node --env-file=.env.local --env-file=.env.gmail.local --import tsx scripts/configure-email-recipient.ts DOCTOR_UUID --attest-verified-and-authorized`. This is a canonical write, not a send. The doctor must separately subscribe in Library.
5. Configure a local HTTPS reverse proxy/tunnel to port 8081, set `APP_ORIGIN` to that exact HTTPS origin, and sign in there. No proxy/certificate/tunnel is provided or tested by this repository. Without it, sending remains blocked by `sendConfigured`/`email_https_origin_required`. An HTTP localhost preview is supported.
6. Only for the authorized send session, set `EMAIL_MODE=test`, `EMAIL_SEND_ENABLED=true` in private config and start app/workers with both environment files: `npm run dev:email -- --port 8081 --strictPort` and `npm run workers:email`. These existing scripts load both files. Unlike the preview command above, they permit configured sends. Enabling workers can promote an existing valid preview automatically; subscribe only when ready.
7. Before enabling sending in step 6, configure the required signed Pub/Sub channel and acknowledged mailbox watch. Configure the four `GMAIL_PUBSUB_*` variables, authenticated public HTTPS push, Gmail publish permissions, and run `scripts/setup-gmail.ts` then `scripts/setup-gmail.ts --watch` with the same Node/env invocation. These create canonical mailbox state and Gmail watch, not mail. Worker renews the watch; expired history needs operator recovery. No Google resources were provisioned here.

## Offline verification

```sh
npm test
npx tsc --noEmit
npx tsc --noEmit --project kb/tsconfig.json
npm run check:newsletter-scripts
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s kb -p test_acquire.py
npm run build
npm run preview:newsletter
```

These use test fixtures/build tooling. The preview command uses deterministic fictional evidence with no network send/inference. `test:*-db` scripts target historical PostgreSQL baselines. Files named `check-*-live.ts`, `setup-*.ts`, review/publish commands and `preview:newsletter -- --live-model` have different network/write/inference effects; do not run them just to verify documentation.
