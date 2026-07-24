# Manual Test Suite — creator-outreach modernization

| | |
|---|---|
| **Feature** | creator-outreach modernization (TypeScript, Biome, vitest, multi-env CI/CD) |
| **ExecPlan** | `.agent/exec-plans/creator-outreach-modernization.md` |
| **PRs** | (feature branch `feature/creator-outreach-modernization`) |
| **Author / Date** | cloud-engineer / 2026-07-24 |

**How to read this suite.** Every behavior and edge case has its own case. Tags: **happy-path**
(the intended flow), **edge** (boundary / unusual input / error path), **regression** (existing
behavior that must not break). **Locale: N/A for every case** — this is an infrastructure /
tooling feature with no localized (`(retail)`) UI, so there is nothing to exercise in both `en`
and `es`. IDs are stable — never renumber a case once assigned; retire it with a note instead.

Live-deploy cases (TC-co-mod-007 onward) require the one-time platform setup from the release
notes' deploy checklist (GitHub Environments + secrets/variables + IAM roles) and are performed by
the operator during the rollout — they are not run by CI.

---

### TC-co-mod-001
- **Title:** Opening a PR runs `quality` + `build-preview` and deploys nothing
- **Tag:** happy-path
- **Locale:** n/a
- **Preconditions:** A branch that touches `functions/creator-outreach/**` (or `packages/shared-config/**` or the workspace root files in the workflow's `paths`), open as a PR to `dev` or `main`.
- **Steps:**
  1. Open the PR and let checks run (`gh pr checks`).
- **Expected result:** The `quality` job (Biome check:ci + `tsc --noEmit` + vitest) and the `build-preview` job (`pack build` dry-run) both pass. No `deploy-dev`/`deploy-staging`/prod job runs — they are branch-guarded and never fire on a `pull_request`.

### TC-co-mod-002
- **Title:** Local quality gate passes at the workspace root
- **Tag:** happy-path
- **Locale:** n/a
- **Preconditions:** Clean checkout, `npm ci` run at the repo root.
- **Steps:**
  1. `npm run check:ci`
  2. `npm run typecheck`
  3. `npm run test:ci`
- **Expected result:** All three exit 0. `check:ci` reports only `creator-outreach` (and shows no diff in any sibling function directory); `typecheck` reports zero errors; vitest passes.

### TC-co-mod-003
- **Title:** `npm run build` emits `dist/` including the Handlebars templates
- **Tag:** happy-path
- **Locale:** n/a
- **Preconditions:** `npm ci` run at the root.
- **Steps:**
  1. `npm run build -w creator-outreach` (or `cd functions/creator-outreach && npm run build`).
  2. Inspect `functions/creator-outreach/dist/`.
- **Expected result:** `dist/index.js`, `dist/lib/*.js`, and `dist/templates/StudioBriefInvite.hbs` + `dist/templates/CampaignInviteInNetwork.hbs` all exist. Re-running the build does not nest `dist/templates/templates/` (the copy is idempotent).

### TC-co-mod-004
- **Title:** `commit-msg` hook enforces Conventional Commits
- **Tag:** edge
- **Locale:** n/a
- **Preconditions:** `npm ci` run at the root (husky installed via `prepare`).
- **Steps:**
  1. Stage a change and attempt a commit with a non-conventional message (e.g. `git commit -m "updated stuff"`).
  2. Attempt again with a conventional message (e.g. `git commit -m "chore: tidy scanner types"`).
- **Expected result:** Step 1 is rejected by commitlint (non-zero exit, commit aborted); step 2 is accepted.

### TC-co-mod-005
- **Title:** `pre-commit` lint-staged scoping does not reformat sibling functions
- **Tag:** regression
- **Locale:** n/a
- **Preconditions:** `npm ci` run at the root.
- **Steps:**
  1. Stage a file inside a **legacy** sibling function (e.g. `functions/refreshTokens/index.js`) and commit.
  2. Separately, stage a `functions/creator-outreach/*.ts` file and commit.
- **Expected result:** Step 1 → "No staged files match any configured task" (the sibling is never matched — it has no `.lintstagedrc.mjs`). Step 2 → Biome runs on the staged file (cwd = the function dir) and the commit proceeds.

### TC-co-mod-006
- **Title:** Buildpack dry-run proves the TS build-at-deploy
- **Tag:** happy-path
- **Locale:** n/a
- **Preconditions:** Docker available; `pack` CLI installed (the CI `build-preview` job installs v0.40.8).
- **Steps:**
  1. From the repo root, run `pack build creator-outreach-dryrun --path functions/creator-outreach --builder gcr.io/buildpacks/builder:google-22 --env GOOGLE_FUNCTION_TARGET=creator-outreach --env GOOGLE_RUNTIME=nodejs22 --env GOOGLE_NODEJS_VERSION=22`.
- **Expected result:** Exit 0. Logs show `npm ci` against the nested lockfile, `npm run gcp-build` (`tsc` + template copy), `node --check dist/index.js`, and a successfully built image — no cloud credentials required.

### TC-co-mod-007
- **Title:** Push to `dev` auto-deploys to `crafted-dev-v1` and prints the URL
- **Tag:** happy-path
- **Locale:** n/a
- **Preconditions:** The `dev` GitHub Environment is configured (secrets/variables + deploy-SA IAM roles).
- **Steps:**
  1. Merge the feature branch to `dev` (or push to `dev`).
- **Expected result:** The `deploy-dev` job runs after `quality` + `build-preview`, deploys `creator-outreach` to `crafted-dev-v1` (Gen2, nodejs22, `us-central1`, `--allow-unauthenticated`, `NODE_ENV=dev`), and the run log prints a `*.run.app` URL.

### TC-co-mod-008
- **Title:** Dev endpoint accepts a valid Studio blast (200)
- **Tag:** happy-path
- **Locale:** n/a
- **Preconditions:** TC-co-mod-007 done; the printed dev URL.
- **Steps:**
  1. POST a valid Studio body to the URL — `{ "product": "studio", "brand_id": "<id>", "task": { "uid": "<taskUid>", "name": "<name>", "regions": [{ "value": "US-CA" }], "price": 100 } }`.
- **Expected result:** HTTP 200 with `status: "200"`, `length`, `data`, and `blastResults` (`sent`/`failed`). Cold start does not throw on template load.

### TC-co-mod-009
- **Title:** Dev endpoint accepts a valid Amplify blast (200)
- **Tag:** happy-path
- **Locale:** n/a
- **Preconditions:** TC-co-mod-007 done; the printed dev URL.
- **Steps:**
  1. POST a valid Amplify body — `{ "product": "amplify", "brand_id": "<id>", "message": "hi", "campaign_id": "<cid>", "campaign_name": "<name>", "follower_count": [1000, 50000], "platforms": ["instagram"], "states": ["CA"] }`.
- **Expected result:** HTTP 200 with the same response shape.

### TC-co-mod-010
- **Title:** Dev endpoint rejects an invalid body (400)
- **Tag:** edge
- **Locale:** n/a
- **Preconditions:** TC-co-mod-007 done; the printed dev URL.
- **Steps:**
  1. POST a body with an unknown/missing `product` or a missing required field (e.g. Amplify with no `states`).
- **Expected result:** HTTP 400 with `message: "Validation failed"` and an `errors` array; no scan/email/store runs.

### TC-co-mod-011
- **Title:** Merge to `main` auto-deploys to `crafted-staging-v1`
- **Tag:** happy-path
- **Locale:** n/a
- **Preconditions:** The `staging` GitHub Environment is configured.
- **Steps:**
  1. Merge `dev` → `main`.
- **Expected result:** The `deploy-staging` job deploys to `crafted-staging-v1` (`NODE_ENV=staging`, `stagingServiceAccountKey.json`) and prints the URL. Repeating TC-co-mod-008/009/010 against the staging URL passes.

### TC-co-mod-012
- **Title:** Manual prod promotion pauses for the required-reviewer approval
- **Tag:** edge
- **Locale:** n/a
- **Preconditions:** The `prod` GitHub Environment is configured with a required reviewer.
- **Steps:**
  1. Actions → "creator-outreach Production Deploy" → Run workflow (optionally set `ref`) → Run.
- **Expected result:** The run pauses awaiting approval and does **not** deploy until a reviewer approves. After approval, it deploys the chosen `ref` to `crafted-v1` (`NODE_ENV=prod`, `serviceAccountKey.json`) and prints the URL.

### TC-co-mod-013
- **Title:** Studio path writes `tasks/{uid}/invites`
- **Tag:** regression
- **Locale:** n/a
- **Preconditions:** vitest suite (`handler.test.ts`) runnable locally.
- **Steps:**
  1. `npm run test:ci` and inspect the handler Studio-path assertion.
- **Expected result:** The Studio branch of `storeResults` calls `firebase.database().ref("tasks/<uid>/invites").set(blastResults)`. Removing that write fails the test.

### TC-co-mod-014
- **Title:** Amplify path writes both invite locations atomically
- **Tag:** regression
- **Locale:** n/a
- **Preconditions:** vitest suite runnable locally.
- **Steps:**
  1. `npm run test:ci` and inspect the handler Amplify-path assertion.
- **Expected result:** The Amplify branch performs a single `ref().update({...})` writing **both** `brands/{brand_id}/influencer_campaigns/{campaign_id}/invites` **and** `influencer_campaigns/{campaign_id}/invites`. Dropping the top-level path fails the test.

### TC-co-mod-015
- **Title:** Handlebars templates resolve at module load (cold-start guard)
- **Tag:** regression
- **Locale:** n/a
- **Preconditions:** vitest suite runnable locally.
- **Steps:**
  1. `npm run test:ci` — `email.test.ts` imports the real `lib/email`, which reads the templates at module load.
- **Expected result:** The email module imports without throwing (templates found at `../templates/*.hbs`). Repointing the template path makes the import throw and fails the file — the guard against the `dist/templates/` cold-start footgun.

### TC-co-mod-016
- **Title:** A thrown error returns 500 and is captured by Sentry
- **Tag:** regression
- **Locale:** n/a
- **Preconditions:** vitest suite runnable locally.
- **Steps:**
  1. `npm run test:ci` and inspect the handler error-path assertion.
- **Expected result:** When a downstream call throws, the handler responds HTTP 500 with `status: "500"` / `message: "An unexpected error occurred during creator outreach."` and calls `Sentry.captureException`.
