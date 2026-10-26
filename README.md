# Crafted Cloud Functions

This repository contains all of Crafted's Google Cloud Functions. These functions handle
backend processes for the Crafted platform (user scans, outreach email sending, social-token
refresh, campaign analytics, and one-off maintenance scripts).

Two tooling generations live here side by side:

- **`creator-outreach`** is the **modernization reference**: TypeScript, Biome, vitest, husky +
  commitlint, an Nx-driven npm workspace, and full CI/CD (per-branch deploys of
  `creator-outreach-<env>` into one shared GCP project plus a manual production promotion).
  Everything below under
  [creator-outreach infrastructure](#creator-outreach-infrastructure) applies only to it.
- **`refresh-instagram-rates` and `refresh-tiktok-rates`** are the two monthly rate functions on
  the same template, with their own workflows and a pipeline-managed Cloud Scheduler job each;
  see [Monthly rate refresh](#monthly-rate-refresh).
- **All other functions** remain on the **legacy per-directory pattern** — each is a standalone
  plain-JavaScript folder with its own `package.json` and `node_modules`, no shared tooling, and
  no CI. Migrating them to the `creator-outreach` template is future, separately green-lit work.

## Folder Structure

```bash
crafted_cloud_functions/
│
├── functions/
│   ├── creator-outreach/              ← MODERN reference (TypeScript, CI/CD) — Studio + Amplify outreach
│   ├── refresh-instagram-rates/       ← MODERN (TypeScript, CI/CD) — monthly Instagram suggested-rate refresh
│   ├── refresh-tiktok-rates/          ← MODERN (TypeScript, CI/CD) — monthly TikTok suggested-rate refresh
│   ├── getBalancedUsers/              ← legacy JS
│   ├── loadUsers/                     ← legacy JS
│   ├── processInstagramComments/      ← legacy JS
│   ├── refreshAllCampaignAnalytics/   ← legacy JS
│   ├── refreshTokens/                 ← legacy JS
│   ├── updateCampaignCreatorSocials/  ← legacy JS
│   └── updateInstagramDemographics/   ← legacy JS
│
├── maintenance/                       ← one-off scripts (run manually, not deployed)
├── packages/
│   └── shared-config/                 ← @crafted/shared-config (Biome + lint-staged, used by creator-outreach)
├── .github/workflows/                 ← creator-outreach CI/CD (build + prod-deploy)
├── package.json                       ← root npm workspace (Nx, husky, commitlint)
├── .gitignore
└── README.md
```

Each **legacy** function folder contains:
- `index.js`: registers the function with `@google-cloud/functions-framework`
- `package.json`: function-specific dependencies and scripts
- Other implementation `.js` files (e.g. `user.js`, `campaign.js`)

## Functions Description

Each folder inside `functions/` is a separate Google Cloud Function:

1. **creator-outreach**: Unified Studio + Amplify creator outreach — scans the Firebase user
   base, sends personalized SendGrid emails, and stores blast results. The `server` API calls it
   fire-and-forget when a brand starts a creator blast. (Modern reference — see below.)
2. **getBalancedUsers**: Retrieves a list of users with their balances.
3. **loadUsers**: Loads and reformats user data.
4. **processInstagramComments**: Processes comments from Instagram posts.
5. **refreshAllCampaignAnalytics**: Refreshes analytics data for campaigns (TikTok + Instagram).
6. **refresh-instagram-rates**: Monthly refresh of every creator's Instagram suggested rate and
   median plays. (Modern template — see [Monthly rate refresh](#monthly-rate-refresh).)
7. **refresh-tiktok-rates**: Monthly refresh of every creator's TikTok suggested rate and
   performance. (Modern template — see [Monthly rate refresh](#monthly-rate-refresh).)
8. **refreshTokens**: Refreshes authentication tokens for third-party APIs.
9. **updateCampaignCreatorSocials**: Updates creator social data inside campaigns.
10. **updateInstagramDemographics**: Updates demographic information from Instagram data.

## Local Development Setup (legacy functions)

To run a **legacy** function locally:

1. Navigate to the function's directory:
   ```bash
   cd functions/[function-name]
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the function's directory with the required variables.
4. Run the function locally:
   ```bash
   npm run dev
   ```
   This uses `@google-cloud/functions-framework` to start the function on
   `http://localhost:8080` by default. Send HTTP requests to that address to test it.

## Cloud SDK Emulator Setup

For a more accurate Google Cloud-like environment, use the Cloud SDK:

1. Install Cloud SDK (if you don't have it):
   ```bash
   curl https://sdk.cloud.google.com | bash
   exec -l $SHELL
   gcloud init
   ```
2. Install the beta component (if necessary):
   ```bash
   gcloud components install beta
   ```

---

# creator-outreach infrastructure

`creator-outreach` is the modernized reference function. If you have never seen it, read this
section top to bottom — it takes you from a clone to a green PR to a dev deploy, and explains the
manual per-environment deploy and the production promotion.

## Runtime & platform

- **Generation:** Gen2 Cloud Functions (Cloud Run-backed).
- **Runtime:** `nodejs22`.
- **Region:** `us-central1`.
- **Trigger:** HTTP.
- **Entry point / in-code target:** the string `creator-outreach` (`index.ts` registers
  `functions.http("creator-outreach", creatorOutreach)`; the gcloud `--entry-point` must equal it
  — a mismatch deploys but fails at cold start with `Function '<name>' is not defined in the
  provided module`).
- **Deployed function name:** `creator-outreach-<env>` — `creator-outreach-dev` /
  `creator-outreach-staging` / `creator-outreach-prod`. All three share **one hosting GCP project**
  and are isolated by name, so the deployed name carries an env suffix while the `--entry-point`
  stays `creator-outreach`. Do **not** add the suffix to the in-code `functions.http` target.
- **Resources:** 2 vCPU, 4Gi memory, concurrency 1, timeout 3600s, max 50 instances.
- **Runtime service account:** the project's default compute SA
  (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`).
- **Runtime env vars:** `NODE_ENV` (`dev` | `staging` | `prod`) and `LOG_EXECUTION_ID=true`.

Besides the two rate functions ([Monthly rate refresh](#monthly-rate-refresh)), every other
function in `functions/` is still on the legacy per-directory JavaScript pattern described above.

## Multi-env layout (one shared hosting project, env-in-name)

All three environments deploy into a **single shared GCP hosting project** (the repo-level
`GCP_PROJECT` variable). The environment is encoded in the **deployed function name**, not in the
project. The branch you push to selects which function name is deployed:

| Environment | Branch / trigger     | Deployed function name      | `NODE_ENV` |
|-------------|----------------------|-----------------------------|------------|
| dev         | push to `dev`        | `creator-outreach-dev`      | `dev`      |
| staging     | push/merge to `main` | `creator-outreach-staging`  | `staging`  |
| prod        | manual promotion     | `creator-outreach-prod`     | `prod`     |

The gcloud `--entry-point` stays `creator-outreach` in every environment (it is the in-code
`functions.http` target); only the deployed name gets the env suffix, and every deploy passes the
same shared `--project=$GCP_PROJECT`.

`NODE_ENV` is the single switch that picks the environment at runtime. In
`functions/creator-outreach/lib/firebase.ts` it selects the per-env Firebase **data** project's
database URL and the service account key file it loads (`config/devServiceAccountKey.json` /
`config/stagingServiceAccountKey.json` / `config/serviceAccountKey.json`, backed by the Firebase
data projects `crafted-dev-v1` / `crafted-staging-v1` / `crafted-v1`); it also sets the Sentry
`environment` tag in `lib/sentry.ts`. An unknown `NODE_ENV`, or a missing key file, throws at
startup. **Only the function hosting project is shared — the Firebase data projects stay per-env.**

## CI/CD flow

Two workflow files drive `creator-outreach` (the rate functions have their own pair, see
[Monthly rate refresh](#monthly-rate-refresh)):

- `.github/workflows/creator-outreach-build.yml` — PR quality gate + build preview + the
  `dev`/`staging` deploy jobs.
- `.github/workflows/creator-outreach-deploy-prod.yml` — the manual production promotion.

The shared deploy config is **repo-level** (set once): `GCP_PROJECT` (the one hosting project) and
`GCP_REGION` as variables, plus the `GCP_SA_KEY` (the single deploy service-account key),
`SENDGRID_API_KEY`, and `SENTRY_DSN` secrets. The two runtime keys live at the repository level
because they are **identical across all environments** — one SendGrid key and one Sentry DSN serve
dev, staging, and prod alike (one DSN still separates events by env because `lib/sentry.ts` sets
Sentry's `environment` from `NODE_ENV`). The **only per-env secret is `FIREBASE_SA_KEY`**, because
the dev/staging/prod Firebase **data** projects genuinely differ. Three GitHub Environments —
`dev`, `staging`, and `prod` — hold that `FIREBASE_SA_KEY` and, on `prod`, the required-reviewer
protection rule. If one env ever needs a different SendGrid/Sentry value, add an environment-level
secret of the same name — GitHub resolves `secrets.*` as environment → repository, so it overrides
the repo-level one with no workflow change. The full list is the **Secrets & Variables Matrix** in
`.agent/exec-plans/creator-outreach-modernization.md`.

**On a pull request** (to `dev` or `main`), two jobs run and **nothing deploys**:
- `quality` — `npm run check:ci` (Biome lint + format), `npm run typecheck` (`tsc --noEmit`), and
  `npm run test:ci` (vitest).
- `build-preview` — a `pack build` buildpack **dry-run** that compiles and produces a deployable
  image locally, with no push and no cloud credentials. This is the credential-free proof that the
  TypeScript-build-at-deploy actually works (there is no `--dry-run` on `gcloud functions deploy`).

**On a push to `dev`** the `deploy-dev` job deploys the function `creator-outreach-dev`; **on a
push/merge to `main`** the `deploy-staging` job deploys `creator-outreach-staging` — both into the
shared hosting project. Both `need` the `quality` and `build-preview` jobs and are branch-guarded,
so neither runs on a pull request.

**Production** is intentionally separate: the `creator-outreach-deploy-prod.yml` workflow is
`workflow_dispatch`-only and runs in the `prod` GitHub Environment, which is configured with a
**required reviewer** — the run pauses for a human approval before it deploys
`creator-outreach-prod` into the same shared hosting project.

## TypeScript build-at-deploy mechanism

The deploy uploads **TypeScript source** — no compiled JS is committed. GCF Gen2 builds it with
Google's Cloud Native Buildpacks at deploy time:

1. The buildpack runs `npm ci` against the function's **standalone nested `package-lock.json`**
   (`functions/creator-outreach/package-lock.json`), which resolves entirely from the public npm
   registry.
2. Because a `gcp-build` script is present, the buildpack runs it with devDependencies available:
   `tsc -p tsconfig.json` compiles `*.ts` → `dist/*.js`, then the Handlebars `templates/*.hbs` are
   copied into `dist/templates/` (the compiled `lib/email.js` resolves them via
   `../templates` relative to `dist/lib`, so they must live under `dist/`).
3. `package.json` `"main": "dist/index.js"` tells the functions-framework which module to load;
   the registered target `creator-outreach` is found inside it.

**Deploy contract** (breaking any of these breaks the deploy-time `npm ci` or `tsc`):
- `tsconfig.json` is **self-contained** — no `extends` of a workspace path.
- The function manifest **never** lists `@crafted/shared-config` (or any private workspace
  package) in its dependencies/devDependencies — `npm ci` at deploy cannot resolve a workspace
  symlink. Biome resolves the shared config only at dev/CI time from the root-hoisted
  `node_modules`, and `biome.json` is excluded from the source upload via `.gcloudignore`.
- The nested `package-lock.json` is standalone and public-registry-only. Because the function is
  a workspace member, a root `npm install` does **not** maintain it — regenerate it deliberately
  (see `.agent/exec-plans/creator-outreach-modernization.md`, "Concrete Steps") whenever deps
  change. The `pack build` dry-run runs `npm ci` and fails the PR if the lockfile drifts.

This mechanism was proven end-to-end by a credential-free `pack build` against
`gcr.io/buildpacks/builder:google-22` (`npm ci` → `gcp-build` → `node --check dist/index.js` →
image export, exit 0). Because `gcp-build` runs during **every** `gcloud functions deploy`, no
local build is needed before deploying; `npm run build` locally is only to inspect the output.

## Auth model — currently public (`--allow-unauthenticated`)

> **The function is deployed with `--allow-unauthenticated` in ALL THREE environments** (dev,
> staging, prod). That flag grants the `allUsers` principal the Cloud Run `roles/run.invoker`
> role, so the endpoint is publicly invocable.

This is the **current / legacy posture, preserved intentionally**. The running `server` → CF
integration calls this function fire-and-forget over plain `fetch` with no identity token; keeping
the endpoint public is what lets that integration keep working while the modernization ships. The
modernization is behavior-preserving and does **not** change auth.

**Planned hardening (tracked fast-follow, not part of this ship):**
1. The `server` attaches a **Google-signed OIDC identity token** (audience = the CF's `*.run.app`
   URL) to its `fetch` before firing.
2. The server's invoker service account is granted `roles/run.invoker` on the function.
3. **Only then** is `--allow-unauthenticated` removed from the deploy — CF and server shipping
   **together**, so the integration never 403s.

This is a coordinated cross-repo change tracked in `server/.agent/exec-plans/creator-outreach-auth.md`
(Notion ticket [353]).

> **Org-policy risk:** deploying with `--allow-unauthenticated` requires the org to permit public
> Cloud Run services. An org policy that forbids public Cloud Run (e.g.
> `iam.allowedPolicyMemberDomains` / a "domain restricted sharing" constraint) would block the
> `allUsers` binding and fail the deploy. If that happens, the auth fast-follow above becomes a
> hard dependency and the function must deploy privately with the server token from the start.
> See the Risks section of `.agent/exec-plans/creator-outreach-modernization.md`.

## Local development & quality gate (creator-outreach)

All commands run from the **repo root** (the npm workspace):

```bash
npm ci            # install the workspace (root + the three function members + shared-config)
npm run check:ci  # Biome lint + format check (fans out via Nx)
npm run typecheck # tsc --noEmit
npm run test:ci   # vitest
npm run build -w creator-outreach   # emits dist/index.js, dist/lib/*.js, dist/templates/*.hbs
```

Commits go through husky: `pre-commit` runs lint-staged (Biome on staged files) + tests, and
`commit-msg` enforces Conventional Commits (`npm run cz` builds one interactively). To run the
function locally with the functions-framework:

```bash
cd functions/creator-outreach
# place a Firebase key at config/<env>ServiceAccountKey.json and set NODE_ENV
npm run dev       # builds then starts functions-framework --target=creator-outreach on :8080
```

## Manual deploy (creator-outreach)

These commands are copy-pasteable. All three environments deploy into the **one shared hosting
project**; the env lives in the function NAME and in `NODE_ENV`. `gcp-build` runs during every
`gcloud functions deploy`, so **no local build is required first**.

```bash
# Prereqs: gcloud authenticated (gcloud auth login); pack is optional, only for a local dry-run.
# Point at the single shared hosting project (the repo-level GCP_PROJECT value):
export GCP_PROJECT="<shared-hosting-project-id>"

# 1) Place the matching Firebase Admin key at the path lib/firebase.ts expects:
#      dev     -> functions/creator-outreach/config/devServiceAccountKey.json
#      staging -> functions/creator-outreach/config/stagingServiceAccountKey.json
#      prod    -> functions/creator-outreach/config/serviceAccountKey.json

# 2) Write the runtime env file (NODE_ENV MUST match the deployed function's env):
cat > env.yaml <<'EOF'
NODE_ENV: "dev"                 # dev | staging | prod
SENDGRID_API_KEY: "SG.xxxx"
SENTRY_DSN: "https://xxxx"
LOG_EXECUTION_ID: "true"
EOF

# 3) Deploy. dev is shown; for staging use name creator-outreach-staging (key stagingServiceAccountKey.json,
#    NODE_ENV=staging) and for prod use name creator-outreach-prod (key serviceAccountKey.json, NODE_ENV=prod).
#    --project ($GCP_PROJECT) and --entry-point (creator-outreach) are the SAME in every env — only the
#    deployed name and NODE_ENV change. KEEP --allow-unauthenticated (see the auth model above).
gcloud functions deploy creator-outreach-dev \
  --gen2 \
  --project="$GCP_PROJECT" \
  --region=us-central1 \
  --runtime=nodejs22 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=creator-outreach \
  --source=functions/creator-outreach \
  --env-vars-file=env.yaml \
  --memory=4Gi --cpu=2 --timeout=3600s --concurrency=1 --max-instances=50

# 4) Print the deployed URL (set the server's per-env CF_CREATOR_OUTREACH_URL to it):
gcloud functions describe creator-outreach-dev --gen2 --region=us-central1 \
  --project="$GCP_PROJECT" --format='value(serviceConfig.uri)'
```

### Manual production promotion (preferred — goes through the approval gate)

Production is promoted through the `workflow_dispatch` workflow so it passes the `prod`
Environment's required-reviewer gate. Do **not** run a local `gcloud` deploy of
`creator-outreach-prod` for a normal release.

- **GitHub UI:** Actions → **"creator-outreach Production Deploy"** → **Run workflow** →
  (optional) set the `ref` input to the git SHA/tag you validated on `main`/staging → **Run**.
  The run pauses for approval before deploying `creator-outreach-prod`.
- **CLI equivalent:**
  ```bash
  gh workflow run creator-outreach-deploy-prod.yml --ref main -f ref=<sha-or-tag>
  ```

---

## Git Commit Convention (creator-outreach)

Conventional Commits, enforced by commitlint via the `commit-msg` hook:

```
feat: add Instagram profile picture caching during token refresh
fix: handle TikTok refresh_token rotation correctly
chore: update Firebase SDK
```

## Scheduled legacy social functions

These functions are standalone HTTP services under `functions/`. Cloud Scheduler
invokes their deployed URLs; their source folders are uploaded and deployed
independently. `creator-outreach` has its own workspace and deployment workflow
above, and the two monthly rate functions have theirs in
[Monthly rate refresh](#monthly-rate-refresh). `maintenance/` holds one-off operator
scripts, not maintained regression tests.

| Source folder | Registered HTTP entry point | Work | Supported query scope |
| --- | --- | --- | --- |
| `functions/refreshTokens` | `refreshTiktokAccessTokens` | Refresh TikTok and Instagram Login tokens | `user_id` |
| `functions/updateInstagramDemographics` | `fetchAndUpdateInstagramDemographics` | Refresh Instagram audience demographics | `user_id` |
| `functions/processInstagramComments` | `processInstagramComments` | Collect comments for campaign posts | `campaign_id` |
| `functions/refreshAllCampaignAnalytics` | `refreshAllCampaignAnalytics` | Refresh campaign performance and link clicks | `campaign_id` |

### Experience flags and background maintenance

`ENABLE_CREATOR_ONBOARDING` on the server and
`REACT_APP_ENABLE_CREATOR_ONBOARDING` in the browser control the new creator
experience. Both default off; only the exact value `true` enables them. Instagram
Login additionally requires `ENABLE_INSTAGRAM_LOGIN` on the server and
`REACT_APP_ENABLE_INSTAGRAM_LOGIN` in the browser, together with the corresponding
master flag. The server reads its flags per request; browser flags are build-time
configuration.

Scheduled functions do not read these experience flags. Disabling the experience
does not stop token rotation, stored-rate refresh, error recording or Graph upkeep
for existing accounts. Keep their schedules and operational credentials available
when disabling or rolling back the experience. Additive social metadata and
background refreshes do not expose the new interface. Do not add an experience
flag to these function deployments or use the browser rollout as a worker switch.

Existing Instagram-path accounts continue to receive token refreshes and
creator-selected Graph host routing even when the master or Instagram Login flags
are off. Rolling back the experience preserves those connections and their upkeep.

### Data targets and configuration

The hosting project, deployed function name and region do not establish the
Firebase data target. Before every execution or deployment, inspect the selected
`PRODEV` module, its `databaseURL`, and its service-account `project_id` privately.
Verify the deployed configuration and uploaded assets as well as the local source;
legacy bundles can load an ignored `.env` and a bundled connection module/key.
Use explicit hosting project and region flags for each environment.

The dev-hosted `updateInstagramDemographics` and `refreshAllCampaignAnalytics`
deployments have been found to target production Firebase. Treat them as
production-backed until a sanctioned dev mapping is verified from the deployed
configuration, database URL and credential assets. Do not invoke them from an
agent while their target is production, even with a query scope. Dev validation
requires a verified dev connection and credential; a dev hostname alone is
insufficient.
The dev Firebase project is `crafted-dev-v1`, with database URL
`https://crafted-dev-v1-default-rtdb.firebaseio.com`.

All four functions require `PRODEV`. Token refresh additionally requires
`TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`; missing values return 500 before
user reads. Campaign analytics uses `BITLY_ACCESS_TOKEN` for short-link clicks.
Vendor access/refresh tokens are read from each creator's Firebase social node.
Keep credentials, private env files and service-account assets out of git and
shared logs. A runtime module selected by `PRODEV` must resolve inside its uploaded
standalone source; do not rely on a sibling folder being deployed with it.

Instagram calls select their host from the creator's `api_path`: `"instagram"`
uses `graph.instagram.com/v24.0`; absent or Facebook paths use
`graph.facebook.com/v24.0`. Keep the four standalone `graphHost.js` copies
identical (`refresh-instagram-rates` has its TypeScript equivalent in `lib/graph-host.ts`). Account reads use `instagram_user_id` on the Instagram path and
`instagram_business_account_id` on the Facebook path. Campaign analytics caches
each creator's Instagram node for one HTTP invocation and rereads it next time.

The `refreshTiktokAccessTokens` entry point refreshes both platforms. Its TikTok
credential preflight applies even to an Instagram-only scoped run. Instagram
refresh requires an Instagram-path token and a valid `access_token_expires_at`
no more than 30 days away; Facebook nodes and missing/invalid expiries are skipped.
Success atomically writes the new token, expiry and `last_error: null`; Meta 190
records only `last_error`. Demographics success atomically updates the existing
demographic fields and clears `last_error`; token/permission errors record only
`last_error`, while rate limits leave the node alone.

### Inspect and deploy

Read the existing deployment and scheduler job for the selected environment.
Runtime, generation, deployed name, region and schedule are environment settings;
read them from the service instead of assuming another environment's values.
For example, fill in these operator variables before running the read-only commands:

```bash
SOCIAL_PROJECT="<hosting-project>"
SOCIAL_REGION="<function-region>"
SOCIAL_FUNCTION="<existing-deployed-name>"
SOCIAL_SCHEDULER_LOCATION="<scheduler-location>"
SOCIAL_JOB="<existing-scheduler-job>"

gcloud functions describe "$SOCIAL_FUNCTION" \
  --project="$SOCIAL_PROJECT" --region="$SOCIAL_REGION" \
  --format='yaml(name,environment,buildConfig.runtime,buildConfig.entryPoint,runtime,entryPoint,serviceConfig.timeoutSeconds,serviceConfig.availableMemory,serviceConfig.maxInstanceCount,serviceConfig.maxInstanceRequestConcurrency,serviceConfig.serviceAccountEmail)'
gcloud scheduler jobs list \
  --project="$SOCIAL_PROJECT" --location="$SOCIAL_SCHEDULER_LOCATION" \
  --format='table(name,schedule,timeZone,httpTarget.uri,state)'
gcloud scheduler jobs describe "$SOCIAL_JOB" \
  --project="$SOCIAL_PROJECT" --location="$SOCIAL_SCHEDULER_LOCATION" \
  --format='yaml(name,schedule,timeZone,httpTarget.uri,httpTarget.httpMethod,httpTarget.oidcToken.serviceAccountEmail,httpTarget.oauthToken.serviceAccountEmail,state)'
```

Confirm the scheduler's target URL, request method, caller identity, cadence and
time zone against the intended function. Preserve its existing policy and schedule
unless changing them is part of the requested operation. Record the source revision,
current deployment configuration and scheduler target before a deploy so rollback
can restore the same service. Inspect runtime env and IAM settings privately;
the metadata command above deliberately omits env values.

Deploy only after the operator has verified the data target and prepared the
standalone source and private runtime env file. Choose `--gen2` or `--no-gen2` and the
runtime from the existing metadata, with a supported runtime for any approved
upgrade. The entry point must match the source folder's `index.js` registration.
For example:

```bash
SOCIAL_SOURCE="functions/refreshTokens"
SOCIAL_ENTRY_POINT="refreshTiktokAccessTokens"
SOCIAL_RUNTIME="<verified-runtime>"
SOCIAL_GENERATION_FLAG="<verified-generation-flag>"

gcloud functions deploy "$SOCIAL_FUNCTION" \
  --project="$SOCIAL_PROJECT" --region="$SOCIAL_REGION" \
  "$SOCIAL_GENERATION_FLAG" --runtime="$SOCIAL_RUNTIME" \
  --source="$SOCIAL_SOURCE" --entry-point="$SOCIAL_ENTRY_POINT" \
  --trigger-http --env-vars-file=/private/path/social-runtime-env.yaml
```

Prepare the complete env file for that function and environment, retaining its
existing required variables; `--env-vars-file` replaces the runtime env set.
Preserve resource limits, timeout, service account, trigger and invoker policy.
Use the corresponding source/entry-point row for another function. Re-read the
deployment and scheduler target after the change. Changing source does not require
renaming the deployed function or its scheduler job.

Coordinate TikTok client-secret rotation with configuring and deploying the token
refresher in the same operator session: a newly issued secret invalidates the old
one. A code rollback must retain the current valid credentials. Never restore an
exposed or invalidated secret from git history.

### Verify scheduled work

From the repository root, run the maintained regression suite without loading
Firebase or contacting vendors:

```bash
node --experimental-strip-types --test __tests__/legacySocialFunctions.test.ts
node_modules/.bin/tsc --noEmit --strict --target es2022 --module nodenext \
  --moduleResolution nodenext --types node --skipLibCheck \
  __tests__/legacySocialFunctions.test.ts
```

Run `node --check` on each edited legacy JavaScript file. Root `check:ci`,
`typecheck`, `test:ci` and `build` scripts cover the three workspace members; they do
not exercise these standalone legacy handlers. Run these checks from an isolated
install or matching dependency link, without installing through a shared link.

Live verification writes data and calls vendor APIs. Use only run-tagged dev
records and an explicitly verified dev data target. For functions supporting
`user_id`, send a nonempty owned creator ID; for campaign jobs, send a nonempty
owned `campaign_id`. Omission selects the full collection. For a verified creator-scoped local/dev endpoint, for example:

```bash
curl --fail-with-body --get "${SOCIAL_VERIFIED_DEV_URL:?set a verified dev endpoint}" \
  --data-urlencode "user_id=${SOCIAL_TEST_UID:?set an owned dev creator ID}"
```

Read back only the owned platform/campaign node after the response. TikTok token
success must persist both the rotated refresh token and access token, both future
expiries, and clear `last_error`; two consecutive real-vendor refreshes establish
that the rotated token remains usable. For Instagram token refresh, verify the
new token, future expiry and cleared `last_error`; for demographics, verify the
owned demographic fields.
Check per-record failures and actual writes as well as the HTTP
status; a batch can continue past individual failures. For comments and campaign
analytics, inspect the owned comments/performance nodes and scheduler execution
logs. Do not paste tokens, credential-bearing URLs or raw vendor errors into
shared artifacts. Remove only fixtures created for the verification run.

### Rollback

Redeploy the previous reviewed source revision with the same verified environment
configuration, service account and current valid credentials. Restore a scheduler
target or policy only if that deployment changed it. Re-read deployment metadata
and verify the permitted data target before repeating a scoped check. Reverting
code does not undo Firebase writes; inspect affected records before considering
any separately authorized data repair.

---

# Monthly rate refresh

`refresh-instagram-rates` and `refresh-tiktok-rates` recompute every creator's suggested rate once
a month. They are workspace members on the same TypeScript template as `creator-outreach`
(Biome, vitest, build-at-deploy, one shared hosting project with the environment in the deployed
name) and differ from it in three ways: they are **private** (only Cloud Scheduler can call them,
with an OIDC token), the deploy **creates or updates their Scheduler job**, and each runs **one
instance, one request at a time**. They replace the 2024 hand-deployed `refreshInstagramRates` /
`refreshTikTokRates`.

## Topology

| | `refresh-instagram-rates` | `refresh-tiktok-rates` |
| --- | --- | --- |
| In-code target = `--entry-point` | `refresh-instagram-rates` | `refresh-tiktok-rates` |
| Deployed function = Scheduler job | `refresh-instagram-rates-<env>` | `refresh-tiktok-rates-<env>` |
| Schedule (`America/Cancun`) | `0 1 1 * *` | `0 0 1 * *` |
| Node written | `users/<uid>/creator_socials/instagram`: `suggested_rate`, `median_plays`, `updated`, `last_error` | `users/<uid>/creator_socials/tiktok`: `performance` (replaced whole), `updated`, `last_error`, `handle` |
| Rate formula | `parseInt((median_plays / 1000) * 2500)` | `(median_views / 1000) * 2500` |
| Response body | `{status, statuscode, message, processed, skipped, failed}` | `{processed, skipped, failed}` |

- **Hosting:** the repo variable `GCP_PROJECT` (`crafted-dev-v1`) for all three environments,
  `us-central1`, Gen2, `nodejs22`. `NODE_ENV` selects the Firebase **data** project (`dev` →
  `crafted-dev-v1`, `staging` → `crafted-staging-v1`, `prod` → `crafted-v1`) exactly as in
  `creator-outreach`; the per-Environment `FIREBASE_SA_KEY` is the only per-env secret.
- **Resources:** 1 vCPU, 2Gi, concurrency 1, `--max-instances=1`, timeout 1800s. The Scheduler
  attempt deadline is 1800s (its ceiling for HTTP targets) with `--max-retry-attempts=0`, so a
  retry or a stray call can never run a second copy against the same database.
- **Auth:** `--no-allow-unauthenticated`. The invoker service account (repo variable
  `RATE_REFRESH_INVOKER_SA`) holds `roles/run.invoker` on each function, granted by the deploy;
  Scheduler signs an OIDC token as it, with the function URI as audience.
- **Request contract:** POST only (anything else gets 405 before Firebase is touched). No query
  string refreshes every creator in key-ordered pages of 100. `?user_id=<uid>` refreshes that
  creator only (404 if the node is absent); an empty or repeated `user_id` is rejected with 400 and
  never falls through to a full scan. Creators with `negotiated: true` or no token are skipped.
- **Observability:** each run logs `[INFO] <function> finished: processed=N skipped=N failed=N ms=N`.
  A handler-level failure is captured in Sentry; a dead creator token is not an incident and
  lands in that creator's `last_error`.

## One-time setup (operator)

Run once, in this order, before the first deploy of any environment. Already in place from
`creator-outreach`: the repo variables `GCP_PROJECT` / `GCP_REGION`, the secrets `GCP_SA_KEY` and
`SENTRY_DSN`, and `FIREBASE_SA_KEY` in each of the `dev` / `staging` / `prod` Environments.

```bash
export GCP_PROJECT="crafted-dev-v1" GCP_REGION="us-central1"
export INVOKER_SA="rate-refresh-invoker@${GCP_PROJECT}.iam.gserviceaccount.com"
# The service account behind the GCP_SA_KEY secret (the user-managed account holding
# roles/run.admin and roles/cloudfunctions.developer in the project). Confirm it before granting.
export DEPLOY_SA="crafted-deployer@${GCP_PROJECT}.iam.gserviceaccount.com"

# 1) The invoker service account. It gets no project-level roles.
gcloud iam service-accounts create rate-refresh-invoker --project="$GCP_PROJECT" \
  --display-name="Rate refresh Scheduler invoker"

# 2) The deploy account creates and updates Scheduler jobs.
gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
  --member="serviceAccount:${DEPLOY_SA}" --role="roles/cloudscheduler.admin" --condition=None

# 3) The deploy account may attach the invoker account to a job (actAs).
gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" --project="$GCP_PROJECT" \
  --member="serviceAccount:${DEPLOY_SA}" --role="roles/iam.serviceAccountUser"

# 4) Read-only: the Scheduler service agent can mint the OIDC token (granted when the API was
#    enabled). Expect serviceAccount:service-<PROJECT_NUMBER>@gcp-sa-cloudscheduler.iam.gserviceaccount.com
gcloud projects get-iam-policy "$GCP_PROJECT" --flatten=bindings \
  --filter="bindings.role=roles/cloudscheduler.serviceAgent" --format='value(bindings.members)'

# 5) The repo variable the workflows read.
gh variable set RATE_REFRESH_INVOKER_SA --repo Crafted-Corp/crafted_cloud_functions --body "$INVOKER_SA"

# 6) Read-only: the prod Environment must carry a required reviewer and a main-only deployment
#    branch rule (Settings -> Environments -> prod). Both lines must be non-empty before the first
#    production promotion; without them anyone with write access can dispatch the prod workflow.
gh api repos/Crafted-Corp/crafted_cloud_functions/environments/prod \
  --jq '.protection_rules, .deployment_branch_policy'
```

Acceptance: `gcloud iam service-accounts describe "$INVOKER_SA" --project="$GCP_PROJECT"` succeeds
and `gh variable list` shows `RATE_REFRESH_INVOKER_SA`.

## CI/CD flow

- `.github/workflows/rate-refresh-build.yml`, on a **pull request** (to `dev` or `main`): `quality`
  (root `check:ci`, `typecheck`, `test:ci`), `cold-start-smoke` per function (boots the compiled
  function with a dummy key and expects an HTTP response; a `GET` answers 405) and `build-preview`
  per function (credential-free `pack build`). Nothing deploys.
- **Push to `dev`** runs `deploy-dev`; **push or merge to `main`** runs `deploy-staging`. Both
  deploy the two functions in parallel into the shared hosting project.
- `.github/workflows/rate-refresh-deploy-prod.yml` is the manual `workflow_dispatch` promotion
  (`environment: prod`); the workflow file must be on `main` to be dispatchable, so promote
  `dev` → `main` first. It deploys both functions, each in its own job.
- Every deploy job calls `.github/actions/deploy-rate-refresh`: write the Firebase key and runtime
  env file, deploy, (prod only) pin traffic back to the previous revision if the rollout failed, grant
  the invoker account `roles/run.invoker`, then **create the Scheduler job if it is absent or
  `update http` it if it exists** (schedule, `America/Cancun`, function URI, OIDC as the invoker
  account, 1800s deadline, no retries).
- **A deploy never changes a Scheduler job's state.** A new job is ENABLED; a job someone paused
  stays paused through every later deploy (the step re-pauses it and fails if that ever stops being
  true). Nothing in the pipeline resumes a job.
- Deploy jobs never cancel: each function and environment has its own concurrency group with
  `cancel-in-progress: false`, and only pull-request runs are superseded.

## Dev and staging

The first deploy of each environment creates its two jobs ENABLED, so they would refresh that
environment's Firebase on the 1st using whatever creator tokens are stored there. Pause them by
hand right after the first deploy (console: Cloud Scheduler → select the job → Pause), or:

```bash
for ENV in dev staging; do
  for FN in refresh-instagram-rates refresh-tiktok-rates; do
    gcloud scheduler jobs pause "${FN}-${ENV}" --project="$GCP_PROJECT" --location="$GCP_REGION"
  done
done
gcloud scheduler jobs list --project="$GCP_PROJECT" --location="$GCP_REGION" \
  --filter='name~[Rr]ates' --format='table(name.basename(),schedule,state)'
```

Verify a deployed environment with one run-tagged creator (use dev; never prod). The unauthenticated
call must be refused, and the authenticated scoped call must write only that creator's node:

```bash
FN=refresh-instagram-rates   # then refresh-tiktok-rates
URI=$(gcloud functions describe "${FN}-dev" --gen2 --project="$GCP_PROJECT" --region="$GCP_REGION" \
  --format='value(serviceConfig.uri)')
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$URI"            # expect 403
curl -sS -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "${URI}?user_id=${SOCIAL_TEST_UID:?set a run-tagged dev creator ID}"
```

`gcloud auth print-identity-token --audiences=...` is rejected for user accounts; the plain token is
accepted for an account holding `roles/run.invoker` (project owners already do). Read the creator's
node back: Instagram success has `suggested_rate`, `median_plays`, `updated` and `last_error: null`;
TikTok success has the seven-field `performance`, `updated` and `last_error: null`. Check the
`finished:` line in the function's log and the actual writes, not only the HTTP status. Keep tokens
and credential-bearing URLs out of shared artifacts, and remove only the fixtures this run created.

## Production cutover

Do this in one operator session, **before 2026-11-01**, with this PR and its two base PRs merged
and promoted to `main`, both `-staging` functions deployed and verified, and the `prod` Environment protection
checked (setup step 6). The new `-prod` jobs are created ENABLED and fire on the 1st, so the legacy
jobs must be paused in the same session or both generations run. After step 3 the next scheduled
run is 2026-11-01 on the new functions.

```bash
# 1) Deploy both -prod functions and create both -prod Scheduler jobs. Approve the run if prompted.
gh workflow run rate-refresh-deploy-prod.yml --repo Crafted-Corp/crafted_cloud_functions \
  --ref main -f ref=<sha-validated-on-staging>

# 2) Pause the legacy prod jobs so the legacy 2026-11-01 run does not happen.
gcloud scheduler jobs pause refreshInstagramRates --project="$GCP_PROJECT" --location="$GCP_REGION"
gcloud scheduler jobs pause refreshTiktokRatesForAllAccounts --project="$GCP_PROJECT" --location="$GCP_REGION"

# 3) Exactly one ENABLED job per platform: the two -prod jobs. The -dev/-staging jobs are PAUSED.
gcloud scheduler jobs list --project="$GCP_PROJECT" --location="$GCP_REGION" \
  --filter='name~[Rr]ates' --format='table(name.basename(),schedule,state)'
```

**One-time manual prod run** (authorized exception to "never trigger the refresh by hand"; it
recomputes `suggested_rate` and `median_plays` / `performance` for every non-negotiated creator in
`crafted-v1` mid-month, so proposals created afterwards carry the new rate while stored proposals
keep their snapshot). Each call blocks until its run ends (the Instagram run took about ten minutes
on 2026-10-01). Keep the terminal attached: Cloud Run only allocates CPU while a request is open, so a
dropped connection can stall the run. Re-running is safe because every run recomputes from scratch.

```bash
for FN in refresh-instagram-rates refresh-tiktok-rates; do
  URI=$(gcloud functions describe "${FN}-prod" --gen2 --project="$GCP_PROJECT" --region="$GCP_REGION" \
    --format='value(serviceConfig.uri)')
  echo "== ${FN}-prod"
  curl -sS --max-time 1830 -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
    -w '\nHTTP %{http_code} in %{time_total}s\n' "$URI"
done
```

The equivalent without a hand-minted token is `gcloud scheduler jobs run refresh-instagram-rates-prod
--project="$GCP_PROJECT" --location="$GCP_REGION"` (and the TikTok job): it fires with the invoker
account's OIDC identity and leaves an attempt on the job. Verify each function before moving on:
HTTP 200, a `failed` count you can explain (a dead creator token is `failed` for TikTok and `skipped`
for Instagram, with its reason in that creator's `last_error`), the `finished:` line, and one
refreshed creator's `updated`:

```bash
for FN in refresh-instagram-rates refresh-tiktok-rates; do
  gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${FN}-prod\" AND textPayload:\"finished:\"" \
    --project="$GCP_PROJECT" --freshness=3h --limit=3 --format='value(timestamp,textPayload)'
done
```

## Rollback and retirement

- **Before retirement:** pause the two `-prod` jobs and resume the two legacy jobs. No redeploy is
  needed; the legacy functions stay deployed until they are retired (below).
  ```bash
  for JOB in refresh-instagram-rates-prod refresh-tiktok-rates-prod; do
    gcloud scheduler jobs pause "$JOB" --project="$GCP_PROJECT" --location="$GCP_REGION"
  done
  for JOB in refreshInstagramRates refreshTiktokRatesForAllAccounts; do
    gcloud scheduler jobs resume "$JOB" --project="$GCP_PROJECT" --location="$GCP_REGION"
  done
  ```
- **A failed prod deploy** keeps the last-good revision serving; the action also pins traffic back
  to the revision that was serving before the deploy.
- **Retirement** (authorized once the manual prod run above succeeded): delete the legacy jobs, then
  the legacy functions. **This is not reversible from git**: the 2024 bundles carry their own
  `serviceAccountKey.json`, which is gitignored, so a deleted legacy function cannot be rebuilt from
  the repository.
  ```bash
  gcloud scheduler jobs delete refreshInstagramRates --project="$GCP_PROJECT" --location="$GCP_REGION"
  gcloud scheduler jobs delete refreshTiktokRatesForAllAccounts --project="$GCP_PROJECT" --location="$GCP_REGION"
  gcloud functions delete refreshInstagramRates --gen2 --project="$GCP_PROJECT" --region="$GCP_REGION"
  gcloud functions delete refreshTikTokRates --gen2 --project="$GCP_PROJECT" --region="$GCP_REGION"
  ```

## Operator checks

After the first of each month, read each job's outcome. A healthy run has no `status.code` (or 0)
and a `lastAttemptTime` on the 1st; the legacy jobs, once retired, no longer appear:

```bash
for FN in refresh-instagram-rates refresh-tiktok-rates; do
  gcloud scheduler jobs describe "${FN}-prod" --project="$GCP_PROJECT" --location="$GCP_REGION" \
    --format='value(name.basename(),state,status.code,lastAttemptTime)'
done
```

The Scheduler status code is the only signal for a run that never reached the function (a refused
OIDC token, a timeout); a run that failed inside the handler also appears in Sentry.

## Local development (rate functions)

From the repo root, the same gate as `creator-outreach`: `npm ci`, `npm run check:ci`,
`npm run typecheck`, `npm run test:ci`, `npm run build -w refresh-instagram-rates` (or
`refresh-tiktok-rates`). To run one against **dev only**, place a dev Firebase key at
`functions/<name>/config/devServiceAccountKey.json`, then `cd functions/<name> && NODE_ENV=dev npm run dev`
and `POST` to `localhost:8080` with `?user_id=<run-tagged dev creator>`. A local run with the prod key
writes production data.
