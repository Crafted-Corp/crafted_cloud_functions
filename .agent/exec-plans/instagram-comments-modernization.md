# Modernize daily Instagram comment synchronization


This ExecPlan is living guidance under `.agent/PLANS.md` and the canonical Crafted ExecPlan doctrine. Keep Progress, Surprises & Discoveries, Decision Log and Outcomes current. The original implementation and separately authorized production promotion have completed. The user authorized a compatibility correction and a new PR on 2026-11-12; deployment of that correction is a later operator step. The coordinator owns git, plan updates and live cloud operations; the cloud engineer owns implementation; the tech lead owns the single combined review.

## Purpose / Big Picture


Amplify campaign reporting should receive the complete available Instagram comments for submitted posts through a typed, independently deployable daily worker. It must work with both Facebook-connected Instagram credentials and Instagram Login credentials, preserve the existing client data shape, and never erase stored comments because Meta rejected a request. Developers gain tested source, isolated dev/staging/prod deployments and a daily private scheduler. After the authorized production cutover, the new daily schedule is enabled and the legacy schedule remains paused for rollback. The current correction preserves comments whose text is absent, allowing their post's other comments to synchronize.

## Progress


- [x] (2026-11-11) Read current cloud instructions, legacy worker, modern private rate workers and their deployment pipelines; scoped worktree `feature/instagram-comments-modernization-crafted_cloud_functions`, branch `feature/instagram-comments-modernization`, base `b07bb87`.
- [x] (2026-11-11) Coordinator identified the existing production-targeting legacy deployment and the authorized dev test campaign; recorded isolation and cutover constraints before implementation.
- [x] (2026-11-11) Implemented typed worker, complete comments pagination, compatible storage and failure preservation; added focused regressions. Preliminary development runs passed 29 tests and worker typecheck; final measured integrated gates remain below.
- [x] (2026-11-11) Added standalone build/workspace integration, private per-stage pipelines, daily scheduler lifecycle and durable operator instructions.
- [x] (2026-11-11) Final measured gates and the combined technical review passed; corrected one stale member-count sentence in canonical/generated guidance.
- [x] (2026-11-11) Published [cloud PR #32](https://github.com/Crafted-Corp/crafted_cloud_functions/pull/32) with reviewed implementation and pipeline changes.
- [x] (2026-11-11 19:07Z) Deployed private dev worker, enabled the daily OIDC scheduler, synchronized the authorized campaign and verified 11 persisted comments; legacy production function and scheduler metadata are unchanged.
- [x] (2026-11-11) Recorded rollout boundary: staging and production promotion are provided by the pipelines and remain operator steps, outside this live dev delivery.
- [x] (2026-11-11, subsequent authorization) Promoted production source `fd07037652a390924740ed730bb471e7b844b38a` through gcloud; enabled the new daily job and paused the legacy job.
- [x] (2026-11-12) Observed the natural production run read-only and reproduced the missing-text compatibility regression locally. The user authorized the correction; opened worktree `fix/instagram-comment-text-crafted_cloud_functions`, branch `fix/instagram-comment-text`, from `origin/dev` at `dc4d20d` because PR #32 has merged.
- [x] (2026-11-12) Preserved omitted comment text and added sanitized shape regressions. Both new acceptance regressions failed before the correction; all four final root checks passed afterward.
- [x] (2026-11-12) Combined technical review: GO, with no blocking code findings. Corrected two stale historical plan statements; executable evidence remains applicable.
- [ ] (2026-11-12) Publish the correction PR.

## Surprises & Discoveries


The 2026-11-12 natural production run completed HTTP200 with 124 Meta190 errors, 23 Meta100 errors and 12 malformed outcomes. The previous legacy run had the same aggregate provider-error counts. Approved read-only inspection of stored production comments found 39 objects without text across 22 posts. A local comparison confirmed that legacy code accepts this shape and the new collector rejects an entire post for it. These historical stored shapes do not prove the cause of all 12 current malformed responses. The client already excludes missing-text objects from sentiment analysis, so retaining them needs no frontend change.

`functions/processInstagramComments/instagram.js` already supports a `campaign_id` query and scans campaign records in pages of ten, but retrieves only the first Meta comments page and logs raw vendor error details. It writes the returned comment array directly to `influencer_campaigns/<campaign>/instagram_comments/<post>`. It does not reliably exclude non-Instagram posts before using their media IDs. The legacy deployment is hosted in `crafted-dev-v1` but selects production RTDB `crafted-v1`; hosting project names do not identify data environment. At initial inspection its scheduler was enabled at 06:00 America/New_York; the subsequent authorized cutover paused it. The reusable scheduler invoker exists and FIREBASE_SA_KEY is configured in each GitHub environment. The client flattenCampaignComments consumer accepts the flat comment array, which remains unchanged.

`functions/refresh-instagram-rates` and `functions/refresh-tiktok-rates` are the closest existing private scheduled templates. Their action caps instances/concurrency, grants one invoker service account, preserves paused scheduler state and supplies OIDC (a Google-signed identity token) with the function URL as audience. Their monthly cron and America/Cancun timezone are not the comments schedule. Their Firebase module defaults absent NODE_ENV to dev; this worker must instead reject absent/unknown environments.

## Decision Log


Decision (2026-11-12, coordinator): Make `Comment.text` optional and reject only a present non-string text value. Preserve the original object, its ID/timestamp and its peers; never synthesize empty text or discard the object. Keep optional username/timestamp validation and provider, pagination and write-failure behavior unchanged. The demonstrated compatibility defect is the authorized scope; no dependency, schedule, frontend or maintenance-folder change is needed.

Decision (2026-11-11, tech lead): Add `functions/process-instagram-comments` and its own deployment action/workflows; leave the legacy source/deployment and monthly worker behavior intact. This permits isolated dev delivery and safe gated production cutover without dual production writers.

Decision (2026-11-11, tech lead): Preserve the array of Meta comment objects at the existing per-post path; paginate every comments page before replacing that path once. Treat failed/malformed/incomplete fetches as failures, retaining the prior array. A verified successful empty collection may replace old comments with an empty array (Firebase may represent that as an absent node). Do not add wrapper metadata to the client-facing node.

Decision (2026-11-11, tech lead): Preserve daily `0 6 * * *` in `America/New_York` in every new environment, not a fixed UTC approximation. Routine deployment does not create a missing production scheduler; explicit cutover provisions it only after the legacy job is paused and drained. Deployment never resumes a previously paused job. Legacy production is paused only during a separately gated promotion after checks, then exactly one production schedule is enabled.

Decision (2026-11-11, tech lead): Use current credential state from `users/<creator>/creator_socials/instagram`, not the proposal snapshot. Exact `api_path === "instagram"` uses graph.instagram.com and instagram_user_id; absent/facebook path uses graph.facebook.com and instagram_business_account_id. Reject unknown nonempty api_path and missing/literal-null tokens rather than guessing credentials. Keep Graph v24.0 as the current checked-in host helper version.

## Outcomes & Retrospective


The original implementation, required verification, technical review and publication in cloud PR #32 completed, followed by separately authorized production promotion. The missing-text correction and its local required checks now pass; the combined technical review is GO and publication is pending. The legacy scheduler remains paused and available for rollback; its deletion condition has not been met. This correction uses local tests only and does not invoke production or deploy changes. No frontend, webhook, real-time comments, replies, other function modernization or maintenance-folder changes are included.

## Context and Orientation


Work on the correction only in `/home/gustavo/dev/crafted/.worktrees/fix/instagram-comment-text-crafted_cloud_functions`; the original branch is merged and frozen. The root npm workspace and Nx commands include creator-outreach, two rate workers and this comments worker. Each deployable directory has a standalone public-registry lockfile and self-contained tsconfig because Google uploads only that directory and runs `npm ci` plus `gcp-build`. Root dependencies/lockfile do not replace the nested deploy lock.

The legacy source is `functions/processInstagramComments/{index.js,instagram.js,graphHost.js}`. It reads campaign tasks/posts, then current creator socials and stores comments under campaign/post IDs. Modern examples are `functions/refresh-instagram-rates/{index.ts,function-handler.ts,lib/firebase.ts,lib/graph-host.ts,lib/social-errors.ts,lib/sentry.ts,package.json,tsconfig.json,biome.json,vitest.config.ts}`. `.github/actions/deploy-rate-refresh/action.yml` and `.github/workflows/rate-refresh-{build,deploy-prod}.yml` demonstrate private deploys and scheduler lifecycle. Creator-outreach is the shared tooling/buildpack reference; it is public and its public-invocation option must not be copied.

All environments host functions in GCP project `crafted-dev-v1`, region `us-central1`, with target `process-instagram-comments` and deployed names `process-instagram-comments-dev`, `-staging`, `-prod`. NODE_ENV selects the data project: dev `crafted-dev-v1` at `https://crafted-dev-v1-default-rtdb.firebaseio.com`; staging `crafted-staging-v1` at `https://crafted-staging-v1-default-rtdb.firebaseio.com`; prod `crafted-v1` at `https://crafted-v1.firebaseio.com`. The credential project_id must match that mapping before initialization. No credential fallback to the hosting project or production is allowed.

## Worker contract


The private HTTP entry point accepts POST. Other methods return 405 before database/network work; retain the CORS wrapper pattern without making the service publicly invokable. Absent `campaign_id` scans campaigns in ascending Firebase key pages of 100 using `orderByKey`, `limitToFirst` and `startAfter`; do not read the full campaign collection. A single valid campaign_id reads only that campaign and returns 404 if missing. Reject repeated/array/empty/path-invalid query identifiers with 400. POST without a body remains scheduler-compatible. Preserve useful legacy summary fields `campaigns`, `postsProcessed`, `commentsCollected`, `skipped`; add an explicit failed count so partial failure is observable rather than falsely reported as complete success.

Within a campaign, visit its tasks/posts in bounded work, skip non-Instagram posts, and retain compatibility for legacy posts with an absent platform only when their existing Instagram provenance is established from the record shape. Do not treat an explicitly TikTok post as Instagram. The implemented legacy predicate requires absent platform, a media_id, and an HTTPS instagram.com or www.instagram.com post link, in addition to a usable current Instagram social connection. Missing media_id, creator_id, account ID or token is a skip; corrupt structures are reported as sanitized failures. Read only the current creator's Instagram social node, never the entire users collection.

Use fixed Graph hosts chosen from stored api_path. Fetch `/<media_id>/comments` with the fields needed by existing client comment consumers, at minimum id/text/username/timestamp; preserve returned extra comment fields where compatible instead of dropping existing client data. Type raw vendor JSON as unknown and narrow it without any or double unknown casts. Request comments pages using vendor cursor values on the same fixed media endpoint; never send credentials to an arbitrary paging.next URL. Stop only on genuine vendor exhaustion. Detect repeated/malformed cursors and fail without writing a partial list. Deduplicate repeated comment IDs while retaining stable page order. Do not fetch replies or introduce sentiment processing.

Set an outbound timeout and retain sanitized failure categories/status/code/subcode. Handle Meta 190 and existing actionable 10/200 mapping explicitly; reuse the existing last_error mapping shape when recording an actionable credential error on the current social node, but do not alter identity, tokens or unrelated profile fields. Never log comment text, raw axios/fetch errors, URLs containing tokens, access tokens or credential JSON; sanitize before Sentry too. Failed vendor pages, malformed payloads, network timeout or Firebase failure must not overwrite prior comments. Only write after the complete successful collection. Continue other posts/campaigns after an individual failure. Fatal campaign-scan/configuration failure returns a generic 500 and sanitized diagnostics. A single-campaign response with failed posts must be visibly partial/failed in counts/message; it must not say every post synchronized successfully.

## Plan of Work


### Milestone 1 — Typed worker and compatible storage


The cloud engineer owns `functions/process-instagram-comments/**`, matching typed tests/fixtures, and the necessary root workspace/lock integration. Create `index.ts` registering exactly `process-instagram-comments`, a thin function-handler, and focused modules for environment/Firebase, scanning, Graph comment collection, types and sanitized errors. New code/tests/helpers are fully typed TS; configuration formats such as JSON/YAML remain ordinary configs. Use existing dependency versions and Node22 tooling rather than upgrading other workers. Add no new JS tooling helper; use supported configuration formats or TypeScript where a new executable helper is needed.

Read the server/client comment consumers to pin the persisted comment shape before changing projection. Add synthetic tests for both credential paths, single/full scan, all comments pages, explicit non-Instagram skipping, empty success, vendor190, timeouts/malformed pages, repeated cursor, per-post failure isolation and old-data retention. No test calls real Meta or production Firebase. A targeted local reproduction should demonstrate that a second comments page is retained by the new collector.

### Milestone 2 — Packaging and private daily delivery


The same builder owns root package.json/package-lock.json and only required Nx/workspace config, `.github/actions/deploy-instagram-comments/action.yml`, `.github/workflows/instagram-comments-build.yml`, `.github/workflows/instagram-comments-deploy-prod.yml`, README operational instructions and necessary CLAUDE/AGENTS inventory updates. Preserve unrelated edits. Do not modify monthly action behavior or maintenance/ files.

Register the workspace so root check/type/test/build includes the new worker. The function manifest has `main: dist/index.js`, self-contained tsconfig, public dependencies, standalone nested lockfile and gcp-build copying config assets into dist/config. It has no workspace dependency or prepare hook. Use Biome shared config only as root development tooling. Ensure copied config credentials stay ignored.

PR CI runs quality, tests/types, standalone buildpack preview without cloud credentials and compiled cold-start smoke with a generated dummy dev key. Smoke must assert the exact 405 status without database reads, not merely any HTTP response. Dev deploys only from dev, staging only from main; PRs never deploy. Production uses manual workflow_dispatch for a selected reviewed SHA and the existing prod GitHub Environment branch protection. The coordinator confirmed no required reviewer is currently configured; do not claim an approval gate exists. Document adding required reviewers as an operator prerequisite if that protection is desired, without silently changing environment settings. Preserve deploy concurrency and do not cancel in-progress deployment runs.

Use a dedicated composite action rather than changing monthly cron logic. Deploy private Gen2 nodejs22 with one instance, concurrency one, 1 CPU/2Gi and timeout1800s as the closest scheduled reference. Grant only the selected invoker service account. Scheduler sends POST with OIDC audience equal to the described service URI, schedule `0 6 * * *`, timezone America/New_York, attempt deadline1800s and zero automatic retries. Reconcile existing jobs only after successful reads; distinguish NOT_FOUND from permission/network failure. Preserve PAUSED state on every update. For a missing production job, do not create it during routine deployment. Report that the production scheduler awaits explicit cutover provisioning; the operator pauses and drains the legacy job before creating/enabling its replacement. This avoids a create-then-pause race that could briefly activate a second production writer. Never resume jobs in a routine deploy.

Use repo variables GCP_PROJECT/GCP_REGION and the existing RATE_REFRESH_INVOKER_SA, confirmed as `rate-refresh-invoker@crafted-dev-v1.iam.gserviceaccount.com` (reuse that identity for the separate comments action); repo secrets GCP_SA_KEY and SENTRY_DSN, environment secrets FIREBASE_SA_KEY for dev/staging/prod. Document exact prerequisites and service-account permissions using existing private worker setup. Do not print secret values. Any project_id mismatch or invalid environment fails deployment/runtime closed.

### Milestone 3 — Verification, review and authorized dev synchronization


Run final checks on frozen source, review the complete worker/pipeline/doc diff once, and update this plan with evidence. The coordinator handles commits/push/PR, dev deployment and live scheduler provisioning. Stage/prod remain pipeline promotion work. No review agent chain, product validation or audit is automatically required.

Before dev deployment, the coordinator records the legacy production job/function identity and schedule read-only, then confirms new function NODE_ENV/key project/RTDB all target dev. Verify unauthenticated invocation is rejected and authenticated POST can reach the worker. Create/update the dev daily scheduler and inspect its timezone, cron, URI, invoker and audience. Preserve any deliberately paused preexisting job; do not resume it silently.

Invoke exactly the authorized dev campaign `-P665xxFNjQOCZOam2xP`, owned by brand `-P665JW8orO3_IndWyrL`; expected task `-P665xxFNjQOCZOam2xQ`, post `-P66EKcLv4OSiM29pqR-`, media `18047939894428580`, creator `kz0w8rkuy5gytCGVpho5xwOfBEh1` using Instagram Login. Public reference is reel `DKkBhvCsZKf`. Re-read those relationships before writing. Invoke the private dev URL with `?campaign_id=<id>` and an appropriate identity token; never invoke the legacy production function for this test. Verify the resulting per-post node's count and field shape without printing comment text or secrets. A zero-comment Meta response is a valid result, but report zero honestly rather than inventing data. Record any credential/permission limitation and retain previous data on failure.

## Concrete Steps


For the compatibility correction, change only `functions/process-instagram-comments/lib/comments.ts` and typed regression tests/fixtures under its `__tests__/`. A mixed collection containing an ID/timestamp-only comment must be stored unchanged, including all valid peers. Present non-string text must still reject the collection and leave old stored comments intact. Run the four root checks below on Node22 and record durations. Packaging dependencies, manifests and workflows are unchanged; no live production test or new deployment is part of this correction.

From the isolated cloud worktree, use Node22 and matched dependencies; serialize lockfile/install changes. Run the root commands after adding the workspace:

    npm ci --no-audit
    npm run check:ci
    npm run typecheck
    npm run test:ci
    npm run build

Also verify the nested function lock independently in a temporary deployment copy containing only `functions/process-instagram-comments`, using `npm ci --no-audit` and `npm run gcp-build`. Generate a dummy RSA dev key privately, build it into dist/config, start functions-framework with NODE_ENV=dev and target process-instagram-comments, and assert GET returns405. No real credential is needed for this smoke. Run the workflow's exact `pack build` preview if the required Docker/buildpack tools are available; if not, record the missing local coverage and rely on the actual credential-free PR job before treating packaging as verified. Validate workflow/action YAML and exercise scheduler command generation with fake gcloud output covering missing, enabled, paused and permission-failure states. Use the repository's actual script names; record measured commands rather than inventing passing checks.

## Validation and Acceptance


The new tests must prove the stored client contract, both Graph hosts/account identifiers, multi-page comment completeness, no duplicate IDs, full-scan campaign pagination, scoped single-campaign reads and 400/404/405 behavior. A page-two error, token190, timeout, bad cursor or malformed payload leaves an existing comments node byte-equivalent; a later healthy post still synchronizes. Unknown/missing NODE_ENV and mismatched key project fail before DB use. No logs/Sentry event include synthetic tokens, raw vendor URLs or comment text in failure tests.

CI must prove standalone dependency/build compatibility and exact target cold start. Deployment contract tests prove daily New_York schedule, OIDC URL audience, no public invocation grant, no production job creation/activation at first deploy, paused-state preservation and no scheduler creation on permission failure. Dev acceptance is a private deployed function, inspected daily scheduler, and a scoped invocation whose persisted post comments match the successful fetch count. Production remains untouched until its gated cutover.

## Idempotence and Recovery


Repeated successful synchronization replaces only the same per-post comment array. It does not duplicate comments or modify campaign analytics/tasks. Failure never clears good data. If dev synchronization fails, preserve prior node contents and retry only after fixing the identified cause; do not bypass credentials with production keys.

At production promotion, inspect both legacy and new schedules, pause the legacy production scheduler, verify it is paused and no run is still executing, then enable only the reviewed new production job at the same daily cron/timezone. This cutover is not part of current live authorization. Keep the legacy deployment for rollback; pause the new scheduler before resuming the old one, ensuring they never run together. Ordinary deploys preserve operator pause state. README contains durable cutover/rollback commands with environment placeholders, not this PR's temporary status or test IDs.

## Artifacts and Notes


Original implementation and live evidence follow below. Correction evidence is in the private workspace directory `.agent-runtime/comments-text-fix-20261112/`, outside the repo. Never commit raw credentials, vendor tokens or comment content. Read-only production observation and approved stored-shape inspection are distinct from forbidden production invocation/testing.

The correction's final executable input digest is `d181a3bf4b78407e99b4b88635575e2576adb3219f41ad50faa787a563053ae0`, covering tracked and untracked non-Markdown inputs; Markdown does not feed these commands. Node v22.22.0 and npm10.9.4 used a fresh isolated `npm ci` (16.19s), with unchanged root lock `16c74bd5faf6cf23ad3623302f0ec7e11fb9f54ebb41f7004f2c8a5e4aa5f5b9` and nested lock `d76fd6ca23eec199f98a348eacd952ff4a39cf01bfe72fae061230f4e6c43371`. Environment fingerprint is `a28b3b9c7f25b21ea851e6a88039bec00696f51ac8943ac0211481698274ff7a`; no dotenv/credentials were copied and Firebase/HTTP use local doubles, so no schema identity applies. Nx cache was disabled.

With the new tests and original collector, `npm run test:ci -w process-instagram-comments -- __tests__/comments.test.ts` failed the two missing-text acceptance cases while 19 others passed (1.62s). After correction, `npm run check:ci` passed in 5.121s, `npm run typecheck` in 5.977s, `npm run test:ci` in 6.257s (17 suites/213 tests, including 2 suites/36 comments tests), and `npm run build` in 6.304s. `checks.json` and adjacent logs record command/cwd, timestamps, identities and exit status. Standalone/buildpack/scheduler checks were not repeated because their inputs are unchanged; their original evidence does not claim an execution of the corrected buildpack image. No live verification or deployment of this correction has run.

## Interfaces and Dependencies


Use functions-framework HttpFunction, Firebase Admin SDK, existing Sentry major and a typed HTTP client supported by Node22/current dependencies. Define explicit Campaign/Task/Post, InstagramConnection, Comment and run-summary shapes; narrow unknown RTDB/Graph values at boundaries. `Comment.text` is optional; when present it must be a string. Export plain functions for scanner/collector/processing seams to enable deterministic tests. Comment storage remains `influencer_campaigns/<campaign_id>/instagram_comments/<post_id>` with the legacy array shape. The function target, manifest/start command and gcloud entry-point all equal `process-instagram-comments`; only deployed function/scheduler names receive the environment suffix.

## Revision note — 2026-11-11


Created the self-contained delivery plan from the current private scheduled workers and legacy comment processor. Pinned environment isolation, complete pagination, compatible storage, failure safety, private daily scheduling and gated production cutover; authorized only dev deployment/synchronization in the live phase.

## Revision note — runtime milestone, 2026-11-11

Created the typed package and workspace/standalone locks. Development checks used Node v22.22.0: `npm run typecheck -w process-instagram-comments` passed and `npm run test:ci -w process-instagram-comments` reported 2 suites/29 passing tests (Vitest reported 443ms; wall time was not measured). These preliminary observations are not the final measured evidence. Pipeline, packaging, documentation and final checks are in progress.

## Final implementation evidence — 2026-11-11


Final executable/pipeline digest `d7f60b2bfb3e2e81f932dd65dbd72f03cdb722e1ea2623d6ba9015849695231f`; Node v22.23.4; isolated root dependency lock SHA-256 `16c74bd5faf6cf23ad3623302f0ec7e11fb9f54ebb41f7004f2c8a5e4aa5f5b9`. Artifacts are outside git in `.agent-runtime/comments-modernization-20261111/`. Tests use Firebase doubles; standalone cold start uses a generated dummy dev key and performs no live database work.

`npm run check:ci` passed in 4.625s; `npm run typecheck` passed in 6.565s; `npm run test:ci` passed in 7.027s (17 suites, 206 tests across four workers; new worker 29 tests); `npm run build` passed in 5.326s. Standalone deployment-copy `npm ci` passed in 2.824s, `npm run gcp-build` passed in 1.455s, and compiled functions-framework GET returned exactly405 in the 289ms cold-start probe. Actual scheduler shell tests passed enabled, paused, missing-dev, missing-prod and permission-denied scenarios (20/24/23/14/14ms). All three new workflow/action YAML files parsed and diff whitespace passed.

The exact CI `pack build process-instagram-comments-dryrun --path functions/process-instagram-comments --builder gcr.io/buildpacks/builder:google-22 --env GOOGLE_FUNCTION_TARGET=process-instagram-comments --env GOOGLE_RUNTIME=nodejs22 --env GOOGLE_NODEJS_VERSION=22` passed in 119.264s using pack0.40.8 and Docker29.9.2, producing image `d14128c7e426`. Standalone lock SHA-256 `d76fd6ca23eec199f98a348eacd952ff4a39cf01bfe72fae061230f4e6c43371`. No cloud credentials were supplied. Runtime/package source was frozen throughout.

Final combined technical review: GO, no blocking findings. The only correction was changing the documented workspace count from three to four and regenerating AGENTS.md; executable evidence remains applicable. Live deployment and persisted comment counts must be recorded separately below.

## Revision note — delivery checks, 2026-11-11


Updated Progress and Outcomes for the completed typed worker, per-stage daily pipelines, standalone packaging checks and final technical review. Dev rollout and scoped synchronization remain the authorized next milestone; staging/production promotion are not claimed.

## Live dev deployment and sync — 2026-11-11


Reviewed runtime commit `9ea99f2dc0ee60190815bd5131aedf4a59e160d7` is deployed as `process-instagram-comments-dev` in `crafted-dev-v1/us-central1`, Node22, private Gen2, one instance/concurrency one, 1CPU/2Gi, timeout1800s. The deployment command mirrors the checked-in composite action and passed in 77.485s. The materialized credential project was asserted as crafted-dev-v1, NODE_ENV=dev, with the existing dev worker's monitoring configuration. Secret values remain private; deployment artifacts contain only safe identities/fingerprints.

Scheduler `process-instagram-comments-dev` is ENABLED at `0 6 * * *`, America/New_York. It sends POST to the new dev service URI, with OIDC audience matching the service URI and the existing rate-refresh-invoker identity. IAM inspection confirmed no allUsers/allAuthenticatedUsers grant. Scheduler provisioning/verification passed in 14.161s. The future scheduled tick has not been observed; the authenticated scoped invocation below establishes worker behavior independently.

The coordinator re-read the authorized campaign/brand/task/post/creator relationships and backed up only its comment node privately before calling the worker. Unauthenticated GET returned403, authenticated GET returned405, and authenticated POST with the campaign_id query returned200 in the 1.150s scoped run: campaigns=1, postsProcessed=1, commentsCollected=11, skipped=0, failed=0. Read-back verified 11 comment objects with the expected id/text shape at the existing per-post node. No comment text, credentials or tokens appear in the sanitized evidence. No emails or campaign metrics were changed by this comments-only invocation.

Artifacts: `.agent-runtime/instagram-comments-modernization-20261111/{dev-deploy.json,dev-scheduler.json,dev-sync.json,production-topology-unchanged.json}`. Before/after metadata comparisons confirmed the legacy production function and enabled daily job unchanged. No production invocation or Firebase testing occurred. PR CI at the reviewed runtime commit showed all quality, cold-start and build-preview checks successful; feature-branch deploy jobs were correctly skipped. This documentation-only completion commit does not change the reviewed/deployed runtime.

## Revision note — live completion, 2026-11-11


Recorded PR publication, measured private dev deployment, authenticated daily scheduler and successful scoped 11-comment synchronization. Updated Outcomes and the exact legacy-post predicate. Explicitly retained unperformed staging/production promotion and first scheduled tick as live-verification boundaries.

## Revision note — compatibility correction, 2026-11-12


Recorded subsequent authorized production cutover, the observed natural run and the approved missing-text correction. Updated the current worktree, Progress, Surprises, Decision Log, Outcomes, correction steps and Comment contract. Recorded the correction's measured checks and combined technical review GO. Historical delivery evidence above remains evidence for its original source; production behavior after deployment remains unverified.
