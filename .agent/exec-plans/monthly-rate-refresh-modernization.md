# Modernize the two monthly creator-rate Cloud Functions and put them on the pipeline

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`.agent/PLANS.md` in this repository points to the canonical doctrine in the crafted plugin (`skills/exec-plan/references/PLANS.md`); this document is maintained in accordance with it.

Repository: `crafted_cloud_functions` only. Session worktree `/home/gustavo/dev/crafted/.worktrees/fix/ig-median-plays-refresh-crafted_cloud_functions`, branch `fix/ig-median-plays-refresh`, currently sitting on the head of PR #25 (`7c0d1a1`, `feature/creator-onboarding-ig-login-functions-b`), which itself stacks on PR #24 (`feature/creator-onboarding-ig-login`, open against `dev`). This plan builds on top of both and merges after them (see `Sequencing` in the Decision Log).

Authorization state: **implementation authorized on 2026-10-26** (user answers to the Open Questions, recorded in the Decision Log as D17–D19 and in `Open Questions`). M1–M7 are being implemented by `crafted:cloud-engineer` in this worktree; the PR is draft #28, stacked on #25. Deploys, Scheduler state changes and legacy retirement remain operator-only (the user). OQ-2 (who runs the one-time GCP steps, M0) is still open.

Settled decisions this plan reuses rather than re-opens: the modernization template in `.agent/exec-plans/creator-outreach-modernization.md` (TypeScript built at deploy via `gcp-build`, standalone nested lockfile, Biome via `@crafted/shared-config`, vitest, husky/commitlint, one shared hosting project with the environment in the deployed name, `NODE_ENV` selecting the Firebase data project, repo-level deploy secrets with `FIREBASE_SA_KEY` the only per-env secret, cold-start smoke and `pack build` gates, manual prod promotion with rollback) and the behaviour fixes in `.agent/exec-plans/creator-onboarding-ig-login.md` (PR #24/#25: key-paged and awaited TikTok refresh including creators without a stored rate, `last_error` persistence through `socialErrors.js`, rate-limit codes never treated as disconnections, `graphHost.js` routing by `api_path`). Those are cited, not restated.


## Purpose / Big Picture

Two Cloud Functions recompute every creator's suggested rate once a month: `refreshInstagramRates` (Cloud Scheduler job `refreshInstagramRates`, `0 1 1 * *` America/Cancun) and `refreshTikTokRates` (job `refreshTiktokRatesForAllAccounts`, `0 0 1 * *` America/Cancun). Both are legacy plain-JavaScript folders deployed by hand in 2024 into `crafted-dev-v1`, both read the **production** RTDB through a `firebase_connect.js` hard-wired to `crafted-v1`, both are publicly invokable, neither has a lint, type or test gate, and nobody sees when one fails: the TikTok job's 2026-10-01 run returned HTTP 500 after 70 s and the Scheduler job still shows `status.code: 13`. PR #24/#25 fixed the behaviour defects in place; the deployment and observability defects remain.

After this plan, a reader can:

- Edit `functions/refresh-instagram-rates/` and `functions/refresh-tiktok-rates/` in strict TypeScript, with `npm run check:ci`, `npm run typecheck` and `npm run test:ci` at the repo root covering them, and vitest proving that the Instagram refresh writes `median_plays` and `suggested_rate` in one update, that both rate formulas are unchanged, that both jobs page `users` in batches of 100 and never let one creator's error stop the batch, and that token errors land in `last_error` exactly as #24 specified.
- Open a PR and get Biome + typecheck + vitest + a cold-start smoke + a credential-free `pack build` for both functions, with nothing deployed.
- Push `dev` and see `refresh-instagram-rates-dev` / `refresh-tiktok-rates-dev` deploy into the shared hosting project **and** their Cloud Scheduler jobs created or updated in the same run; merge `main` for `-staging`; run the manual, reviewer-gated workflow for `-prod`.
- Cut production over from the 2024 functions to the new ones without a double run or a missed month, following a README recipe, and roll back by resuming one paused job.
- See a failed run in Sentry instead of in a Scheduler status code nobody reads.

Dev and staging data get a monthly rate refresh for the first time; today only production does.


## Progress

- [x] (2026-10-23 20:30Z) Plan authored by tech-lead against PR #25's head; facts verified read-only (`gcloud functions describe`, `gcloud scheduler jobs describe`, Cloud Logging for the 2026-10-01 runs, `gh variable list`). Awaiting user review of the recommendations and Open Questions.
- [x] (2026-10-26) User answered OQ-1, OQ-3…OQ-7 (see D17–D19 and `Open Questions`); implementation authorized; draft PR #28 open against #25's branch. OQ-2 still open.
- [x] (2026-10-26) M0 — One-time GCP operator steps, run by the orchestrator at the user's request (OQ-2 resolved). The deploy SA was confirmed as `crafted-deployer@crafted-dev-v1.iam.gserviceaccount.com` from the Cloud Functions audit log: it was the principal of every `creator-outreach-{dev,staging,prod}` UpdateFunction. Created `rate-refresh-invoker@crafted-dev-v1.iam.gserviceaccount.com` with no project roles. Granted the deployer `roles/cloudscheduler.admin` on the project and `roles/iam.serviceAccountUser` on the invoker SA. The Scheduler service agent `service-321295875407@gcp-sa-cloudscheduler` holds `cloudscheduler.serviceAgent`. Set the repo variable `RATE_REFRESH_INVOKER_SA`. Acceptance checks pass. Step 6 still fails: the `prod` Environment has no protection rules, and the user sets those.
- [x] (2026-10-26) M1 + M2 — workspace membership and `functions/refresh-instagram-rates/` port (commit `0cd628e`, cloud-engineer).
- [x] (2026-10-26) M3 — `functions/refresh-tiktok-rates/` port (`2caca2c`).
- [x] (2026-10-26) M4 + M5 — per-function vitest suites (IG 71 tests, TikTok 51), legacy folders deleted, legacy suite trimmed to 8 cases, four legacy `graphHost.js` headers edited identically (`5f09fdd`).
- [x] (2026-10-26) M6 — `rate-refresh-build.yml`, `rate-refresh-deploy-prod.yml` and the composite action `.github/actions/deploy-rate-refresh/action.yml` (`17187d7`).
- [x] (2026-10-26) M7 — README "Monthly rate refresh" section + CLAUDE.md tooling paragraph (`3c3757a`, `95700e1`).
- [x] (2026-10-26) M8 — required checks recorded in `Artifacts and Notes` (tree `3c3757a`); combined tech-lead review **GO**; draft PR #28. Review fixes N1–N4 landed in `a1e4da5` (Scheduler `describe` exit-code upsert; fake-gcloud matrix incl. PERMISSION_DENIED → fail, 0 resume calls; shellcheck/actionlint clean) and `4ba8c74` (README: Scheduler run primary, `DEPLOY_SA` derived from the key, heading rename); PR undrafted.
- [ ] M9 — Operator cutover per environment (dev, staging, prod) **before 2026-11-01**: pause the legacy prod jobs, run the one-time manual prod run (D17), pause the dev/staging jobs in the console (D18), retire the legacy jobs and functions after that manual run succeeds. Blocked on: the `prod` Environment protection rule (Surprises, 2026-10-26), and #24/#25 merging to `dev`.


## Surprises & Discoveries

- Observation: the "single shared hosting project" of the creator-outreach template is `crafted-dev-v1` — the repo variable `GCP_PROJECT=crafted-dev-v1` and `gcloud functions list --project crafted-dev-v1` shows `creator-outreach-dev`, `-staging` and `-prod` next to the 2024 legacy functions. So the new functions, the legacy functions and every Cloud Scheduler job (the Scheduler API is disabled on `crafted-v1`) all live in one project and one region (`us-central1`). No cross-project IAM is needed for the cutover.
  Evidence: `gh variable list` → `GCP_PROJECT crafted-dev-v1`; `gcloud functions list --project crafted-dev-v1` (2026-10-23).

- Observation: the legacy TikTok job's last scheduled run **failed**: Cloud Logging for `refreshtiktokrates` on 2026-10-01 shows one request, `httpRequest.status=500`, latency 70.5 s; the Scheduler job carries `status.code: 13`. Nothing alerted. The IG job's run the same morning returned 200 after 580 s (≈10 min).
  Evidence: `gcloud logging read` on `resource.labels.service_name="refreshtiktokrates"` / `"refreshinstagramrates"` for 2026-10-01T04:00–10:00Z. Consequence: the port adds Sentry capture on handler failure and a per-run summary log line (Decision D8), and Scheduler job state becomes an operator check in the README.

- Observation: the legacy IG function's Scheduler `attemptDeadline` is 1800 s with `retryCount: 1`, while the function's own timeout is 3000 s. Cloud Scheduler's maximum attempt deadline for HTTP targets is 30 minutes, so a run longer than 30 min is reported failed and **retried once while the first run is still executing** — a built-in double run. The TikTok job's deadline is 180 s (its legacy handler answered before doing any work).
  Evidence: `gcloud scheduler jobs describe refreshInstagramRates` / `refreshTiktokRatesForAllAccounts`. Consequence: Decision D10 aligns function timeout and attempt deadline at 1800 s with zero retries and `--max-instances=1`.

- Observation: the legacy function configs differ from each other and from the template: IG is `nodejs22`, 8 Gi, 2 vCPU, max 100 instances; TikTok is `nodejs20`, 4 Gi, 2 vCPU, max 100; both `timeoutSeconds: 3000`, concurrency 1, default compute SA, `allUsers` as `roles/run.invoker`, `LOG_EXECUTION_ID=true` as the only env var (no `PRODEV` — the deployed bundle carries its own `firebase_connect.js` + `serviceAccountKey.json`). The 8 Gi was sized for the pre-#24 whole-root reads; both handlers now page 100 keys at a time.
  Evidence: `gcloud functions describe --gen2` for both, 2026-10-23.

- Observation: `median_plays` is read by `client/src/Components/Brand_Dashboard/proposals/proposalMetrics.ts:53` (preferred when numeric), `TrialUgcProposals.js:127` (falls back to `suggested_rate / 2500 * 1000` when absent) and `server/services/ai/KylaToolsService.ts:71`; `suggested_rate` has many readers in both repos. Nothing in `client/` or `server/` reads `creator_socials/instagram/updated` or `tiktok/performance/updated`.
  Evidence: workspace grep, 2026-10-23. Consequence: the IG update may switch from `moment().format()` to `new Date().toISOString()` (matching #24's TikTok write) without a reader regression (Decision D9).

- Observation: the server backfill on branch `fix/ig-median-plays-backfill` (`server/scripts/backfillInstagramMedianPlays.ts`) re-derives `median_plays` as `Math.floor(suggested_rate * 1000 / 2500)` from the stored rate, has a `--mode=report` default and is re-runnable. It does not call Meta. So "re-run the backfill after the legacy Nov 1 run" is cheap and exact up to the `parseInt` in the rate formula (Decision D4).
  Evidence: the script's header and lines 147–154.

- Observation: the worktree at #25's head already contains the `median_plays` fix (`instagram.js` writes `median_plays: medianPlays` in the same `.update()` as `suggested_rate`) and the legacy suite asserts it (`legacySocialFunctions.test.ts:411,416`). The port carries it forward; it does not re-specify it.
  Evidence: `git show HEAD:functions/refreshInstagramRates/instagram.js | grep median_plays`; clean `git status`.

- Observation (2026-10-26, M6): **the `prod`, `staging` and `dev` GitHub Environments have no protection rules and no deployment-branch policy** — `gh api repos/Crafted-Corp/crafted_cloud_functions/environments/<env>` returns empty `protection_rules` for all three, and the repo is PUBLIC. The "required reviewer on `prod`" that the creator-outreach docs describe is therefore not in force: today anyone with write access can run either prod workflow unreviewed. README setup step 6 of the new section tells the operator to check and set the `prod` required reviewer; it is listed as a cutover prerequisite in Outcomes.
  Evidence: `gh api …/environments/prod --jq '.protection_rules'` → `[]` (2026-10-26).

- Observation (2026-10-26, M5): **retiring the legacy deployments is not reversible from source.** The 2024 bundles `require("./serviceAccountKey.json")` from `firebase_connect.js`, and that key file was never in git; the deployed artifacts are the only copies. Once `gcloud functions delete refreshInstagramRates` / `refreshTikTokRates` runs, a legacy redeploy would need a fresh prod key placed by hand. Consequence: the rollback window in M9 ends at retirement step (5), which is why retirement waits for the verified manual prod run.
  Evidence: `git show 7c0d1a1:functions/refreshInstagramRates/firebase_connect.js`; `.gitignore` lists `serviceAccountKey.json`.

- Observation (2026-10-26, M6): `creator-outreach-build.yml` sets workflow-level `concurrency: cancel-in-progress: true` for every event, so a second push to `dev` can cancel an in-flight `deploy-dev` of creator-outreach mid-`gcloud functions deploy`. The rate-refresh workflow does not copy that (D11 amendment); the creator-outreach workflow is untouched here. **Recorded as debt** for the creator-outreach pipeline: cancel on `pull_request` only, per-deploy groups with `cancel-in-progress: false`.
  Evidence: `.github/workflows/creator-outreach-build.yml:26-28`.

- Observation (2026-10-26, M7): `gcloud auth print-identity-token --audiences=<uri>` is rejected for user accounts (it works only for service-account credentials), so the README's `curl` alternative for a scoped run uses a plain `gcloud auth print-identity-token`; Cloud Run accepts a user identity token without an audience claim match when the caller holds `roles/run.invoker`.
  Evidence: README lines 672–676 (`3c3757a`).

- Observation: the legacy suite is a `node:test` + `node:vm` harness, not vitest, and is not wired into any root gate (README: `node --experimental-strip-types --test __tests__/legacySocialFunctions.test.ts`). Its file-selection branch names `refreshTikTokRates` explicitly (`:152`), and its "Graph host helpers are identical standalone copies" case lists `refreshInstagramRates` among five folders (`:419–431`). Both need editing when the legacy folders go (M5).


## Decision Log

- Decision: **D1 — Port shape: two workspace members, one function per directory, kebab-case names.** `functions/refresh-instagram-rates/` registers `functions.http("refresh-instagram-rates", …)` and `functions/refresh-tiktok-rates/` registers `functions.http("refresh-tiktok-rates", …)`; the gcloud `--entry-point` is the same string as the directory; the deployed name is `refresh-instagram-rates-<env>` / `refresh-tiktok-rates-<env>`. The old camelCase targets (`refreshInstagramRates`, `refreshTiktokRatesForAllAccounts`) are retired with the old deployments.
  Rationale: the repo rule (`CLAUDE.md`, *Function target name = `--entry-point`*): new functions use their kebab-case directory name as the in-code target, env suffix only on the deployed name. One combined "rate refresh" function was rejected: the two jobs run on different schedules, have different vendors, error catalogues and run times (the TikTok failure domain should not take Instagram down), and a combined function would need a routing parameter the Scheduler jobs would have to carry. Two small functions on one template cost one extra lockfile and nothing else.
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D2 — Deployment model: identical to creator-outreach.** Each function deploys three times into `crafted-dev-v1` (`vars.GCP_PROJECT`), isolated by name; `NODE_ENV` in `env.yaml` selects the data project in a per-function copy of `lib/firebase.ts`; the per-env GitHub Environments supply `FIREBASE_SA_KEY`; `SENTRY_DSN` is reused from the repo level; no SendGrid. Consequence accepted: **dev and staging start refreshing their own RTDB monthly.** Those runs call Meta Graph (`/media`, `/insights`) and TikTok (`user/info`, `video/list`) with whatever creator tokens exist in `crafted-dev-v1` / `crafted-staging-v1`, write `suggested_rate` / `median_plays` / `performance` / `updated` there, and write `last_error` on dead tokens (which is what the reconnect bars from #24 want to see in dev). Neither job rotates or refreshes a token (that is `refreshTokens`), so the only vendor side effect is read quota against those tokens.
  Rationale: the template's settled topology; a prod-only deploy would leave the pipeline unproven until the first prod run. Whether staging's RTDB holds real creators' tokens is OQ-1.
  Date/Author: 2026-10-23, tech-lead.
  Amendment (2026-10-26, OQ-1 answered): deploy to all three stages exactly like creator-outreach; the dev and staging Scheduler jobs are created enabled and the user pauses them manually in the GCP console (D18). Dev/staging data therefore gets a refresh only when the user chooses to resume a job.

- Decision: **D3 — Cloud Scheduler jobs are pipeline-managed, per environment, in `crafted-dev-v1` / `us-central1`, calling the function with an OIDC token from a dedicated invoker service account; the new functions deploy with `--no-allow-unauthenticated`.** The deploy jobs run an idempotent step: `gcloud scheduler jobs describe <job>` → `update http` if it exists, `create http` otherwise, with `--schedule`, `--time-zone=America/Cancun`, `--uri=<function URI>`, `--http-method=POST`, `--oidc-service-account-email=$RATE_REFRESH_INVOKER_SA`, `--oidc-token-audience=<function URI>`, `--attempt-deadline=1800s`, `--max-retry-attempts=0`. An `update` never changes a job's paused/enabled state, so an operator pause survives redeploys. Job names: `refresh-instagram-rates-<env>` (`0 1 1 * *`), `refresh-tiktok-rates-<env>` (`0 0 1 * *`). The deploy job also runs `gcloud functions add-invoker-policy-binding <fn> --member=serviceAccount:$RATE_REFRESH_INVOKER_SA` so the invoker SA holds `roles/run.invoker` on each function.
  Rationale: these functions have exactly one caller — Cloud Scheduler — so, unlike creator-outreach (whose `--allow-unauthenticated` is held open for the server's fire-and-forget call until ticket [353]), nothing cross-repo blocks closing them now; leaving a monthly full-database write job publicly invokable is the one legacy defect that is cheap to fix here. Manual (hand-run) jobs were rejected: the job must point at a per-env URL that only the deploy knows, and hand-created jobs are how the 2024 drift happened. The cost is one more IAM surface (M0) and that a scoped manual run needs an identity token (README recipe). If the org or deploy-SA permissions block OIDC jobs at the first dev deploy, fall back to `--allow-unauthenticated` + a public job for dev only and escalate (BD-1).
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D4 — SUPERSEDED on 2026-10-26 by D17 (user ruling on OQ-3/OQ-4).** Retained for the record. Original: The 2026-11-01 run stays with the legacy functions; afterwards the server backfill is re-run. This work cannot be reviewed, merged behind #24/#25, promoted to prod and cut over in eight days without skipping gates. On Nov 1 the legacy IG function (2024 deploy, no `median_plays` write) refreshes `suggested_rate` and leaves `median_plays` stale for every creator who has one; the operator then re-runs `scripts/backfillInstagramMedianPlays.ts --mode=report`, reviews the manifest, and `--mode=write`s it — it re-derives `median_plays` from the fresh rate, exactly as the first backfill did. The alternative "bridge" — hand-deploying #25's `instagram.js` (which already writes `median_plays`) onto the legacy `refreshInstagramRates` deployment before Nov 1 — was rejected: it ships unmerged code to production and, because #24/#25's IG changes (`last_error`, `graphHost`) are contract-coupled to an unmerged server PR, it would be #24's rollout decision, not this plan's. The user's standing rule applies: the fixed refresh is **never triggered by hand**; its first prod run is the first scheduled run after cutover (Dec 1 at the earliest).
  Rationale: the backfill exists, is re-runnable and costs minutes; a bridge deploy costs a prod change outside review. OQ-3 asks the same question for TikTok, whose legacy run will fail again on Nov 1.
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D5 — The copied helpers become per-function TypeScript modules, not a shared workspace package.** `functions/refresh-instagram-rates/lib/social-errors.ts` and `lib/graph-host.ts`, `functions/refresh-tiktok-rates/lib/social-errors.ts` — typed transcriptions of `socialErrors.js` / `graphHost.js` with identical behaviour and the same exported names (`metaMessageKey`, `tiktokMessageKey`, `lastErrorFor`, `graphHostFor`). A vitest case in each function asserts the two TS `social-errors.ts` copies are byte-identical (same mechanism as the legacy suite's `graphHost.js` check). The four remaining legacy `graphHost.js` / `socialErrors.js` copies in `refreshTokens`, `updateInstagramDemographics`, `processInstagramComments`, `refreshAllCampaignAnalytics` are **not touched**; #24's "keep the copies identical" instruction now reads "keep the legacy JS copies identical to each other and the TS copies identical to each other".
  Rationale: the TS-build-at-deploy contract (`CLAUDE.md`): the function manifest may not list a private workspace package, because GCF runs `npm ci` from the uploaded directory alone, and `tsconfig.json` may not `extends` a workspace path. A `packages/social-shared` would need a vendoring step at build time that no function has today — a new pattern needing its own migration plan. `lib/firebase.ts` and `lib/sentry.ts` are per-function copies of creator-outreach's for the same reason. Recorded as debt: when a fourth function migrates, evaluate a build-time vendored shared package once.
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D6 — Tests: migrate the rate-job cases into per-function vitest suites and shrink the legacy suite; no coverage is lost.** The five rate-job cases in `__tests__/legacySocialFunctions.test.ts` (`:272` TikTok zero-history + formula + handle; `:314` TikTok vendor errors write only `last_error`; `:336` TikTok pages/skips/isolates/five in flight; `:371` IG error mapping, rate-limit no-write, success clears `last_error` and writes `median_plays`; `:449` IG host and account-id routing per `api_path`) are re-expressed in `functions/refresh-*/__tests__/` against the TS modules with `../lib/firebase` mocked (creator-outreach's `vi.hoisted` + `vi.mock` pattern in `functions/creator-outreach/__tests__/handler.test.ts`) and `fetch` stubbed via `vi.stubGlobal`. Added cases: IG pages `users` in batches of 100 with `startAfter` (the legacy suite has this only for TikTok); `?user_id=` 404 for both; the TikTok write replaces the whole `performance` node with exactly `{median_likes, median_shares, followerCount, median_views, median_comments, suggestedRate, updated}`; the IG formula is `parseInt((median / 1000) * 2500)` and the TikTok formula is `(median_views / 1000) * 2500` (no truncation — preserved as-is); non-POST → 405. The legacy suite's `:419` identical-copies case shrinks to the four remaining folders.
  Rationale: the regression intent of each #24 case is kept, in the repo's test runner, next to the code it guards; the harness-level `node:vm` loader is not how TS modules are tested here.
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D7 — The legacy directories are deleted in the port PR.** `functions/refreshInstagramRates/` and `functions/refreshTikTokRates/` go in M5 (including their 250 KB lockfiles and the 26-dependency manifests). The deployed 2024 functions stay live until the retirement step in M9; rollback during cutover is a Scheduler pause/resume (no redeploy), and any emergency legacy redeploy would come from the pre-merge SHA via #24's README recipe.
  Rationale: the repo rule against keeping dead code; two implementations of one job is exactly the "new pattern in one file, old in fifty" drift the standards forbid. BD-3 lets the user keep them one release longer.
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D8 — Sentry on handler failure plus one summary log line per run.** Each handler captures the top-level error with `Sentry.captureException` (per-function `lib/sentry.ts`, `SENTRY_DSN` repo-level, `environment` from `NODE_ENV`) and logs `[INFO] <function> finished: processed=N skipped=N failed=N ms=N` before responding; the TikTok JSON body keeps #24's `{processed, skipped, failed}` and the IG body gains the same three counts next to its existing `status/statuscode/message` fields.
  Rationale: the Oct 1 TikTok 500 went unnoticed; an unattended monthly job needs one failure signal somebody reads. The per-creator `console.error` lines from #24 are preserved (Sentry is not called per creator — a dead token is not an incident).
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D9 — `updated` is written as `new Date().toISOString()` on both platforms; `moment` is not a dependency.** #24's TikTok write already does this; the IG write moves from `moment().format()` (`2026-10-01T06:00:34+00:00` on Cloud Run) to the same ISO form (`2026-10-01T06:00:34.000Z`).
  Rationale: no reader of either `updated` field exists in `client/` or `server/` (Surprises); both forms parse identically with `new Date()`; `moment` is deprecated and the manifests shrink to the template's runtime set. BD-7 if the user wants byte-identical output.
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D10 — Runtime shape: nodejs22, 1 vCPU, 2 Gi, concurrency 1, `--max-instances=1`, `--timeout=1800s`; Scheduler `--attempt-deadline=1800s --max-retry-attempts=0`.** Same for both functions and all envs.
  Rationale: with paging (from #24) neither job holds more than 100 user records; the Oct 1 IG run took 10 min on the whole-root code; 2 Gi is a 4× margin over what a 100-key page plus 25 media insights need. `max-instances=1` + concurrency 1 makes a second concurrent invocation impossible (a stray manual call or a retry cannot double-write). 1800 s is Scheduler's hard ceiling for HTTP attempts; a function timeout above it only produces the retried-while-running double run described in Surprises, so the two are aligned and retries are zero. If a run ever approaches 30 min the summary log (D8) shows it and the fix is page concurrency, not a longer deadline. BD-6.
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D11 — One new workflow pair with a two-function matrix, mirroring creator-outreach's jobs; no reusable-workflow refactor now.** `.github/workflows/rate-refresh-build.yml` (`quality` at the root — already fans out to every workspace member; `cold-start-smoke` and `build-preview` as a `strategy.matrix.function: [refresh-instagram-rates, refresh-tiktok-rates]`; `deploy-dev` / `deploy-staging` matrix jobs with the Scheduler step from D3) and `.github/workflows/rate-refresh-deploy-prod.yml` (`workflow_dispatch`, `environment: prod`, `ref` input, capture-revision + rollback-on-failure, matrix over both functions). Path filters: both function dirs, `packages/shared-config/**`, root `package.json`/`package-lock.json`/`nx.json`, the workflow file. `creator-outreach-build.yml` is untouched.
  Rationale: a `workflow_call` reusable workflow would be a new pattern that creator-outreach would then have to migrate to; with three functions on the template the duplicated YAML is still readable. Recorded as debt: consolidate into a reusable deploy workflow when the next function migrates.
  Date/Author: 2026-10-23, tech-lead.
  Amendment (2026-10-26, cloud-engineer, accepted in review): the deploy + Scheduler upsert is written **once** in a repo-local composite action, `.github/actions/deploy-rate-refresh/action.yml`, invoked by the `deploy-dev`, `deploy-staging` and `deploy-prod` matrix jobs. It is not a `workflow_call` reusable workflow (no new cross-workflow pattern), and `creator-outreach-build.yml` is untouched. The action's Scheduler step is describe → `update http` / `create http`; it reads the job state before and after an update and, if an update ever flipped PAUSED to ENABLED, pauses it again and fails the step — it never calls `resume` (D18). **Concurrency:** the build workflow cancels in-progress runs only on `pull_request` (`cancel-in-progress: ${{ github.event_name == 'pull_request' }}`), and each deploy job carries its own group `rate-refresh-deploy-<function>-<env>` with `cancel-in-progress: false`, so a push during a deploy queues instead of killing a half-applied `gcloud functions deploy`.

- Decision: **D20 — `?user_id=` must be a single non-empty value; empty or repeated → 400.** Both handlers reject `?user_id=` (empty) and `?user_id=a&user_id=b` with `400 {status:"400", statuscode:"-1", message:"user_id must be a single non-empty value."}` before any Firebase read. The legacy handlers treated an empty `user_id` as absent and ran the **full scan** — a typo in a scoped manual run would have refreshed every creator.
  Rationale: a scoped run is the only hand-run path operators use against dev; failing closed costs nothing and removes an accidental full-database write.
  Date/Author: 2026-10-26, cloud-engineer (accepted in the tech-lead review).

- Decision: **D21 — The manual prod run is `gcloud scheduler jobs run <job>` first; an authenticated `curl` is the documented alternative.** README fix N1 reorders the section so the Scheduler-driven run leads (it uses the job's own OIDC identity and leaves an attempt record, per D17) and the `curl -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" <uri>` form follows for a scoped `?user_id=` run; the curl uses a plain identity token because `--audiences` fails for user accounts (Surprises).
  Date/Author: 2026-10-26, tech-lead (review finding N1).

- Decision: **D22 — The header comment in the four remaining legacy `graphHost.js` copies was edited identically** (`refreshTokens`, `updateInstagramDemographics`, `processInstagramComments`, `refreshAllCampaignAnalytics`) to drop `refreshInstagramRates` from the list of standalone copies; the function bodies are byte-identical and unchanged, so the legacy suite's identical-copies case still passes over the four folders.
  Rationale: a header naming a deleted folder is a stale comment; the Non-Goal "no edit to the other functions' copies" protects their behaviour, not a comment that this PR itself made wrong.
  Date/Author: 2026-10-26, cloud-engineer (accepted in the tech-lead review).

- Decision: **D12 — Sequencing: this PR stacks on #25 and merges third; it never merges ahead of #24/#25.** The branch is already on #25's head, so the PR targets `feature/creator-onboarding-ig-login-functions-b` and shows only the port; after #24 then #25 land on `dev`, retarget to `dev` (and rebase if either was squash-merged, which otherwise duplicates their commits in this PR — see the stacked-PR trap: deleting a base branch auto-closes the child, so retarget before #25's branch is deleted). If #24/#25 are still unmerged when the user wants this shipped, the only options are (a) wait, or (b) merge #24 and #25 first on their own review — this PR's diff deletes files they modify, so merging it first would both conflict and silently ship their behaviour changes without their contract-coupled server PRs. The plan is written against (a). BD-5.
  Rationale: #24/#25 own the behaviour; this plan owns the packaging. Cutting a fresh branch off `dev` and re-doing the port against pre-#24 code was rejected — it would re-specify their fixes, which the brief forbids.
  Date/Author: 2026-10-23, tech-lead.
  Amendment (2026-10-26, user ruling on OQ-5 and OQ-3): the stacked third PR exists as **draft #28** (`fix/ig-median-plays-refresh` → `feature/creator-onboarding-ig-login-functions-b`). Because D17 requires the new prod functions to be live and cut over **before 2026-11-01**, **#24 and #25 must merge to `dev` before Nov 1** for this to ship in time — reviewing and merging them on that timeline is the user's call, outside this plan. If they do not merge in time, D17's deadline is missed and the fallback is the superseded D4 path (legacy Nov 1 run, server backfill re-run afterwards); no bridge deploy of unmerged code in either case.

- Decision: **D17 — Ship this port to production before 2026-11-01, cut over before Nov 1, and run one authorized manual prod run on cutover day; supersedes D4.** Order, in one operator session (the user), on any day before Nov 1: (1) #24, #25 and #28 merged; `dev` and `main` pushes have deployed `-dev` / `-staging`; (2) run `rate-refresh-deploy-prod.yml` (deploys both `-prod` functions and creates both `-prod` Scheduler jobs ENABLED); (3) pause the legacy prod jobs `refreshInstagramRates` and `refreshTiktokRatesForAllAccounts` (`gcloud scheduler jobs pause … --project crafted-dev-v1 --location us-central1`) so the legacy Nov 1 run **does not happen**; (4) **one-time manual prod run** of both new jobs — `gcloud scheduler jobs run refresh-instagram-rates-prod` and `gcloud scheduler jobs run refresh-tiktok-rates-prod` (the job fires with its own OIDC identity, so no hand-minted token is needed and the run is logged as a Scheduler attempt) — and verify `status.code` 0 plus the `finished: processed=… failed=… ms=…` summary line on each; (5) delete the two legacy jobs and `gcloud functions delete refreshInstagramRates` / `refreshTikTokRates` (OQ-4 authorized this after the first successful prod run, which is this manual run). The next scheduled run is then 2026-11-01 on the new functions. **This manual run explicitly overrides the earlier "never trigger the fixed refresh by hand" rule, once.** Effect to expect: it recomputes `suggested_rate` (and `median_plays` / `performance`) for **every non-negotiated creator mid-month**; proposals created after it carry the new rate, while existing proposals keep the snapshot they stored (`approved_proposals/…/creator_socials/*` is a copy, `server/services/influencerService.js:50-54`). The server backfill re-run from D4 is no longer needed because the new IG function writes `median_plays` itself; the manual run also refreshes every stale `median_plays` in one pass.
  Rationale: user ruling 2026-10-26 (OQ-3: ship the proper fix, no bridge deploy; OQ-4: deletion authorized after the first successful prod run, which the user makes a one-time manual run today after merging so everything updates and the legacy functions can be retired with evidence). Running the Scheduler job rather than `curl`ing the function keeps the private/OIDC posture (D3) intact and leaves an attempt record on the job.
  Date/Author: 2026-10-26, tech-lead (recording the user's ruling).

- Decision: **D18 — Scheduler jobs are created ENABLED in every environment; the user pauses the dev and staging jobs by hand in the GCP console; the deploy step must never resume a paused job.** Supersedes BD-2's "pause right after creating" alternative. The deploy step uses `gcloud scheduler jobs update http` for an existing job (which does not touch `state`) and `create http` only when the job is absent; it never calls `resume`. A job the user paused stays paused across every later deploy; an operator check in the README (`gcloud scheduler jobs list --format='table(name,state)'`) is the way to see the current state.
  Rationale: user ruling on OQ-1 — deploy to all stages exactly like the creator-outreach workflows; manual pausing in the console is the chosen control, so the pipeline must not undo it.
  Date/Author: 2026-10-26, tech-lead (recording the user's ruling).

- Decision: **D19 — Private functions with Scheduler-only OIDC invocation (BD-1 default confirmed) and Sentry capture on handler failure (BD-8 default confirmed).**
  Rationale: user rulings on OQ-6 and OQ-7, 2026-10-26.
  Date/Author: 2026-10-26, tech-lead (recording the user's ruling).

- Decision: **D13 — Legacy defects: keep #24's per-creator error handling (now typed); the whole-root read and un-awaited promises are already gone in #24; public invocation is fixed by D3.** The IG handler's shape — per-creator try/catch returning `null`, `Promise.all` within a 100-key page — stays, because `CLAUDE.md` *Error Handling* / *Concurrency* prescribe exactly that. One typed refinement: the IG handler's catch-all response body returns `{status, statuscode, message}` only, never the raw `error` object (`res.status(500).json({..., result: error})` today serialises whatever Meta returned).
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D14 — Workspace membership is explicit:** root `package.json` `workspaces` becomes `["packages/*", "functions/creator-outreach", "functions/refresh-instagram-rates", "functions/refresh-tiktok-rates"]`, never `functions/*`.
  Rationale: creator-outreach's settled decision — a glob would pull the seven remaining legacy manifests into the root install.
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D15 — Runtime dependencies pinned to the template's versions:** `@google-cloud/functions-framework ^3`, `cors ^2.8.5`, `dotenv ^16`, `firebase-admin ^9.9.0`, `@sentry/node ^7.112.2`; devDependencies `typescript`, `@types/node`, `@types/cors`, `vitest`. No `axios`, `moment`, `node-fetch` (Node 22's global `fetch` is what #24's code already uses).
  Rationale: parity with creator-outreach; bumping `firebase-admin` is its own change across all three functions.
  Date/Author: 2026-10-23, tech-lead.

- Decision: **D16 — Handlers accept POST only; any other method gets 405 without touching Firebase.** Cloud Scheduler already POSTs (verified on both jobs), and the README's manual scoped run uses POST.
  Rationale: the template's `cold-start-smoke` gate boots the compiled function with a dummy Firebase key and probes it; creator-outreach answers 400 on an empty body before any Firebase read, but a rate handler has no body to reject and would start a scan against the dummy credential. A `GET /` → 405 gives the smoke a deterministic response that proves the module imported and listens.
  Date/Author: 2026-10-23, tech-lead.

### Blocking decisions

Resolved by the user on 2026-10-26 unless marked otherwise; the original defaults and alternatives are kept for the record.

- BD-1 — Invocation auth (D3). **Resolved: default confirmed (D19)** — private functions + OIDC Scheduler jobs via a dedicated invoker SA. (Alternative, not taken: `--allow-unauthenticated` + public jobs; M0 would shrink to the repo variable only.)
- BD-2 — Dev and staging schedules (D2). **Resolved by D18** — jobs created enabled everywhere; the user pauses dev/staging in the console; the deploy never resumes a paused job. (Alternative, not taken: the deploy step pauses the job after creating it.)
- BD-3 — Delete the legacy directories in the port PR (D7). **Default stands** (no objection raised): delete.
- BD-4 — Nov 1 handling. **Resolved by D17** — ship before Nov 1, cut over before Nov 1, one-time manual prod run; the D4 backfill re-run is the fallback only if #24/#25 miss the date (D12 amendment).
- BD-5 — PR topology (D12). **Resolved: default confirmed** — stacked PR, open as draft #28; retarget to `dev` after #24/#25 merge.
- BD-6 — Timeout 1800 s / attempt deadline 1800 s / zero retries / max-instances 1 (D10). **Default stands.**
- BD-7 — `updated` as ISO `toISOString()` and no `moment` (D9). **Default stands.**
- BD-8 — Sentry capture on handler failure (D8). **Resolved: default confirmed (D19).**
- BD-9 — Owner and timing of the one-time GCP steps (M0). **Open (OQ-2).** Default: the user runs them by hand from the README deploy list before the first `dev` push that deploys, as was done for creator-outreach. Stops the first deploy, not the code.


## Outcomes & Retrospective

Entry (2026-10-26, end of M8): **code complete, combined tech-lead review GO.** Against the Purpose: both functions are strict TypeScript workspace members on the root `check:ci` / `typecheck` / `test:ci` / `build` gates; the per-function vitest suites prove `median_plays` is written with `suggested_rate` in one update, both formulas are unchanged, both jobs page 100 keys and isolate per-creator failures, and token errors land in `last_error` as #24 specified (mutation probes in `Artifacts and Notes` confirm each guard bites); PR gates (Biome, typecheck, vitest, cold-start smoke, `pack build`) run with no deploy; per-env deploys and the Scheduler upsert live once in the composite action with OIDC-only invocation; failures reach Sentry and a per-run summary line. Scope held: #24/#25's behaviour was transcribed, not redesigned; the other four legacy functions changed only by a header comment (D22).

Pending before the Purpose's last two bullets (cutover without a double run or missed month; prod live before Nov 1) are true: the `prod` GitHub Environment required-reviewer rule, which does not exist today (Surprises); #24 and #25 merging to `dev` and #28 being retargeted and merged; then the M9 operator cutover before 2026-11-01. Live workflows, `pack build` in CI and every `gcloud` mutation remain unverified until those run (listed as not run in `Artifacts and Notes`).

Lessons: verify the GitHub Environment gate with `gh api` rather than trusting docs that describe it; a scheduled job's only caller being Scheduler makes OIDC-only cheap and should be the default for any further migrated job; and the retirement of hand-deployed 2024 bundles must be treated as one-way because their credentials were never in git.


## Context and Orientation

### The two functions as they are on this branch (PR #25's head)

`functions/refreshInstagramRates/` — `index.js` registers `functions.http("refreshInstagramRates", refreshInstagramRates)`; `instagram.js` holds the handler. The handler is wrapped in `cors`, honours `?user_id=<uid>` (404 when the user node is absent) or pages `users` with `orderByKey().limitToFirst(100).startAfter(lastKey)`, and per page runs `processUserInstagramRate` for every key inside `Promise.all` with a per-user try/catch that logs and returns `null`. `processUserInstagramRate` skips `negotiated === true` and nodes lacking an id/token (the id is `instagram_user_id` when `api_path === "instagram"`, else `instagram_business_account_id`), calls `calculateSuggestedRate`, and on success writes one `.update()` on `users/{uid}/creator_socials/instagram` with `suggested_rate`, `median_plays`, `updated` and `last_error: null`. `calculateSuggestedRate` fetches `${graphHostFor(node)}/{id}/media?fields=media_type&limit=300`, takes the first 25 `VIDEO` items, fetches `/{mediaId}/insights?metric=views` five at a time, takes the median of the play counts and returns `{ suggestedRate: parseInt((median / 1000) * 2500), medianPlays: median }`. A Meta error on `/media` or `/insights` with a code in the `socialErrors.js` catalogue (190 with subcodes, 102, 10, 200) writes only `last_error` and skips the creator; codes 4/17/32 (rate limits) are logged and write nothing; any other error propagates to the per-user catch. `firebase_connect.js` (hard-wired to `https://crafted-v1.firebaseio.com` + a bundled `serviceAccountKey.json`) is what `process.env.PRODEV` resolves to in the deployed bundle.

`functions/refreshTikTokRates/` — `index.js` registers `functions.http("refreshTiktokRatesForAllAccounts", …)`; `influencer.js` holds #24's rewrite: `?user_id=` or key-paged `users` (100), five creators in flight per chunk, each `getSuggestedRateTikTok(uid, user)` returning `"processed" | "skipped" | "failed"`, counts returned as `{processed, skipped, failed}` **after** all pages. Skips `negotiated` and missing/`"null"` tokens. Fetches `user/info?fields=follower_count` then `video/list` (`max_count: 20`); a TikTok error code in the catalogue (2190002/2190003/2190008/10010) writes only `last_error` and counts as failed; otherwise computes medians of views/likes/shares/comments, `suggestedRate = (median_views / 1000) * 2500` (no truncation), derives `handle` from the first `share_url`, and writes one `.update()` on `users/{uid}/creator_socials/tiktok` with `performance: {…seven fields…}`, `updated`, `last_error: null` and `handle` when present — the nested `performance` object replaces the whole `performance` node, exactly like the pre-#24 `.set()` did.

Both folders carry the same 26-dependency `package.json` (`puppeteer`, `stripe`, `openai`, …) and a 250 KB lockfile inherited from an old server manifest; the code uses `@google-cloud/functions-framework`, `cors`, `dotenv`, `moment` (IG only) and the global `fetch`.

### Deployed state (read-only, 2026-10-23)

Project `crafted-dev-v1`, region `us-central1`, both Gen2. `refreshInstagramRates`: nodejs22, 8 Gi / 2 vCPU, timeout 3000 s, max 100 instances, concurrency 1, public invoker, last deployed 2024-09-01, URI `https://refreshinstagramrates-mkaypl5hza-uc.a.run.app`. `refreshTikTokRates`: nodejs20, 4 Gi / 2 vCPU, otherwise identical, URI `https://refreshtiktokrates-mkaypl5hza-uc.a.run.app`. Scheduler (same project, location `us-central1`): `refreshInstagramRates` `0 1 1 * *` America/Cancun, POST to `https://us-central1-crafted-dev-v1.cloudfunctions.net/refreshInstagramRates`, attempt deadline 1800 s, retryCount 1, last run 2026-10-01T06:00Z (200, 580 s), next 2026-11-01T06:00Z; `refreshTiktokRatesForAllAccounts` `0 0 1 * *` America/Cancun, POST to `…/refreshTikTokRates`, attempt deadline 180 s, last run 2026-10-01T05:00Z (500, 70 s, job status code 13), next 2026-11-01T05:00Z. Neither job carries an OIDC/OAuth identity. Both deployments write the **prod** RTDB.

### The template to copy

`functions/creator-outreach/` is the reference (`CLAUDE.md` *Tooling & Standards*, *TS build-at-deploy contract*, *GCF infra*; `README.md` *creator-outreach infrastructure*; `.agent/exec-plans/creator-outreach-modernization.md`). The files a new member needs, each copied and adapted: `package.json` (`main: dist/index.js`, `gcp-build` → `build` = `tsc` + copy `config/*.json` into `dist/config/`, `typecheck`, `dev`, `start`, Biome and vitest scripts, `engines.node >=22`), a self-contained `tsconfig.json`, `biome.json` extending `@crafted/shared-config/biome`, `vitest.config.ts`, `.lintstagedrc.mjs`, `.gcloudignore`, `.env.example`, `lib/firebase.ts` (NODE_ENV → database URL + `config/<env>ServiceAccountKey.json`, dynamic `require`, throws at import when the key is missing), `lib/sentry.ts`, and a standalone public-registry `package-lock.json` regenerated with the temp-directory recipe in the creator-outreach plan's *Concrete Steps*. The workflows to mirror are `.github/workflows/creator-outreach-build.yml` (quality → cold-start-smoke + build-preview → deploy-dev / deploy-staging) and `creator-outreach-deploy-prod.yml` (capture revision → deploy → rollback on failure). GitHub config already present: variables `GCP_PROJECT=crafted-dev-v1`, `GCP_REGION=us-central1`; secrets `GCP_SA_KEY`, `SENDGRID_API_KEY`, `SENTRY_DSN` (repo-level); Environments `dev`, `staging`, `prod` each holding `FIREBASE_SA_KEY`.

### Terms

"Hosting project" is where the Cloud Run services and Scheduler jobs live (`crafted-dev-v1` for every environment). "Data project" is the Firebase RTDB a function reads and writes (`crafted-dev-v1`, `crafted-staging-v1`, `crafted-v1`), chosen by `NODE_ENV`. "Env-in-name" means the environment is the suffix of the deployed function name, not a separate project. "Invoker SA" is a service account whose only role is `roles/run.invoker` on the two functions; Cloud Scheduler signs an OIDC token as that account on every call and Cloud Run rejects requests without it. "Cutover" is the moment the new `-prod` Scheduler job is the one that fires on the 1st and the legacy job is paused.


## Non-Goals

- No change to either rate formula, to the Firebase paths or field names, to the Meta/TikTok endpoints, or to the schedules (`0 1 1 * *` / `0 0 1 * *` America/Cancun). A changed formula silently re-prices every creator.
- No re-specification of #24/#25's fixes (paging, awaited writes, inclusion of creators without a stored rate, `last_error`, `graphHost`). The port transcribes the current JS; a behavioural diff found during the port is a `Surprises` entry and a note to the user, not a redesign.
- No edit to `refreshTokens`, `updateInstagramDemographics`, `processInstagramComments`, `refreshAllCampaignAnalytics` or their `graphHost.js` / `socialErrors.js` copies, and no edit to `creator-outreach` or its workflows.
- No manual trigger of any `-prod` function except the **single** authorized cutover run in D17 (user ruling 2026-10-26, overriding the earlier "never by hand" rule once). Dev-only scoped calls (`?user_id=` on a run-tagged dev creator) remain the live check before cutover.
- No `firebase-admin` major bump, no shared vendored package, no reusable-workflow refactor (all recorded as debt).
- No `maintenance/` scripts, no release notes, no manual test plan, no Notion page unless requested.


## Plan of Work

### M0 — One-time GCP operator steps (operator-only, before the first dev deploy)

Create the invoker service account in the hosting project, `rate-refresh-invoker@crafted-dev-v1.iam.gserviceaccount.com`, with no project-level roles. Grant the deploy service account (the identity behind `GCP_SA_KEY`) `roles/cloudscheduler.admin` on the project and `roles/iam.serviceAccountUser` **on the invoker SA** (Scheduler job creation requires `actAs` on the OIDC account). Confirm the Cloud Scheduler service agent (`service-321295875407@gcp-sa-cloudscheduler.iam.gserviceaccount.com`) holds `roles/cloudscheduler.serviceAgent` (granted automatically when the API was enabled). Add the repo variable `RATE_REFRESH_INVOKER_SA` with the SA email. `roles/run.invoker` on each function is granted by the deploy step (D3), not here. Acceptance: `gcloud iam service-accounts describe rate-refresh-invoker@…` succeeds and `gh variable list` shows the new variable.

### M1 — Workspace membership

Edit root `package.json` `workspaces` per D14. No other root change: `nx.json`, husky, commitlint and `packages/shared-config` already apply to any member. Acceptance: `npm ci` at the root links both new directories once they exist; `npm run check:ci` / `typecheck` / `test:ci` enumerate three projects.

### M2 — `functions/refresh-instagram-rates/` (TypeScript port)

Create the directory from the template files listed in Context. Source files:

- `index.ts` — `functions.http("refresh-instagram-rates", refreshInstagramRates)` with the naming-invariant comment from creator-outreach's `index.ts` adapted.
- `function-handler.ts` — exports `refreshInstagramRates: HttpFunction`. Method guard (D16) → cors → start log → `?user_id=` branch or the 100-key paging loop → summary log + JSON response (`status`, `statuscode`, `message`, plus `processed`/`skipped`/`failed`) → top-level catch → `Sentry.captureException` + 500 `{status:"500", statuscode:"-1", message}` (D13).
- `lib/instagram-rates.ts` — `processUserInstagramRate(firebase, uid, user): Promise<RateOutcome>` and `calculateSuggestedRate(accessToken, accountId, node): Promise<{ suggestedRate: number; medianPlays: number }>`, transcribed from `instagram.js` including the `BATCH_SIZE_MEDIA = 5` insight batching, the 25-reel cap, the `GraphError` carried on thrown errors, and the catalogue/rate-limit branches. `median()` and the formula live in `lib/rates.ts` as pure exports.
- `lib/social-errors.ts`, `lib/graph-host.ts` — D5 copies. `lib/firebase.ts`, `lib/sentry.ts` — template copies.
- Types: `InstagramSocialNode` (`access_token?`, `instagram_business_account_id?`, `instagram_user_id?`, `api_path?: "facebook" | "instagram"`, `suggested_rate?`, `median_plays?`, `updated?`, `last_error?: LastError | null`), `UserRecord` (`negotiated?: boolean; creator_socials?: {instagram?: InstagramSocialNode}`), `GraphErrorBody` (`code?: number; error_subcode?: number; message?: string`), `LastError` (`{ code: number | string; subcode?: number; message_key: string; at: string }`), `RateOutcome` (`{ outcome: "processed"; suggestedRate: number } | { outcome: "skipped"; reason: "negotiated" | "missing_instagram_info" | "token_error" | "rate_limited" } | { outcome: "failed" }`). No `any`, no `as unknown as`; Firebase snapshot values are narrowed through small type guards.

`package.json` name `refresh-instagram-rates`, scripts and dependencies per D15, `dev`/`start` targeting `refresh-instagram-rates`. Regenerate the standalone lockfile. Acceptance: `npm run typecheck -w refresh-instagram-rates` passes; `npm run build -w refresh-instagram-rates` emits `dist/index.js` and `dist/lib/*.js`.

### M3 — `functions/refresh-tiktok-rates/` (TypeScript port)

Same skeleton. `index.ts` registers `refresh-tiktok-rates`. `function-handler.ts` exports `refreshTiktokRates: HttpFunction`: method guard → cors → `?user_id=` (404 `{message:"User not found"}` preserved) or 100-key pages → `processBatch` five in flight → counts → summary log → `res.status(200).json(counts)` (body shape unchanged from #24) → top-level catch → Sentry + 500 `{message:"Error updating suggested rates"}`. `lib/tiktok-rates.ts` — `getSuggestedRateTikTok(firebase, uid, user): Promise<"processed" | "skipped" | "failed">` transcribed from `influencer.js`, including `readResponse`'s catalogue branch, the `"null"` token skip, the `handle` regex, the seven-field `performance` object and the untruncated formula. `lib/rates.ts` (median), `lib/social-errors.ts` (D5), `lib/firebase.ts`, `lib/sentry.ts`. Types: `TikTokSocialNode`, `TikTokVideo` (`view_count`, `like_count`, `share_count`, `comment_count`, `share_url`), `TikTokEnvelope<T>` (`data?: T; error?: { code?: number | string }`), `PerformanceNode`. Acceptance as M2.

### M4 — vitest suites

`functions/refresh-instagram-rates/__tests__/`: `rates.test.ts` (median odd/even/empty → 0; formula `parseInt((2000/1000)*2500) === 5000`; `graphHostFor` defaults and the `instagram` branch; `metaMessageKey` catalogue incl. 190 subcodes), `instagram-rates.test.ts` (success writes one `update` containing `suggested_rate`, `median_plays`, `updated`, `last_error: null` on the instagram node and nothing else; catalogue errors on `/media` and `/insights` write only `last_error` with the right key; 4/17/32 write nothing; `negotiated` and missing-info skips; host and account id per `api_path` from the legacy `:449` case; zero reels → rate 0, plays 0), `handler.test.ts` (405 on GET; `?user_id=` 404; pages with `limitToFirst(100)` + `startAfter(lastKey)` over 103 users and stops at a short page; one creator's thrown error does not stop the page; response carries counts; thrown Firebase error → Sentry + 500 with no raw error body), `helpers-identical.test.ts` (the two `social-errors.ts` copies are byte-identical). `functions/refresh-tiktok-rates/__tests__/`: `rates.test.ts`, `tiktok-rates.test.ts` (legacy `:272` zero-history + formula + handle; `:314` catalogue errors on either endpoint write only `last_error` and count as failed; `performance` written with exactly the seven keys), `handler.test.ts` (legacy `:336` paging/skips/network-failure isolation/peak in-flight ≤ 5; 405; 404; Sentry on top-level failure). Mocking follows `functions/creator-outreach/__tests__/handler.test.ts`; `fetch` is `vi.stubGlobal("fetch", vi.fn(...))`; the mocked `res` needs `status/json/setHeader/getHeader` because real `cors` runs. Acceptance: `npm run test:ci` at the root → three suites green; removing the `median_plays` key from the IG update fails `instagram-rates.test.ts`; changing either formula constant fails `rates.test.ts`.

### M5 — Retire the legacy directories

Delete `functions/refreshInstagramRates/` and `functions/refreshTikTokRates/` (D7). In `__tests__/legacySocialFunctions.test.ts`: remove the five rate-job cases (M4 owns them), drop `refreshTikTokRates` from the file-selection branch at `:152`, and shrink the identical-copies list at `:419` to the four remaining folders. In `README.md` *Scheduled legacy social functions*: remove the two rows and add one sentence pointing at the new section. In `CLAUDE.md`: Repository Structure and the Tooling paragraph list the three template members. Acceptance: `node --experimental-strip-types --test __tests__/legacySocialFunctions.test.ts` passes with 8 tests; `grep -rn "refreshInstagramRates\|refreshTiktokRatesForAllAccounts\|refreshTikTokRates" --include=*.md --include=*.ts --include=*.js --include=*.yml .` (untruncated) returns only the README cutover/retirement recipe, this plan and #24's plan (historical).

### M6 — Workflows

`rate-refresh-build.yml` per D11. The `quality` job is byte-for-byte creator-outreach's (root commands). `cold-start-smoke` matrix: dummy key into `functions/${{ matrix.function }}/config/devServiceAccountKey.json`, `npm run build -w ${{ matrix.function }}`, boot `functions-framework --target=${{ matrix.function }}`, probe with `curl -X GET` and accept any HTTP response (405 expected). `build-preview` matrix: `pack build … --path functions/${{ matrix.function }} --env GOOGLE_FUNCTION_TARGET=${{ matrix.function }} --env GOOGLE_RUNTIME=nodejs22 --env GOOGLE_NODEJS_VERSION=22`. `deploy-dev` / `deploy-staging` matrix (branch-guarded exactly as creator-outreach): auth → materialize `FIREBASE_SA_KEY` into `config/<env>ServiceAccountKey.json` → `env.yaml` with `NODE_ENV`, `SENTRY_DSN`, `LOG_EXECUTION_ID` → `gcloud functions deploy ${{ matrix.function }}-<env> --gen2 --project=${{ vars.GCP_PROJECT }} --region=… --runtime=nodejs22 --trigger-http --no-allow-unauthenticated --entry-point=${{ matrix.function }} --source=functions/${{ matrix.function }} --env-vars-file=env.yaml --memory=2Gi --cpu=1 --timeout=1800s --concurrency=1 --max-instances=1` → `gcloud functions add-invoker-policy-binding` for `vars.RATE_REFRESH_INVOKER_SA` → describe the URI → Scheduler describe/update-or-create (D3; schedule from a matrix `include` field: `0 1 1 * *` for instagram, `0 0 1 * *` for tiktok) → print URI and job state. `rate-refresh-deploy-prod.yml`: creator-outreach's prod workflow with the matrix, the same Scheduler step, `config/serviceAccountKey.json`, `NODE_ENV=prod`. Secrets only via step `env:`. Acceptance: `actionlint` clean; on a PR `gh pr checks` shows `quality`, two `cold-start-smoke`, two `build-preview`, no deploy; on push to `dev` both `-dev` functions and both `-dev` jobs exist (`gcloud scheduler jobs list` shows them ENABLED with the invoker SA).

### M7 — README and CLAUDE.md

New README section *Monthly rate refresh (refresh-instagram-rates / refresh-tiktok-rates)*, the single home for: the per-env names and URIs, the Scheduler job names/schedules/time zone/deadline and that the pipeline owns them, the invoker SA and `RATE_REFRESH_INVOKER_SA`, the deploy list (M0 steps compacted but complete), the **cutover recipe** (M9 below, copy-pasteable, including the one-time `gcloud scheduler jobs run` prod run and its mid-month rate effect from D17), the rule that dev/staging jobs are paused by hand in the console and that a deploy never resumes a paused job (D18), **rollback** (pause new job, resume legacy job), **retirement** (delete the two legacy jobs and the two legacy functions after the first successful prod run), the scoped manual run against **dev only** (`curl -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences=<uri>)" "<uri>?user_id=<run-tagged uid>"`), and the operator check "`gcloud scheduler jobs describe … --format='value(status.code,lastAttemptTime)'` after the 1st". #24's *Scheduled legacy social functions* section keeps owning the four remaining legacy functions and loses the two rows (M5). `CLAUDE.md` *Tooling & Standards* gains one paragraph: three members on the template, the rate functions are private + OIDC-scheduled, and the Scheduler step is part of the deploy. Acceptance: every deploy fact appears in exactly one section (grep the README for each job name and the SA email).

### M8 — Checks, review, PR

Root `npm run check:ci`, `npm run typecheck`, `npm run test:ci`, `npm run build`; `node --experimental-strip-types --test __tests__/legacySocialFunctions.test.ts`; `pack build` for both functions locally or via the PR; cold-start smoke locally. One combined tech-lead review of the full diff. PR per D12 with a conventional title (`feat(rate-refresh): port monthly rate functions to the TS template and pipeline`). Record check identities and durations in *Artifacts and Notes*.

### M9 — Operator cutover (per environment; before 2026-11-01; operator = the user)

Dev: push `dev` → both `-dev` functions and jobs (created ENABLED); verify a scoped `?user_id=` run against one run-tagged dev creator writes `suggested_rate` + `median_plays` + `updated` + `last_error: null` (IG) and `performance` + `updated` + `last_error: null` (TikTok); then pause both `-dev` jobs in the GCP console (D18). Staging: merge `main`; same checks; pause both `-staging` jobs in the console. Prod cutover, in one operator session, before Nov 1 (D17): (1) run `rate-refresh-deploy-prod.yml` (creates both `-prod` jobs ENABLED); (2) immediately `gcloud scheduler jobs pause refreshInstagramRates` and `gcloud scheduler jobs pause refreshTiktokRatesForAllAccounts` (`--project crafted-dev-v1 --location us-central1`); (3) confirm with `gcloud scheduler jobs list --format='table(name,state)'` that exactly one job per platform is ENABLED; (4) the one-time manual prod run: `gcloud scheduler jobs run refresh-instagram-rates-prod` and `gcloud scheduler jobs run refresh-tiktok-rates-prod` (same `--project`/`--location`), then wait for completion and verify `status.code` 0 on both jobs, the `finished: processed=… failed=… ms=…` line in each function's log, and one creator's refreshed `updated`; expect every non-negotiated creator's rate to be recomputed mid-month (new proposals get the new rate, stored proposals keep their snapshot); (5) delete the two legacy jobs and `gcloud functions delete refreshInstagramRates` / `refreshTikTokRates` (authorized by OQ-4 after this successful run). Rollback between (1) and (5): pause the two `-prod` jobs, resume the two legacy jobs. The next scheduled prod run is 2026-11-01 on the new functions. A later deploy never changes any job's state (D18).


## Concrete Steps

All commands from the worktree root `/home/gustavo/dev/crafted/.worktrees/fix/ig-median-plays-refresh-crafted_cloud_functions` unless noted. Nothing below is run until implementation is authorized.

Regenerate a standalone lockfile (per function, after any dependency edit):

    rm -rf /tmp/rr-lock && cp -R functions/refresh-instagram-rates /tmp/rr-lock
    rm -rf /tmp/rr-lock/node_modules /tmp/rr-lock/package-lock.json
    (cd /tmp/rr-lock && npm install --package-lock-only)
    cp /tmp/rr-lock/package-lock.json functions/refresh-instagram-rates/package-lock.json

Local gates:

    npm ci
    npm run check:ci
    npm run typecheck
    npm run test:ci
    npm run build
    node --experimental-strip-types --test __tests__/legacySocialFunctions.test.ts

Credential-free deploy proof (per function):

    pack build refresh-instagram-rates-dryrun --path functions/refresh-instagram-rates \
      --builder gcr.io/buildpacks/builder:google-22 \
      --env GOOGLE_FUNCTION_TARGET=refresh-instagram-rates --env GOOGLE_RUNTIME=nodejs22 \
      --env GOOGLE_NODEJS_VERSION=22

Scheduler step as it runs inside the deploy job (shown for the IG dev job; `URI` is the function's `serviceConfig.uri`):

    JOB=refresh-instagram-rates-dev
    ARGS=(--project="$GCP_PROJECT" --location="$GCP_REGION" --schedule="0 1 1 * *" \
      --time-zone="America/Cancun" --uri="$URI" --http-method=POST \
      --oidc-service-account-email="$RATE_REFRESH_INVOKER_SA" --oidc-token-audience="$URI" \
      --attempt-deadline=1800s --max-retry-attempts=0)
    if gcloud scheduler jobs describe "$JOB" --project="$GCP_PROJECT" --location="$GCP_REGION" >/dev/null 2>&1; then
      gcloud scheduler jobs update http "$JOB" "${ARGS[@]}"
    else
      gcloud scheduler jobs create http "$JOB" "${ARGS[@]}"
    fi

Expected on first run: `Created job [projects/crafted-dev-v1/locations/us-central1/jobs/refresh-instagram-rates-dev].`; on later runs: `Updated job […]`. The job's `state` is untouched by `update`.


## Validation and Acceptance

1. `npm run typecheck` reports zero errors for three projects; `npm run build` emits `dist/index.js` for both new functions.
2. `npm run test:ci` passes; the IG suite fails if `median_plays` is dropped from the update or the formula constant changes; the TikTok suite fails if the `performance` object loses a key, if a page is not awaited before the response, or if more than five creators are in flight.
3. The legacy suite passes with its remaining eight cases and no reference to the deleted folders.
4. `pack build` exits 0 for both functions; the cold-start smoke gets a 405 from `GET /` on both.
5. On a PR: `quality`, 2× `cold-start-smoke`, 2× `build-preview` green; no deploy job ran.
6. On push to `dev`: `gcloud functions list --project crafted-dev-v1` shows `refresh-instagram-rates-dev` and `refresh-tiktok-rates-dev` with `--no-allow-unauthenticated` (`gcloud run services get-iam-policy` shows only the invoker SA as `roles/run.invoker`); `gcloud scheduler jobs list` shows both `-dev` jobs ENABLED with the invoker SA; an unauthenticated `curl -X POST <uri>` returns 403; a scoped authenticated POST with `?user_id=<run-tagged dev creator>` returns 200 and the creator's node shows the expected fields.
7. Prod cutover leaves exactly one ENABLED job per platform; the one-time manual prod run (D17) and then the 2026-11-01 scheduled run show `status.code` absent/0 on both new jobs and a `finished: processed=… ms=…` line in each function's log; the legacy jobs show no attempt after the cutover date. Re-running a deploy afterwards leaves every paused job paused (D18).


## Idempotence and Recovery

Every repo edit is additive except the M5 deletions (recoverable from git). `npm ci`, `npm run build`, `pack build` and both workflows are re-runnable; `gcloud functions deploy` updates in place; the Scheduler step is describe-then-update/create and never changes job state. A failed prod deploy keeps the last-good Cloud Run revision serving and the prod workflow re-pins traffic to it. Cutover rollback is two Scheduler commands (pause new, resume legacy) with no redeploy, valid until the legacy functions are deleted in retirement. If the Nov 1 legacy IG run precedes cutover (D4), recovery is the server backfill re-run. If OIDC job creation fails at M6's first dev deploy (org policy or missing `actAs`), the fallback is BD-1's public variant for dev only, reported to the user before staging.


## Artifacts and Notes

Required-check evidence, 2026-10-26, cloud-engineer, measured on tree `3c3757a` (the review fixes N1–N4 touch README/action text only; the code digest for every check below is `3c3757a`). Identity: Node v22.22.0, npm 10.9.4, TypeScript 5.9.3, Nx 22.7.7 with `NX_SKIP_NX_CACHE=true`, Biome 2.3.15, vitest 3.2.7; root install from the committed root lockfile; no `.env` inputs (the suites mock `lib/firebase`); no schema. All exit 0.

    root npm ci                                   4.5 s
    npm run check:ci                              2.9 s   (3 projects)
    npm run typecheck                             3.8 s   (3 projects)
    npm run test:ci                               4.0 s   IG 71 passed, TikTok 51 passed, creator-outreach 33 passed
    npm run build                                 2.9 s
    node --experimental-strip-types --test __tests__/legacySocialFunctions.test.ts
                                                  0.26 s  8/8 passed
    strict standalone tsc on the legacy suite     0.88 s
    cold-start smoke (dummy key, build, boot, GET /)   405 from both functions in ~1.0 s each
    standalone npm ci + gcp-build (scratch copy)  IG 3.6 s + 1.4 s; TikTok similar  (proves the nested lockfiles and tsc-at-deploy)
    actionlint 1.7.12 / shellcheck 0.11           clean on both workflows and the composite action
    fake-gcloud upsert harness                    absent → create; present → update; paused stays paused;
                                                  state flipped by update → re-paused and step fails; 0 `resume` calls

Mutation probes (each run once, each failing the named suite as expected): drop `median_plays` from the IG update → `instagram-rates.test.ts`; change the IG formula constant → IG `rates.test.ts`; change the TikTok formula → TikTok `rates.test.ts`; drop a `performance` key → `tiktok-rates.test.ts`; raise the TikTok in-flight CONCURRENCY above 5 → TikTok `handler.test.ts`; diverge one `social-errors.ts` copy → `helpers-identical.test.ts`.

Not run (and not claimed): `pack build` (runs in CI `build-preview` on the PR), the live workflows, any `gcloud` mutation, any deploy.

Read-only evidence gathered for this plan (2026-10-23): `gcloud functions describe` for both legacy functions and `gcloud scheduler jobs describe` for both jobs (values in Context); `gcloud logging read` on the two Cloud Run services for 2026-10-01T04:00–10:00Z — IG `status=200 latency=580.1s`, TikTok `status=500 latency=70.5s`; `gh variable list` / `gh secret list` / Environments for the repo.


## Interfaces and Dependencies

In `functions/refresh-instagram-rates/index.ts`:

    import * as functions from "@google-cloud/functions-framework";
    import { refreshInstagramRates } from "./function-handler";
    functions.http("refresh-instagram-rates", refreshInstagramRates);

In `functions/refresh-tiktok-rates/index.ts`:

    import * as functions from "@google-cloud/functions-framework";
    import { refreshTiktokRates } from "./function-handler";
    functions.http("refresh-tiktok-rates", refreshTiktokRates);

Shared-by-copy helper signatures (identical in both `lib/social-errors.ts`):

    export interface LastError { code: number | string; subcode?: number; message_key: string; at: string }
    export const metaMessageKey: (error: { code?: number; error_subcode?: number } | undefined) => string | null;
    export const tiktokMessageKey: (code: number | string | undefined) => string | null;
    export const lastErrorFor: (code: number | string, subcode: number | undefined, message_key: string) => LastError;

`lib/graph-host.ts` (IG only): `export const graphHostFor: (node?: { api_path?: string } | null) => "https://graph.instagram.com/v24.0" | "https://graph.facebook.com/v24.0"`.

`lib/rates.ts` (both): `export const median: (values: number[]) => number` (0 for empty); `export const instagramSuggestedRate: (medianPlays: number) => number` (`parseInt((medianPlays / 1000) * 2500)`); `export const tiktokSuggestedRate: (medianViews: number) => number` (`(medianViews / 1000) * 2500`).

Firebase paths written (unchanged): `users/{uid}/creator_socials/instagram` (`suggested_rate`, `median_plays`, `updated`, `last_error`) and `users/{uid}/creator_socials/tiktok` (`performance`, `updated`, `last_error`, `handle`).

Runtime dependencies per function: `@google-cloud/functions-framework ^3.0.0`, `@sentry/node ^7.112.2`, `cors ^2.8.5`, `dotenv ^16.0.0`, `firebase-admin ^9.9.0`. devDependencies: `typescript ^5.8.2`, `@types/node ^22.0.0`, `@types/cors ^2.8.17`, `vitest ^3.0.0`. Never `@crafted/shared-config`.

GitHub configuration: reused — `GCP_PROJECT`, `GCP_REGION`, `GCP_SA_KEY`, `SENTRY_DSN` (repo-level), `FIREBASE_SA_KEY` (per Environment), the `prod` required-reviewer gate. New — repo variable `RATE_REFRESH_INVOKER_SA`. GCP: new invoker SA; deploy SA additionally needs `roles/cloudscheduler.admin` (project) and `roles/iam.serviceAccountUser` (on the invoker SA).


## Risks

- **Double run or missed month at cutover.** Mitigated by the one-session recipe (deploy → pause legacy → verify one ENABLED job per platform), the "never on the 1st" rule, `--max-instances=1`, and zero Scheduler retries. A missed month is recoverable by hand only for IG via the backfill (rate from the stale month is still correct); a missed TikTok month simply waits for the next.
- **OIDC/IAM friction at first dev deploy** (org policy, missing `actAs`, Scheduler service agent). Mitigated by M0 being explicit and by BD-1's fallback.
- **Dev/staging vendor calls with real tokens** (OQ-1). Read-only quota use; BD-2 can pause staging.
- **Behavioural drift in transcription.** Mitigated by migrating #24's cases verbatim in intent (D6) and by the formula/field-shape tests; any discovered difference is reported, not absorbed.
- **Stacked-PR mechanics** (squash merges, base-branch deletion auto-closing the child). Mitigated by retargeting before #25's branch is deleted and rebasing after squash merges.
- **Legacy TikTok run fails again on Nov 1** (it did on Oct 1). Outside this plan's control; OQ-3.


## Open Questions

Answered by the user on 2026-10-26 except OQ-2.

- OQ-1 — Does `crafted-staging-v1` (and `crafted-dev-v1`) hold real creators' Instagram/TikTok tokens, so that an enabled monthly staging/dev refresh would call Meta and TikTok with real people's tokens? If yes, should the staging job (or both) be created paused (BD-2)? **Answer:** deploy to all stages like the creator-outreach workflows; jobs are created enabled everywhere; the user pauses the dev/staging jobs manually in the GCP console; the deploy must never resume a paused job (D18).
- OQ-2 — **Still open.** Who executes the one-time GCP steps in M0 (invoker SA, deploy-SA role grants, repo variable) and may they run before this PR merges, so the first dev deploy on merge succeeds? The user asked how this was handled before: for creator-outreach the operator (the user) ran the IAM grants, GitHub Environments and secrets by hand from the README deploy checklist. M0 stays operator-only pending the answer (BD-9).
- OQ-3 — The legacy TikTok job failed on 2026-10-01 and would run the same 2024 code on 2026-11-01; bridge-deploy #24's rewrite or accept a missed month? **Answer:** neither — ship this port (the proper fix) before Nov 1; the user deploys it; no bridge deploy. Cutover (pausing the legacy prod jobs) happens before Nov 1 so the legacy run does not occur (D17; supersedes D4).
- OQ-4 — Authorization to delete the legacy Scheduler jobs and functions after the first successful prod run, and who runs it. **Answer:** authorized after the first successful prod run; the user runs a one-time manual prod run on cutover day after merging, so everything updates, then retires the legacy jobs/functions. This explicitly overrides the earlier "never trigger the fixed refresh by hand" rule, once. Effect: every non-negotiated creator's `suggested_rate` is recomputed mid-month; new proposals get the new rate, existing proposals keep their snapshot (D17).
- OQ-5 — PR topology. **Answer:** third PR stacked on #25, already open as draft #28 (D12 amendment).
- OQ-6 — Invocation auth. **Answer:** private functions, Scheduler-only via OIDC (D19).
- OQ-7 — Sentry on handler failure. **Answer:** yes (D19).


---

Revision note 1 — 2026-10-23, tech-lead: authored against PR #25's head (`7c0d1a1`) after the baseline moved from `origin/dev`; the port preserves #24/#25's behaviour and cites `.agent/exec-plans/creator-onboarding-ig-login.md` for it. Plan only; no implementation, commit or cloud mutation.

Revision note 2 — 2026-10-26, tech-lead: recorded the user's answers to the Open Questions. D4 superseded by D17 (ship and cut over before 2026-11-01; one authorized manual prod run via `gcloud scheduler jobs run` on cutover day, overriding the "never by hand" rule once; mid-month rate recompute effect stated; legacy retirement authorized after that run). D18 (jobs created enabled in all stages, user pauses dev/staging in the console, deploy never resumes a paused job) amends D2 and replaces BD-2's alternative. D19 confirms BD-1 and BD-8. D12 amended: draft PR #28 exists; #24/#25 must merge before Nov 1 for the deadline, which is the user's call. Sections touched: authorization line, Progress (M0, M1, M9), Decision Log, Blocking decisions (BD-9 added for the still-open OQ-2), Non-Goals, M7, M9, Validation item 7, Open Questions. Implementation of M1–M7 is in progress in this worktree.

Revision note 3 — 2026-10-26, tech-lead: implementation landed (`0cd628e`…`95700e1`) and the combined review returned GO. Progress M1–M8 checked with commits; M9 lists its blockers. Decision Log: D11 amended (composite action `.github/actions/deploy-rate-refresh/action.yml`, PR-only cancel plus per-deploy concurrency groups); D20 (`?user_id` empty/repeated → 400), D21 (`scheduler jobs run` first, curl alternative with a plain identity token), D22 (identical header edit in the four legacy `graphHost.js`). Surprises: no protection rules on any GitHub Environment (repo public), legacy retirement irreversible from source, creator-outreach's workflow-level cancel recorded as debt, `--audiences` unusable for user accounts. Artifacts: check identities, durations, mutation probes and the not-run list. Outcomes written for M8 with the pending items before cutover.
