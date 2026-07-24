# Crafted Cloud Functions

This repository contains all of Crafted's Google Cloud Functions. These functions handle
backend processes for the Crafted platform (user scans, outreach email sending, social-token
refresh, campaign analytics, and one-off maintenance scripts).

Two tooling generations live here side by side:

- **`creator-outreach`** is the **modernization reference**: TypeScript, Biome, vitest, husky +
  commitlint, an Nx-driven npm workspace, and full CI/CD (per-branch deploys to three GCP
  projects plus a manual production promotion). Everything below under
  [creator-outreach infrastructure](#creator-outreach-infrastructure) applies only to it.
- **All other functions** remain on the **legacy per-directory pattern** — each is a standalone
  plain-JavaScript folder with its own `package.json` and `node_modules`, no shared tooling, and
  no CI. Migrating them to the `creator-outreach` template is future, separately green-lit work.

## Folder Structure

```bash
crafted_cloud_functions/
│
├── functions/
│   ├── creator-outreach/              ← MODERN reference (TypeScript, CI/CD) — Studio + Amplify outreach
│   ├── getBalancedUsers/              ← legacy JS
│   ├── loadUsers/                     ← legacy JS
│   ├── processInstagramComments/      ← legacy JS
│   ├── refreshAllCampaignAnalytics/   ← legacy JS
│   ├── refreshInstagramRates/         ← legacy JS
│   ├── refreshTikTokRates/            ← legacy JS
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
6. **refreshInstagramRates**: Updates Instagram suggested rates for creators.
7. **refreshTikTokRates**: Updates TikTok suggested rates for creators.
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
- **Entry point / target / deployed name:** the single identical string `creator-outreach`
  (`index.ts` registers `functions.http("creator-outreach", creatorOutreach)`; the gcloud
  `--entry-point` and the deployed function name are the same string — a mismatch deploys but
  fails at cold start with `Function '<name>' is not defined in the provided module`).
- **Resources:** 2 vCPU, 4Gi memory, concurrency 1, timeout 3600s, max 50 instances.
- **Runtime service account:** the project's default compute SA
  (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`).
- **Runtime env vars:** `NODE_ENV` (`dev` | `staging` | `prod`) and `LOG_EXECUTION_ID=true`.

This is the only function on the modern tooling; every other function in `functions/` is still on
the legacy per-directory JavaScript pattern described above.

## Multi-env layout (3 GCP projects)

The function is deployed to three separate GCP/Firebase projects, one per environment. The
branch you push to selects the environment:

| Environment | Branch / trigger        | GCP project         | `NODE_ENV` |
|-------------|-------------------------|---------------------|------------|
| dev         | push to `dev`           | `crafted-dev-v1`    | `dev`      |
| staging     | push/merge to `main`    | `crafted-staging-v1`| `staging`  |
| prod        | manual promotion        | `crafted-v1`        | `prod`     |

`NODE_ENV` is the single switch that picks the environment at runtime. In
`functions/creator-outreach/lib/firebase.ts` it selects the Firebase database URL and the service
account key file it loads (`config/devServiceAccountKey.json` / `config/stagingServiceAccountKey.json`
/ `config/serviceAccountKey.json`); it also sets the Sentry `environment` tag in `lib/sentry.ts`.
An unknown `NODE_ENV`, or a missing key file, throws at startup.

## CI/CD flow

Two workflow files drive everything:

- `.github/workflows/creator-outreach-build.yml` — PR quality gate + build preview + the
  `dev`/`staging` deploy jobs.
- `.github/workflows/creator-outreach-deploy-prod.yml` — the manual production promotion.

There are three GitHub Environments — `dev`, `staging`, and `prod` — that hold the env-scoped
secrets and variables (and, on `prod`, the required-reviewer protection rule). The full list of
what each environment needs is the **Secrets & Variables Matrix** in
`.agent/exec-plans/creator-outreach-modernization.md`.

**On a pull request** (to `dev` or `main`), two jobs run and **nothing deploys**:
- `quality` — `npm run check:ci` (Biome lint + format), `npm run typecheck` (`tsc --noEmit`), and
  `npm run test:ci` (vitest).
- `build-preview` — a `pack build` buildpack **dry-run** that compiles and produces a deployable
  image locally, with no push and no cloud credentials. This is the credential-free proof that the
  TypeScript-build-at-deploy actually works (there is no `--dry-run` on `gcloud functions deploy`).

**On a push to `dev`** the `deploy-dev` job deploys to `crafted-dev-v1`; **on a push/merge to
`main`** the `deploy-staging` job deploys to `crafted-staging-v1`. Both `need` the `quality` and
`build-preview` jobs and are branch-guarded, so neither runs on a pull request.

**Production** is intentionally separate: the `creator-outreach-deploy-prod.yml` workflow is
`workflow_dispatch`-only and runs in the `prod` GitHub Environment, which is configured with a
**required reviewer** — the run pauses for a human approval before it deploys to `crafted-v1`.

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
npm ci            # install the workspace (root + creator-outreach + shared-config)
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

These commands are copy-pasteable. Substitute the bracketed values per environment. `gcp-build`
runs during every `gcloud functions deploy`, so **no local build is required first**.

```bash
# Prereqs: gcloud authenticated (gcloud auth login); pack is optional, only for a local dry-run.

# 1) Place the matching Firebase Admin key at the path lib/firebase.ts expects:
#      dev     -> functions/creator-outreach/config/devServiceAccountKey.json
#      staging -> functions/creator-outreach/config/stagingServiceAccountKey.json
#      prod    -> functions/creator-outreach/config/serviceAccountKey.json

# 2) Write the runtime env file (NODE_ENV MUST match the target project):
cat > env.yaml <<'EOF'
NODE_ENV: "dev"                 # dev | staging | prod
SENDGRID_API_KEY: "SG.xxxx"
SENTRY_DSN: "https://xxxx"
LOG_EXECUTION_ID: "true"
EOF

# 3) Deploy. dev is shown; for staging swap --project=crafted-staging-v1 (key stagingServiceAccountKey.json,
#    NODE_ENV=staging) and for prod swap --project=crafted-v1 (key serviceAccountKey.json, NODE_ENV=prod).
#    KEEP --allow-unauthenticated — it matches the current deploy posture (see the auth model above).
gcloud functions deploy creator-outreach \
  --gen2 \
  --project=crafted-dev-v1 \
  --region=us-central1 \
  --runtime=nodejs22 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=creator-outreach \
  --source=functions/creator-outreach \
  --env-vars-file=env.yaml \
  --memory=4Gi --cpu=2 --timeout=3600s --concurrency=1 --max-instances=50

# 4) Print the deployed URL (set the server's per-env CF_CREATOR_OUTREACH_URL to it):
gcloud functions describe creator-outreach --gen2 --region=us-central1 \
  --project=crafted-dev-v1 --format='value(serviceConfig.uri)'
```

### Manual production promotion (preferred — goes through the approval gate)

Production is promoted through the `workflow_dispatch` workflow so it passes the `prod`
Environment's required-reviewer gate. Do **not** run a local `gcloud` deploy against `crafted-v1`
for a normal release.

- **GitHub UI:** Actions → **"creator-outreach Production Deploy"** → **Run workflow** →
  (optional) set the `ref` input to the git SHA/tag you validated on `main`/staging → **Run**.
  The run pauses for approval before deploying to `crafted-v1`.
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
