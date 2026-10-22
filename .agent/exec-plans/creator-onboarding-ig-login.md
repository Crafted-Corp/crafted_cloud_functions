# Creator onboarding, semi-public brief pages and Instagram Login — cloud functions

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`.agent/PLANS.md` in this repository points to the canonical doctrine in the crafted plugin (`skills/exec-plan/references/PLANS.md`); this document is maintained in accordance with it.

This is one of three companion plans built from the FINAL TRD `trds/TRD-creator-onboarding-ig-login.md` (v1.1, 2026-10-15; `trds/` sits at the workspace root `/home/gustavo/dev/crafted/`, outside every repo). The TRD is authoritative for *what*; this plan is authoritative only for *how* in `crafted_cloud_functions/`. The server plan, `server/.agent/exec-plans/creator-onboarding-ig-login.md` (worktree `/home/gustavo/dev/crafted/.worktrees/feature/creator-onboarding-ig-login-server`), owns **every shared contract**, including the Firebase fields these functions read and write; this plan links to it and edits nothing outside this repository. The client plan, `client/.agent/exec-plans/creator-onboarding-ig-login.md`, owns the browser; nothing here is reachable from it.

Worktree: `/home/gustavo/dev/crafted/.worktrees/feature/creator-onboarding-ig-login-crafted_cloud_functions`, branch `feature/creator-onboarding-ig-login`, cut from `origin/dev` at `2c5193d`. All edits happen there; never on `dev` or `main`. `wt-new` does not cover this repository, so the worktree was created manually; each legacy function has its own `node_modules` (`cd functions/<name> && npm install`).

Authorization state: **implementation authorized on 2026-10-15.** Functions PR A is in progress; deployment and P5 secret rotation remain operator-only. Implementation is delegated to `crafted:cloud-engineer` under the delivery pipeline, with one tech-lead review of the combined diff across the three repos per PR. The cloud engineer also owns the operator steps this plan names (secret rotation, function env, deploys), each run only when the user authorizes it.


## Purpose / Big Picture

Three scheduled Google Cloud Functions keep a creator's social data fresh, and two of them are broken in ways the creator-facing Settings rate module and the reconnect bars will expose the moment they ship. `refreshTikTokRates` only processes creators who already have a `creator_socials/tiktok/performance/suggestedRate` (`functions/refreshTikTokRates/influencer.js:14-17`), so a creator who connected TikTok last month and never got a first rate never will; it also answers 200 before its per-user work finishes. `refreshTokens` refreshes TikTok access tokens but never persists the rotated `refresh_token` TikTok hands back, so the next refresh fails, and it carries the TikTok client key and secret as committed literals (`refreshTokens/influencer.js:44-45`). No function records *why* a token failed, so the browser has nothing to show a creator whose Instagram or TikTok connection has silently died. And every Instagram call is hard-wired to `graph.facebook.com`, which an Instagram-Login token (server M5) cannot use.

After this plan, against the dev data project:

- A run-tagged dev creator with a TikTok `access_token` and no `performance` node gets `performance.suggestedRate`, `performance.followerCount`, `updated` and `last_error: null` after one call to `refreshTiktokRatesForAllAccounts?user_id=<uid>`, and the HTTP response arrives after the writes, not before.
- `refreshTiktokAccessTokens?user_id=<uid>` writes a new `access_token`, the rotated `refresh_token`, both expiry dates and `last_error: null`; a forced `invalid_grant` writes `last_error: { code: "invalid_grant", message_key: "tt_invalid_grant", at }` and nothing else; the client key and secret come from the function env.
- A creator whose `creator_socials/instagram/api_path` is `"instagram"` has every Instagram call (rates, demographics, comments, campaign analytics) made against `graph.instagram.com/v24.0`, and an Instagram-path token within 30 days of `access_token_expires_at` is refreshed by `refreshTiktokAccessTokens`'s Instagram half; a creator with no `api_path` is untouched (`graph.facebook.com`).
- A Meta 190 / 10 / 200 on `refreshInstagramRates` writes `creator_socials/instagram/last_error` with the right `message_key`; a 4 / 17 / 32 is logged and writes nothing.

How to see each working is in `Validation and Acceptance`.


## Non-Goals

- No TypeScript port of the legacy functions (T13 / OQ-F1); every edit is in place in the existing `.js` files, with only the user-approved copied `socialErrors.js` / `graphHost.js` exception (each at most approximately 20 lines). New regression tests are fully typed TypeScript and run with Node type stripping; no TS port or new dependency is introduced.
- No Supabase read or write from any function (TRD §3.2 rule 2): `grep -rn "@supabase\|SUPABASE_" functions/` stays empty.
- No rate-limit backoff for Meta codes 4 / 17 / 32 (T17): logged, retried by the next scheduled run, never a `last_error`.
- No change to schedules, triggers, regions or the `PRODEV` key-file mechanism; no change to `creator-outreach`.
- No Instagram-login backfill, no `api_path` write by a function (the server's connect paths own it; absent means `"facebook"`).
- No change to the rate formulas themselves (Decision 1 / 2 keep the stored suggested rates as they are computed today).
- No deletion of the Facebook-host code path: it remains the live path for every Facebook-path creator (D-LEGACY-FB).
- No run against the prod data project from an agent. Do not invoke the dev-hosted `refreshAllCampaignAnalytics` or `updateInstagramDemographics` deployments while they target production, regardless of query scope. Operator validation requires an explicitly verified permitted data target.

What goes wrong if someone helpfully does one anyway: a function writing `api_path` would route a Facebook-issued token at `graph.instagram.com`, where every call fails and the creator gets a reconnect bar they cannot clear without the flag; a backoff loop inside a scheduled function extends its runtime past the execution limit and drops the rest of the batch.


## The cross-repo contract

### Rollout contract update — 2026-10-22

The authoritative shared contract is revision 8, `## The cross-repo contract` in `/home/gustavo/dev/crafted/.worktrees/feature/creator-onboarding-ig-login-server/.agent/exec-plans/creator-onboarding-ig-login.md`. Read its environment-wide rollout amendment before M-Rollout. Other server stack plans carry the same amendment. Gustavo's request to feature-flag the entire experience supersedes earlier unflagged scope; earlier enabled behavior remains decided. Master flags are `ENABLE_CREATOR_ONBOARDING` / `REACT_APP_ENABLE_CREATOR_ONBOARDING`, exact `true`, default off; effective Instagram Login requires master AND its existing flag. This is environment-level exposure, not cohorts. Legacy experience, Supabase-first identity persistence, atomic/snapshot/security invariants and background maintenance remain as specified there. No deployment is authorized by this amendment.


[Authoritative contract](server/.agent/exec-plans/creator-onboarding-ig-login.md#the-cross-repo-contract) — in the server repository at `server/.agent/exec-plans/creator-onboarding-ig-login.md` (while the branches are unmerged: `/home/gustavo/dev/crafted/.worktrees/feature/creator-onboarding-ig-login-server/.agent/exec-plans/creator-onboarding-ig-login.md`), section `The cross-repo contract`, **revision 2 (2026-10-15)**, subsection *Firebase fields shared with the cloud functions*. This plan relies on: `users/{uid}/creator_socials/instagram/api_path` (`"facebook"` | `"instagram"`, absent = Facebook) selecting `graph.facebook.com/v24.0` vs `graph.instagram.com/v24.0`; `users/{uid}/creator_socials/instagram/{instagram_user_id, access_token_expires_at}` written by the server's Instagram Login path; the `last_error` shape `{ code, subcode?, message_key, at } | null` and its `message_key` catalogue (`ig_190_460`, `ig_190_463`, `ig_190_467`, `ig_190_458`, `ig_190_459`, `ig_190`, `ig_102`, `ig_10`, `ig_200`, `tt_2190002`, `tt_2190003`, `tt_2190008`, `tt_10010`, `tt_invalid_grant`); the rule that every successful connect or refresh writes `last_error: null`; `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` as the function env names; and the deploy order (functions first in each environment, before the server, because an absent `api_path` means the Facebook host). A change there stops M3-fn or M5-fn until these fields are re-checked.


## Progress

- [x] (2026-10-22) Recorded the user-authorized environment-wide rollout amendment and branch ownership before implementation.
- [x] (2026-10-22) M-Rollout functions boundary: documented the server/browser experience flags and unconditional scheduled upkeep; existing handlers need no runtime flag or production changes.
- [x] (2026-10-22) M-Rollout cloud boundary: static inventory and the cloud-only portion of the single combined tech-lead review closed without blockers; no runtime changes or suite reruns needed.
- [ ] M-Rollout: root publication and the whole-feature runtime review remain pending; no merge or deployment.


- [x] (2026-10-20) Replaced the README delivery narrative with durable operating/configuration/deployment/verification/rollback guidance for all six scheduled social functions; relocated the five-test suite byte-identically to `__tests__/legacySocialFunctions.test.ts`. New-path verification and targeted review are recorded below.

- [x] (2026-10-15) TRD v1.0 FINAL read in full; the function facts the TRD cites re-verified in this worktree at `2c5193d` (see `Surprises & Discoveries`).
- [x] (2026-10-15) Plan authored; awaiting user review. M0 (the N18 hotfix) is being implemented in the client worktree by a frontend engineer and touches nothing here.
- [x] (2026-10-15) Before the first edit: `git fetch origin`, `git ls-remote --heads origin feature/creator-onboarding-ig-login`, `gh pr list --state all --head feature/creator-onboarding-ig-login`; `gcloud functions describe` for each of the six functions in the dev data project to record region, entry point, runtime and env (names only), since the legacy deploy procedure is not documented in this repository (see `Surprises & Discoveries`).
- [ ] P5 (operator, user-authorized) — rotate the committed TikTok client secret in the TikTok developer console; set `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` on the `refreshTiktokAccessTokens` function env per data project. The old secret is dead the moment the new one is issued, so this step and the M3-fn deploy of `refreshTokens` happen in one sitting.
- [x] (2026-10-15) P13 (OS2 probe) — count dev creators with `creator_socials/tiktok/access_token` present (read-only shallow scan); record the number as the batch-size basis.
- [x] (2026-10-15) P9 — confirm the deployed `updateInstagramDemographics` matches the code (no hardcoded uid gate): `gcloud functions describe` + a diff of the deployed source against `functions/updateInstagramDemographics/`.
- [x] (2026-10-15) M3-fn.1 code — `refreshTokens/influencer.js`: env-sourced TikTok credentials; persist the rotated `refresh_token` plus both expiries and `last_error: null` in one `.update()`; `last_error` on `invalid_grant` / `10010`; `?user_id=` scope.
- [x] (2026-10-15) M3-fn.2 code — `refreshTikTokRates/influencer.js` rewrite in place: key-batched scan of `users` (the `refreshTokens` pattern), select by `creator_socials/tiktok/access_token`, skip `negotiated`, per-user try/catch, await every batch before responding, write `performance` + `updated` + `last_error: null`, `last_error` on 2190008 / 2190002 / 2190003 / 10010; `?user_id=` scope.
- [x] (2026-10-15) M3-fn.3 code — `refreshInstagramRates/instagram.js`: `last_error` on 190 / 102 / 10 / 200 and `null` on success; 4 / 17 / 32 logged only (T17). (Host routing is M5-fn.)
- [x] (2026-10-15) Functions PR A combined technical review: GO after targeted plan guard corrections; implementation/test identities match recorded successful checks. Real-vendor verification remains an operator gate.
- [x] (2026-10-15) Functions PR A opened against `dev`: https://github.com/Crafted-Corp/crafted_cloud_functions/pull/24. Combined technical review GO; deterministic and dev-storage evidence recorded.
- [ ] Functions PR A operator gates: real-vendor F-FN after P5; separately authorized deployment to dev, then staging, then prod, each before the matching server deploy.
- [ ] M5-fn.1 — a shared host-selection helper copied into each function folder (see D2): `graphHostFor(instagramNode)`; `refreshInstagramRates/instagram.js:159, :188`, `updateInstagramDemographics/instagram.js:40-43`, `processInstagramComments/instagram.js:49`, `refreshAllCampaignAnalytics/utils.js:402` build their URLs from it.
- [ ] M5-fn.2 — `refreshTokens/influencer.js` gains the Instagram half: for `api_path === "instagram"` with `access_token_expires_at` within 30 days, `GET {IG host}/refresh_access_token?grant_type=ig_refresh_token&access_token=…`, writing `access_token`, `access_token_expires_at`, `last_error: null`; 190 → `last_error`.
- [ ] Functions PR B (M5-fn) against `dev` from a fresh worktree off the merged base; deploy before server PR B in each environment; `refreshAllCampaignAnalytics` last, after a `campaign_id`-scoped dry run.
- [ ] Outcomes & Retrospective written at the end of each PR.


## Surprises & Discoveries

- Review correction (2026-10-22): the shared rollout matrix had implied blanket legacy-client compatibility with any enabled server. Revision 8 distinguishes soft enforcement from strict activation; the matrix below now preserves that distinction without adding caller headers or weakening enforcement. This is documentation correction only.

- Observation (2026-10-22): bounded source inventory confirms that the six scheduled social services consume no master or Instagram Login experience flag. Their existing registration, credential checks and social-node conditions already keep background upkeep independent of experience rollout. No runtime modification is needed for this branch’s M-Rollout responsibility.

2026-10-22: Source comparison shows this is not navigation-only: Settings, signup/address forms and proposal composers were replaced, while public Amplify briefs, Home and Apply/Manage routes already existed. Restoring supported flag-off behavior requires explicit adapters. Strict proposal schemas are module constants, so flagging only the rule-phase value would leave legacy requests rejected. Identity persistence and social/security maintenance cannot be reverted with presentation.


- Observation (2026-10-20): the README embedded temporary PR/deploy stages and dated runtime/schedule observations as operating instructions, and maintained regression coverage was under the one-off `maintenance/` directory. The user requested durable guidance and a root `__tests__/` home. Source inventory confirms only the three token/rate handlers have user_id scope on this branch, both campaign jobs already accept campaign_id, and demographics is unscoped.

- Observation: the TRD's F-FN row and §5.6 ask for `user_id`-scoped dry runs of every function, including `refreshAllCampaignAnalytics`. Only `refreshInstagramRates` reads `req.query.user_id` (`instagram.js:59-60`); `refreshAllCampaignAnalytics` scopes by `req.query.campaign_id` (`campaign.js:16-18`); `refreshTokens`, `refreshTikTokRates`, `updateInstagramDemographics` and `processInstagramComments` accept no scope at all. A dry run as the TRD words it cannot be made on four of the six.
  Evidence: `grep -n "user_id\|campaign_id" functions/*/{influencer,instagram,campaign,utils}.js` → hits only in `refreshInstagramRates/instagram.js:59-60` and `refreshAllCampaignAnalytics/campaign.js:16`.
  Consequence: Decision Log D1 — the two TikTok functions and `updateInstagramDemographics` gain a `?user_id=` scope as part of their edits (a few lines each, in place); `processInstagramComments` and `refreshAllCampaignAnalytics` are scoped by `?campaign_id=` (the latter already is; the former iterates campaigns, so the same key fits). Reported to the user with this plan; not a TRD edit.
- Observation: the legacy functions' deploy procedure is not documented anywhere in this repository. `README.md` and `CLAUDE.md` document only `creator-outreach`'s Gen2 deploy (`gcloud functions deploy creator-outreach-dev …`, `README.md:302`); the legacy functions select their Firebase project through `process.env.PRODEV` (a path to a key file) and are deployed by hand. The deployed name, region, generation, runtime and env of each legacy function are therefore unknown until read from GCP.
  Evidence: `grep -rn "gcloud functions deploy" README.md CLAUDE.md releases` → only `creator-outreach`.
  Consequence: the first task of M3-fn is `gcloud functions describe` per function per data project, recorded (names only, no values) under `Artifacts and Notes`; the deploy commands in `Concrete Steps` are written against those facts once known, and the README gains a *Legacy function deploy* section so the next person does not rediscover it (D3).
- Observation: `refreshInstagramRates` already scans `users` in key batches of 100 with a per-user try/catch and `?user_id=` (`instagram.js:7-8, 59-60, 128-139`); `refreshTokens` already batches by key (`influencer.js:15-31`) — so the TRD's "as `refreshTokens` does" pattern for the TikTok rate rewrite has two in-repo precedents, and the better one is `refreshInstagramRates` (it also awaits the batch before responding).
- Observation: the three Instagram data functions still hard-code `https://graph.facebook.com/v24.0/…` as string literals rather than reading an env URL (`refreshInstagramRates/instagram.js:159`, `updateInstagramDemographics/instagram.js:40-43`, `processInstagramComments/instagram.js:49`, `refreshAllCampaignAnalytics/utils.js:402`), unlike the server, which reads `FACEBOOK_GRAPH_API_URL`. The host helper (D2) is the first place the host is a value.


- Observation (2026-10-15): the dev-hosted demographics bundle targets production too, beyond the TRD's analytics warning. P9 source inspection found `PRODEV` selects `firebase_connect`, the bundled key's `project_id` is `crafted-v1`, and byte-identical `firebase_connect.js` uses the production database URL. No deployed function was invoked and no production database read occurred. Reported to the orchestrator; README prohibits dev execution against that bundle. This does not widen PR A's code scope.
- Observation: deployed names are folder names, while entry points use the longer handler names. All six are Gen2/us-central1; Instagram rates is nodejs22 and the others are nodejs20. The default gcloud project is unset; every live read used `--project=crafted-dev-v1`. The plan's `.keys()` gcloud formatter is unsupported; metadata JSON was sanitized in memory to env names only.


## Decision Log

Decision D-ROLLOUT (2026-10-22, Gustavo authorization; Tech Lead implementation boundary): add environment-level default-off master flags, subordinate Instagram flags, and supported legacy presentation/compatible shared routes. Retain Supabase-first/additive schema, atomic writes/full snapshots/R4, security hardening and unconditional scheduled maintenance. No cohort service. This supersedes earlier assumptions that the entire non-Instagram experience ships enabled; it does not reopen enabled product decisions. Existing worktrees/PRs are reused and common changes are propagated forward through their stacks.

Functions execution of D-ROLLOUT (2026-10-22, Cloud Engineer): preserve all scheduled handlers, registrations, credentials, scopes and tests unchanged. The README identifies the master/subordinate flags as server/browser exposure controls, not worker configuration. Existing social connections and their token/rate/error/Graph upkeep remain active across experience rollback; this adds no cloud flag. Cloud-only review closure preserves the canonical revision-8 activation prerequisite documented in the corrected matrix; server/client runtime verification remains with their owners.


- Decision (2026-10-20, Cloud Engineer): retain source/entry-point/scope/configuration facts in the README and obtain deployment identity/runtime/generation/cadence from explicit per-environment metadata reads. Keep delivery sequencing/history in this ExecPlan. Move the test without modifying its contents; leave all existing one-off maintenance scripts untouched.

- Decision: D1 — Scoping flags. `refreshTiktokAccessTokens`, `refreshTiktokRatesForAllAccounts` and `fetchAndUpdateInstagramDemographics` gain `?user_id=<uid>` (process only that user, 404 when the user has no node, same response shape otherwise); `processInstagramComments` gains `?campaign_id=`; `refreshAllCampaignAnalytics` keeps its existing `?campaign_id=`. The F-FN dry runs use these scopes against run-tagged dev records.
  Rationale: see the first `Surprises & Discoveries` entry; an unscoped run against dev touches every dev creator's node, which is not a dry run, and `refreshAllCampaignAnalytics` on dev reads prod RTDB (TRD R-6).
  Date/Author: 2026-10-15, Tech Lead.
- Decision: D2 — Host selection is one small helper, `graphHostFor(instagramNode)` returning `https://graph.instagram.com/v24.0` when `instagramNode.api_path === "instagram"` and `https://graph.facebook.com/v24.0` otherwise, **copied verbatim into each legacy function folder** that needs it (`refreshTokens`, `refreshInstagramRates`, `updateInstagramDemographics`, `processInstagramComments`, `refreshAllCampaignAnalytics`) as a `graphHost.js` beside the function's own files, with an identical body and a one-line header naming the other copies.
  Rationale: each legacy folder is a standalone deploy unit with its own `package.json` and no shared workspace (`CLAUDE.md`, *Tooling & Standards*); a cross-folder `require("../shared/…")` is not uploaded by `gcloud functions deploy`. A copied five-line file is the honest cost of the legacy layout; the TypeScript port (OQ-F1) is where it becomes one module. The new file is `.js` because the legacy folders have no TypeScript build — this is the "stop and ask" case of the workspace rule, and the question is put to the user with this plan (BD-4).
  Date/Author: 2026-10-15, Tech Lead.
- Decision: D3 — The repository `README.md` gains a *Legacy function deploy* section recording, per function, the deployed name, generation, region, runtime, entry point (from each `index.js`: `refreshTiktokAccessTokens`, `refreshTiktokRatesForAllAccounts`, `refreshInstagramRates`, `fetchAndUpdateInstagramDemographics`, `processInstagramComments`, `refreshAllCampaignAnalytics`), the env var **names** it needs (`PRODEV`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`) and the per-environment deploy order from the contract. Deployment belongs in the README, never in code comments.
  Rationale: the second `Surprises & Discoveries` entry; the workspace rule that genuine operator steps live in the owning README.
  Date/Author: 2026-10-15, Tech Lead.
- Decision: D4 — `last_error` is written with one `.update()` on the platform node together with whatever else that run writes (never a separate `.set()` per field), and every successful write of that node includes `last_error: null`. The `message_key` mapping lives in the same `graphHost.js`-style copied helper, `socialErrors.js`, so the server's catalogue and the functions' never drift by more than a copy.
  Rationale: `CLAUDE.md` *Firebase Writes* (atomic multi-path update); the contract's catalogue.
  Date/Author: 2026-10-15, Tech Lead.
- Decision: D5 — PR cadence: functions PR A (M3-fn) and functions PR B (M5-fn), each against `dev`, the second from a fresh worktree after the first merges; each deployed per environment **before** the matching server PR.
  Rationale: TRD §11.2 step 1 and the server plan's D1.
  Date/Author: 2026-10-15, Tech Lead.

- Decision: user rulings on the plan review, 2026-10-15 (Gustavo): PR cadence approved (functions PR A, then B from a fresh worktree after A merges); BD-4 approved — the two copied `.js` helpers (`graphHost.js`, `socialErrors.js`, at most ~20 lines each) are allowed in the legacy folders as the explicit exception to the TypeScript rule, because those folders have no TS build and adding one is out of scope.

- Decision: D6 — retain typed deterministic regression coverage in one standalone Node/VM test, without production mock-env switches. The legacy standalone deployment shape is unchanged. Five tests exercise token errors/success, zero-history rates, formulas, paging/concurrency and Meta media/insights errors. Real-vendor token rotation remains a separate operator F-FN gate. Date/Author: 2026-10-15, Cloud Engineer.

### Blocking decisions

Work starts on the defaults; "all defaults stand" is a complete answer. None blocks M3-fn's code; P5 (secret rotation) gates M3-fn's deploy, and the server's P3 / P4 gate nothing here.

- BD-1 — P13 / OS2, the TikTok batch size. Default: 100 users per key batch, 5 concurrent TikTok calls per batch (the `refreshInstagramRates` figures), adjusted only if OS2 shows more than ~500 connected creators on dev. Owner: cloud builder.
- BD-2 — OQ-D5, schedulers calling the server's `refreshAll` / `demographics` / `comments` routes without a bearer. Default: none (Cloud Scheduler targets these functions directly, not the server); confirmed by listing Cloud Scheduler jobs in the dev project during the first task. Reported to the server plan (its BD-6). Owner: cloud builder.
- BD-3 — OQ-W13, the refresh cadence written down. Default: the cadence is read from the Cloud Scheduler jobs during the first task and recorded in the README section (D3), so the client's "as of the last refresh" copy can name it later. Owner: cloud builder.
- BD-4 — The two copied helper files (`graphHost.js`, `socialErrors.js`) are new `.js` files inside legacy folders that have no TypeScript build. Default: allowed as the documented exception, each ≤ 20 lines, because the alternative is inlining the same five lines in six places. If the user refuses, the helper is inlined per file and the plan notes the duplication as debt. Stops M5-fn.1 if refused. Owner: Gustavo.
- BD-5 — P9 verified the deployed `updateInstagramDemographics` implementation matches the repository. Its deployed Firebase target is production, so it must not be invoked for dev validation. This function is outside PR A deployment scope; the finding and operator guard are recorded in the README. Owner: cloud builder.
- BD-6 — Instagram long-lived refresh window. Default: refresh when `access_token_expires_at` is within 30 days (TRD §5.6), skipping nodes with no `access_token_expires_at` (Facebook-path tokens are not refreshable this way). Owner: cloud builder.


## Outcomes & Retrospective

2026-10-22 functions rollout boundary: README clarification and bounded source verification are complete; no production runtime flag or code change is required. Scheduled upkeep remains unconditional. The cloud-only portion of the single combined tech-lead review is closed without blockers. Root publication and the whole-feature runtime verdict remain pending; server/browser gating is owned by the companion branches, so this outcome does not claim the overall staging/production separation is delivered. Previous check outcomes remain historical evidence for their recorded unchanged sources.


2026-10-20 correction: the README now describes ongoing operation of all six scheduled social functions without PR labels or dated deployment snapshots. The five production regression cases live under root `__tests__/`, byte-identical to the original suite. No production source, query behavior, timeout, API or one-off maintenance script changed. No cloud command was run.

Functions PR A implements all three M3-fn milestones: atomic rotated TikTok tokens, awaited key-paged TikTok rates, and Instagram reconnect-error persistence with rate-limit suppression. Six syntax checks, strict TypeScript verification of the standalone regression file, five deterministic tests, all four required root gates, and scoped dev Firebase write/readback passed. Real-vendor F-FN remains unverified until P5 and operator deployment; review and PR publication remain. No rotation or deployment was performed. M5-fn is untouched.


## Context and Orientation

`crafted_cloud_functions/` holds Google Cloud Functions in two generations. `functions/creator-outreach/` is the modern TypeScript reference with Nx, Biome, vitest and CI; **every function this plan touches is a legacy plain-JavaScript folder** with its own `package.json` and `node_modules`, no shared tooling and no CI (`CLAUDE.md`, *Tooling & Standards*; `README.md`, *Folder Structure*). Each legacy folder has an `index.js` that registers the HTTP target with `@google-cloud/functions-framework` (`functions.http("<target>", handler)`; the target must equal the gcloud `--entry-point`) and an implementation file; `npm run dev` in the folder starts it on `http://localhost:8080`. Firebase is reached through `const firebase = require(process.env.PRODEV)`, a path to a service-account module selected per data project (`crafted-dev-v1` / `crafted-staging-v1` / `crafted-v1`); `.env` in the folder sets it locally and is never committed. Every function is wrapped in `cors(req, res, async () => { … })`, scans large collections in key batches of 100 (`orderByKey().limitToFirst(100).startAfter(lastKey)`), and must never let one user's error kill the batch (`CLAUDE.md`, *Firebase Batch Reads*, *Error Handling*).

The six functions this plan edits, their targets and what they do today:

- `functions/refreshTokens/` → `refreshTiktokAccessTokens` (`influencer.js`): batches `users`, and for each node with `creator_socials/tiktok/refresh_token` POSTs `https://open.tiktokapis.com/v2/oauth/token/` with the committed `client_key` / `client_secret` (`:44-45`), then writes `access_token_expiry_date`, `refresh_token_expiry_date` and `access_token` with three separate `.set()` calls (`:71-93`); it never writes the new `refresh_token`; it answers 200 after all batches.
- `functions/refreshTikTokRates/` → `refreshTiktokRatesForAllAccounts` (`influencer.js`): queries `users` ordered by `creator_socials/tiktok/performance/suggestedRate` (`:14-17`), so only creators who already have a rate are selected; calls `getSuggestedRateTikTok(userId)` without awaiting (`:24`), and responds immediately; `getSuggestedRateTikTok` reads the token, fetches `user/info` and `video/list` (`:48-80`), computes medians and writes `performance`.
- `functions/refreshInstagramRates/` → `refreshInstagramRates` (`instagram.js`): batches `users` (or one `?user_id=`), skips `negotiated`, needs `instagram_business_account_id` + `access_token`, fetches `graph.facebook.com/v24.0/{id}/media?fields=media_type&limit=300` (`:159`) and per-media insights (`:188`), writes `suggested_rate` + `updated` (`:41-47`); errors are logged per user (`:131-139`) and nothing records them.
- `functions/updateInstagramDemographics/` → `fetchAndUpdateInstagramDemographics` (`instagram.js`): batches `users`, four `graph.facebook.com/v24.0/{id}/insights?metric=follower_demographics&breakdown=…` calls (`:40-43`), writes `demographics`.
- `functions/processInstagramComments/` → `processInstagramComments` (`instagram.js`): iterates `influencer_campaigns` → tasks → posts, fetching `graph.facebook.com/v24.0/{media_id}/comments` (`:49`).
- `functions/refreshAllCampaignAnalytics/` → `refreshAllCampaignAnalytics` (`campaign.js`, `utils.js`): iterates `influencer_campaigns` (or one `?campaign_id=`, `campaign.js:16-18`), fetching `graph.facebook.com/v24.0/{media_id}/insights?metric=views,comments,likes,shares` (`utils.js:402`). Its dev deployment reads the **prod** RTDB (TRD R-6), so it is deployed last and only after a `campaign_id`-scoped run.

Terms: **`api_path`** — `users/{uid}/creator_socials/instagram/api_path`, `"instagram"` for a creator connected through Instagram Login, absent or `"facebook"` otherwise; the only thing that selects the Graph host. **`last_error`** — `users/{uid}/creator_socials/{platform}/last_error`, the contract's shape, read by the browser's reconnect bars and Settings rows. **Run-tagged creator** — a dev `users/{uid}` created for a test run with a recognisable tag in its email, the only kind of record a dry run may touch; user-provided test accounts are never removed. **Key-batched scan** — the 100-at-a-time `orderByKey()` walk; never `.once("value")` on all of `users`.


## Plan of Work

### M-Rollout — scheduled maintenance compatibility

Cloud engineer owns only the scheduled-functions README and this plan for the rollout amendment, plus a bounded existing-source inventory. Keep token rotation, rates, error persistence, Graph routing and scoped maintenance behavior unconditional on both branches. A disabled browser experience must not stop maintenance for existing Facebook, TikTok or Instagram Login accounts. No new runtime flag, handler change, dependency or test-suite rewrite is required absent a demonstrated integration defect. Do not inspect or modify one-off maintenance scripts. Document the environment-level experience flags as server/client controls and the worker prerequisites in durable capability terms; retain verified data-target safeguards and the maintained `__tests__/legacySocialFunctions.test.ts` commands. Reuse unchanged-code evidence; do not invoke hosted functions or production Firebase.


### M3-fn.1 — `refreshTokens/influencer.js`

Replace the literal `client_key` / `client_secret` with `process.env.TIKTOK_CLIENT_KEY` / `process.env.TIKTOK_CLIENT_SECRET`, failing the whole run with a 500 and a clear log line when either is unset (a half-configured deploy must not refresh with a dead secret). Add `?user_id=` scoping: when present, process only `users/{user_id}` and skip the batch walk. Replace the three `.set()` calls with one `.update()` on `users/{key}/creator_socials/tiktok` carrying `access_token`, `refresh_token: responseData.refresh_token`, `access_token_expiry_date`, `refresh_token_expiry_date`, `updated_at` and `last_error: null`. When TikTok answers an error (`responseData.error === "invalid_grant"`, or `responseData.error_code` / `data.error.code` of `10010`), write `last_error: { code, message_key: "tt_invalid_grant" | "tt_10010", at }` with `socialErrors.js`'s mapping and nothing else; any other error is logged and leaves the node alone. Keep the batch walk, the per-user catch and the final 200.

### M3-fn.2 — `refreshTikTokRates/influencer.js` (rewrite in place)

Replace the `orderByChild("…/suggestedRate")` query with the key-batched scan from `refreshInstagramRates` (batch 100, `?user_id=` scope), selecting every user whose `creator_socials/tiktok/access_token` is a non-empty string other than `"null"`, skipping `negotiated === true`. Process each batch with `Promise.all` over a per-user `try/catch` (at most 5 TikTok calls in flight per batch, the `BATCH_SIZE_MEDIA` idea), **await every batch before responding**, and answer `{ processed, skipped, failed }` counts. `getSuggestedRateTikTok` keeps its formula and writes `performance` (with `followerCount`, `suggestedRate`, the medians it computes today), `updated` (ISO) and `last_error: null` in one `.update()` on the tiktok node; a TikTok error code `2190008` / `2190002` / `2190003` / `10010` (from `userData.error.code` or `videoListData.error.code`) writes `last_error` with `tt_<code>` and skips the rate write; a creator with zero videos writes `performance.suggestedRate: 0` and `updated` (D-ZERO's "connected, no history yet"), not an error. The `handle` write stays.

### M3-fn.3 — `refreshInstagramRates/instagram.js`

In `processUserInstagramRate`, on a Meta error response (`error.code` 190 with any `error_subcode`, 102, 10, 200) write `creator_socials/instagram/last_error` through `socialErrors.js` and return `{ skipped: true, reason: "token_error" }`; on 4 / 17 / 32 log `[WARN] rate limited` and return `{ skipped: true, reason: "rate_limited" }` with no write; on success include `last_error: null` in the existing `.update()` (`:41-47`). The host stays `graph.facebook.com` until M5-fn.

### M5-fn.1 — host routing

Add `graphHost.js` (D2) to the five folders and change every Graph URL literal to `` `${graphHostFor(instagramNode)}/…` ``: `refreshInstagramRates/instagram.js:159, :188` (the node is `user.creator_socials.instagram`), `updateInstagramDemographics/instagram.js:40-43` (plus `?user_id=` scope and `last_error` on 190 / 10 / 200), `processInstagramComments/instagram.js:49` (the creator's node is read for each post's creator — today it reads `creatorData.access_token`, so `creatorData.api_path` is beside it; plus `?campaign_id=` scope), `refreshAllCampaignAnalytics/utils.js:402` (the post's token comes with the post; the creator's `api_path` must be read from `users/{creator_id}/creator_socials/instagram` once per creator and cached per run). The Instagram host uses the creator's `instagram_user_id` where the Facebook path used `instagram_business_account_id`; both are the Instagram professional account id, so the same path works, and the server writes both fields on the Instagram path.

### M5-fn.2 — Instagram long-lived refresh in `refreshTokens/influencer.js`

In the same batch walk, for a node with `creator_socials/instagram/api_path === "instagram"`, a non-empty `access_token` and an `access_token_expires_at` within 30 days, `GET https://graph.instagram.com/v24.0/refresh_access_token?grant_type=ig_refresh_token&access_token=…`; on success `.update()` the instagram node with `access_token`, `access_token_expires_at` (now + `expires_in` seconds, ISO) and `last_error: null`; on a 190 write `last_error` (`ig_190_<subcode>` / `ig_190`); other errors logged. Nodes without `api_path` or without `access_token_expires_at` are skipped (BD-6). The function's name stays `refreshTiktokAccessTokens` (renaming the target would change the deploy and the scheduler; the README records that it now refreshes both).

### README (D3)

Maintain `Scheduled legacy social functions` as durable operator guidance: each source folder's registered entry point, work and supported scopes, required env names, explicit per-environment metadata inspection, deployment, verification and rollback. Read runtime/generation/cadence from the current deployment rather than preserving a one-time snapshot as policy. Keep the production-target guards and private-configuration handling. Delivery sequencing and historical observations belong in this plan, not the README.


## Concrete Steps

All commands run in `/home/gustavo/dev/crafted/.worktrees/feature/creator-onboarding-ig-login-crafted_cloud_functions` unless stated. `PRODEV` points at the **dev** key file only; nothing here runs against staging or prod from an agent. Secrets are never printed.

Before the first edit:

    git fetch origin
    git ls-remote --heads origin feature/creator-onboarding-ig-login
    gh pr list --state all --head feature/creator-onboarding-ig-login
    gcloud config get-value project                      # unset locally; use explicit --project=crafted-dev-v1
    for f in refreshTokens refreshTikTokRates refreshInstagramRates updateInstagramDemographics processInstagramComments refreshAllCampaignAnalytics; do gcloud functions describe "$f" --project=crafted-dev-v1 --region=us-central1 --format='value(name,environment,buildConfig.runtime,buildConfig.entryPoint)'; done
    gcloud scheduler jobs list --project=crafted-dev-v1 --location=us-central1 --format='table(name,schedule,timeZone,httpTarget.uri,state)'

Expected: six functions found (or their real deployed names recorded if they differ); env var **names** and the schedule recorded under `Artifacts and Notes`; no scheduler job targets `/api/influencers/instagram/*` on the server.

OS2 (P13), read-only, from the server worktree's dev credentials or a one-off script here using `PRODEV`:

    node -e 'const fb=require(process.env.PRODEV); (async()=>{let last=null,n=0,t=0;for(;;){let q=fb.database().ref("users").orderByKey().limitToFirst(100);if(last)q=q.startAfter(last);const s=(await q.once("value")).val();if(!s)break;const k=Object.keys(s);k.forEach(u=>{t++;const a=s[u]?.creator_socials?.tiktok?.access_token;if(typeof a==="string"&&a&&a!=="null")n++;});last=k[k.length-1];if(k.length<100)break;}console.log({users:t,tiktokConnected:n});process.exit(0)})()'

Expected: `{ users: <N>, tiktokConnected: <M> }`; record both.

Per edited function, the syntax gate and a scoped dry run against a run-tagged dev creator (`<uid>`), with the function running locally on 8080:

    node --check functions/refreshTokens/influencer.js
    (cd functions/refreshTokens && npm install && TIKTOK_CLIENT_KEY=… TIKTOK_CLIENT_SECRET=… npm run dev)   # values from the dev secret store, never echoed
    curl -s "http://localhost:8080/?user_id=<uid>"

Then read the written node (never the whole collection):

    node -e 'const fb=require(process.env.PRODEV);fb.database().ref("users/<uid>/creator_socials/tiktok").once("value").then(s=>{const v=s.val();console.log({refresh_token_present:!!v.refresh_token,access_token_expiry_date:v.access_token_expiry_date,refresh_token_expiry_date:v.refresh_token_expiry_date,last_error:v.last_error,updated:v.updated??v.updated_at});process.exit(0)})'

Expected after M3-fn.1: `refresh_token_present: true`, both expiries in the future, `last_error: null`. Repeat with a run-tagged creator holding a deliberately corrupted `refresh_token`: `last_error.message_key === "tt_invalid_grant"` and the other fields unchanged. After M3-fn.2 (`refreshTikTokRates`), a creator with no prior `performance` node shows `performance.suggestedRate` (a number, possibly 0), `updated` and `last_error: null`, and the HTTP response's `processed` count is 1. After M5-fn.1, with a run-tagged creator whose node carries `api_path: "instagram"` and an Instagram-Login token obtained through the server's dev M5 flow, `refreshInstagramRates?user_id=<uid>` logs an `https://graph.instagram.com/v24.0/…` URL and writes `suggested_rate`; the same creator with `api_path` removed logs `graph.facebook.com`.

Do not invoke the dev-hosted `refreshAllCampaignAnalytics` or `updateInstagramDemographics` deployments from an agent while their target is production, even with a scoped query. Later operator validation requires an explicitly verified permitted data target and the appropriate `campaign_id` or `user_id` scope.

Deploy (operator, per data project, user-authorized; exact flags from the `describe` output — the legacy functions keep whatever generation, region and runtime they have today):

    gcloud functions deploy refreshTokens --project=crafted-dev-v1 --region=us-central1 --gen2 --runtime=nodejs20 --source=functions/refreshTokens --entry-point=refreshTiktokAccessTokens --trigger-http --env-vars-file=/private/path/refreshTokens-dev.yaml

and the same for the other five, `refreshAllCampaignAnalytics` last. Record `gcloud functions describe` after each deploy (names only).

PR A and PR B: stage explicit paths, commit per function with `Progress` updated, push, open the PR against `dev` with a body file, then `gh pr view <n> --json state,mergedAt,headRefOid`.


## Validation and Acceptance

### Rollout-flag acceptance matrix

Verify unset, `false`, mixed-case and arbitrary values are off; only `true` is on. Cover master off, master on/Instagram off, both on, and Instagram on/master off. With the server master off, every server branch retains supported legacy requests; disabled new-flow calls perform no feature reads/writes and do not hang. With the server master on, soft enforcement (server A/P) remains compatible with a legacy browser. Strict enforcement (server C/B) requires a matching enabled browser before activation: a legacy-browser/strict-server mismatch rejects missing fields or headers before writes. This activation prerequisite adds no caller-version header and does not weaken strict enforcement. Client-on/server-off new calls must fail closed without unsafe fallback or a loading deadlock. Test old email signup including deferred Auth/profile-write retry, legacy Settings/address and Facebook/TikTok callbacks, both in-app proposals, old public Amplify brief/invite return, Home/Apply lists, and absent feature analytics/network calls when off. Verify enabled feature behavior retains consent, origin/owner checks, status isolation, pricing, social snapshot equality, atomic persistence and Supabase-failure refusal. Include direct route access, not only navigation visibility. Recheck affected real-component layouts for restored and enabled presentation.

Run focused checks during implementation and required integrated gates once per changed runtime branch with source/runtime/dependency identities. Compare actual baseline fixtures when needed; do not treat screenshot similarity as legacy API compatibility. Preserve prior evidence as historical, reuse only unchanged boundaries, and report unverified live Meta/Auth/S3 behavior explicitly. One combined technical review per changed PR with targeted correction closure; no optional product/tester/audit phases or additional reviewers are implied.


There is no shared legacy test harness or CI. The maintained dependency-free typed Node/VM suite is `__tests__/legacySocialFunctions.test.ts`, with strict `tsc` and Node commands in the README. Production code gains no mock env hook; vendor and Firebase doubles are injected only in this isolated test. Real-vendor acceptance remains F-FN: `node --check` on every edited file, plus the scoped dry runs above with the written nodes read back, recorded under `Artifacts and Notes` with the run tag, the command, the function's folder digest (`git rev-parse HEAD` + `git status --porcelain -- functions/<name>`), the Node version, and the measured duration. Behaviour a human can verify on dev:

- A creator with a TikTok `access_token` and no `performance` node gets a rate after one scoped call, and the call returns after the write (`processed: 1` in the body; the node read shows `updated` later than the request start).
- The rotated TikTok `refresh_token` is persisted; a second scoped call succeeds with the new one.
- A forced `invalid_grant` writes `last_error` with `tt_invalid_grant` and leaves the token fields untouched; the next good run writes `last_error: null`.
- `refreshInstagramRates` on a creator whose token Meta rejects with 190 writes `last_error` with `ig_190_<subcode>`; a mocked 4 / 17 / 32 (a run-tagged creator with a token that trips the user-level limit is not reproducible on demand, so this case is verified by reading the branch in the diff and by the typed Node/VM test injecting synthetic Meta responses at both media and insights boundaries) writes nothing.
- With `api_path: "instagram"`, every logged Graph URL is `graph.instagram.com`; without it, `graph.facebook.com`.
- `grep -rn "@supabase\|SUPABASE_" functions/` is empty; `grep -nE 'client_(key|secret): "' functions/refreshTokens/influencer.js` is empty after M3-fn.1 (the committed secret is gone from the tree; the history is handled by P5's rotation, not a rewrite).

A behaviour not demonstrated by a scoped run and a node read-back is not a verified behaviour; the review checks the transcripts, not the summary.


## Idempotence and Recovery

Every function is a scheduled refresh that overwrites the same fields on each run, so a rerun is safe by construction; `last_error` is cleared by the next successful write and set again by the next failure. A scoped `?user_id=` run touches one node. A deploy of a legacy function replaces the previous revision; rolling back is redeploying the previous commit's folder with the same flags (recorded in the README). The TikTok secret rotation is one-way: once the new secret is issued the old one is dead, so P5 and the `refreshTokens` deploy are done in one sitting per environment, and the function fails loudly (500, no refresh) rather than silently when the env var is missing. An Instagram-path token whose refresh fails keeps working until its `access_token_expires_at`; the creator sees a reconnect bar from the `last_error` and reconnects through the server's flow.


## Artifacts and Notes

PR A delivery: https://github.com/Crafted-Corp/crafted_cloud_functions/pull/24. Combined technical review GO at `7519ef44d27fc0d735ea2f8a8dd2854405048ccd`; only the production-target guard wording required correction. Post-creation `gh pr view 24 --json url,state,mergedAt,headRefOid,baseRefName,headRefName` returned:

    {"baseRefName":"dev","headRefName":"feature/creator-onboarding-ig-login","headRefOid":"7519ef44d27fc0d735ea2f8a8dd2854405048ccd","mergedAt":null,"state":"OPEN","url":"https://github.com/Crafted-Corp/crafted_cloud_functions/pull/24"}

This records the observed PR head before the documentation-only delivery-record commit. No merge or deployment occurred.

2026-10-15 preflight: `gcloud functions list --project=crafted-dev-v1` found all six functions. `gcloud functions describe <deployed-name> --project=crafted-dev-v1 --region=us-central1 --format=json` was parsed privately, emitting name/generation/runtime/entryPoint/source and environment variable names only. All six env-name lists contain only `LOG_EXECUTION_ID`. The original hosting/scheduler snapshot was recorded in the then-current README; its git history retains that observation. The active README now requires current per-environment metadata reads instead of treating the snapshot as policy. Six social schedulers call functions directly; an unrelated existing traffic-click scheduler calls the production server and was never invoked.

P9: downloaded the deployed demographics ZIP privately. `instagram.js`, `index.js`, and `firebase_connect.js` are byte-identical; the implementation SHA-256 is `698e2a1e3b744d6dc2d3cbaac973f5633163abde28c2f319d5183a4ddc3d8b02`. The only package.json difference is absence of the local `dev` script in the deployed version. The hardcoded uid gate is absent. No secret values were emitted. The production credential/URL finding is recorded above.

P13: Node read-only key pages of 100 using the server's private `.env.dev`, rejecting any service-account project other than `crafted-dev-v1`, returned `{ users: 222, tiktokConnected: 19, durationMs: 6067 }`. Default batch 100 / five concurrent TikTok calls retained.

Verification environment: Node v22.22.0, npm 10.9.4, isolated `npm ci --ignore-scripts --no-audit --no-fund` (665 packages, no lockfile change). Root package-lock SHA-256 `7e7134ecef7c92e17beee979b1a4eebbda6c6b44b3395d09befd2af48c9b7f3e`; installed node_modules/.package-lock SHA-256 `3d0ef0b7eb6de37611b0ab1d92b2ef1be153b35d2b6fe674af6af056f63a3eb0`. Root gates used `NX_DAEMON=false NX_ISOLATE_PLUGINS=false CI=true`; no Firebase/schema/vendor inputs, creator-outreach imports mocked by its own suite. Standalone test injects every external module and uses synthetic env/vendor/Firebase values; schema not applicable.

Historical 2026-10-15 evidence at the former test path (retained verbatim; current commands use `__tests__/legacySocialFunctions.test.ts`): measured successful commands from this worktree, exit 0 throughout: `node --check functions/refreshTokens/influencer.js` 32 ms; TikTok rates 23 ms; Instagram rates 25 ms; corresponding copied socialErrors.js 28/18/19 ms. `node_modules/.bin/tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --types node --skipLibCheck maintenance/creatorOnboardingFunctions.test.ts` 792 ms. `node --experimental-strip-types --test maintenance/creatorOnboardingFunctions.test.ts` 300 ms, 5 tests passed / 0 failed. `npm run check:ci` 5315 ms; `npm run typecheck` 3232 ms; `npm run test:ci` 2066 ms, 4 test files / 33 tests passed; `npm run build` 4434 ms. Root commands cover creator-outreach only; standalone checks cover this PR's legacy code. Raw sanitized outputs and command records are local `/tmp/creator-onboarding-functions-check-{0..11}.log` and `/tmp/creator-onboarding-functions-checks.json`. After adding the mixed-batch network-failure assertion and formatting the standalone test, only its strict-tsc and test commands were rerun; their final outputs are `/tmp/creator-onboarding-functions-final-{0..1}.log`. Unchanged production-code syntax and creator-outreach gates are reused at their original measured durations. One initial VM assertion failed because cross-realm objects have different prototypes; structured cloning fixed the test boundary. An initial strict-tsc narrowing error was corrected with a typed object guard before the recorded pass.

Scoped storage evidence: an isolated Node/VM invocation injected the real Firebase Admin app validated as `crafted-dev-v1`, synthetic vendor responses and synthetic tokens. Run tag `agent-creator-onboarding-1792074909103`; all calls carried `query.user_id` equal to the owned tag. Rotation produced the new refresh token and future expiries before response; TikTok zero-history produced `processed: 1`, followerCount 12 and suggestedRate 0 before response; subsequent invalid_grant changed only last_error. Readbacks passed in 2027 ms, then the owned users/{run-tag} node was removed and absence verified. No existing creator was modified. Firebase connection used the dev database URL and private server `.env.dev` credential; no Supabase identity was created. These are real-storage / synthetic-vendor checks, not real TikTok F-FN. Two real-vendor successful rotations and real forced vendor errors remain unverified; P5 credentials/deployment are not present and no secret was rotated.

Historical 2026-10-15 code identities at their then-current paths: token implementation `fb106baf324c6202bce9041f3ff57d96e38f1fad83b29244f0365046661a8f8e`; TikTok rates `ab500138d60ece90372efd29d641fd9e9f60373f44bd75c0305eebd9db2c1b01`; Instagram rates `cf9e821655e3c92e07e45d188221c0d16ce79e4de76e2d8d637d0910b72976d4`; regression test `6e7bce621864a710693bd27b0e058a3110040de2e9098351f4cba230d5d414d4`. Identical copied helper content is versioned alongside them. README/plan-only updates do not invalidate these code-bound checks.


2026-10-20 README/test-location correction evidence: the previous test file at `maintenance/creatorOnboardingFunctions.test.ts` was moved byte-identically to `__tests__/legacySocialFunctions.test.ts` (SHA-256 `6e7bce621864a710693bd27b0e058a3110040de2e9098351f4cba230d5d414d4`), preserving all 5 cases. The old path no longer exists. `node_modules/.bin/tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --types node --skipLibCheck __tests__/legacySocialFunctions.test.ts` passed in 2034 ms; `node --experimental-strip-types --test __tests__/legacySocialFunctions.test.ts` passed 5/5, zero failed, in 319 ms. Tests used Node `v22.22.0` / npm `10.9.4`, the unchanged dependency install, and the suite’s existing synthetic VM dependencies; no env/credential/schema or vendor/Firebase inputs are loaded. Exact timestamps, command arrays, source/install/test hashes, results and logs are retained at `/tmp/crafted-readme-correction-20261020-A/report.json` and `check-{0..1}.log`.

Local README verification checked all six source-folder registrations, every req.query scope and required env-name inventory against the documented table/configuration. The new section contains no PR labels/links, rollout-stage story, dated runtime/cadence snapshot or old test command. Its shell examples are parsed with `bash -n`, without executing them; all cloud examples are operator instructions only. Source/dependency digest `a486eee880d1798c58cd6ce753e3976b31b71f700a4729f35a9a06a2cfdb3632` and a zero production/dependency diff establish that this correction changes only README, plan and exact test location. No existing one-off maintenance script was inspected, changed or run. Historical transcripts above retain the former test path as past evidence; active commands use the new path.

The unchanged-input root gates and six production syntax checks are reused from the parent-provided `/tmp/crafted-pr24-audit-8fGW3H` audit evidence rather than rerun. Its root command records report check:ci 47.819 s, typecheck 2.045 s, test:ci 1.019 s and build 2.031 s, all exit 0; the root test output is cached creator-outreach evidence, not new legacy coverage. The newly measured legacy coverage is the five-test command above.


2026-10-22 M-Rollout functions-only evidence: bounded local inventory of all 35 tracked files in the six scheduled social-service folders found zero occurrences of `ENABLE_CREATOR_ONBOARDING`, `REACT_APP_ENABLE_CREATOR_ONBOARDING`, `ENABLE_INSTAGRAM_LOGIN` or `REACT_APP_ENABLE_INSTAGRAM_LOGIN` in executable/manifests. All six registered entry points still match the README table. Scheduler/deployment/verification instructions from `### Inspect and deploy` onward are byte-identical to HEAD; production source, maintained tests, configuration and dependencies have no delta. Static verification passed in 662 ms; detailed source hashes, paths, timestamped result and registration inventory are in `/tmp/crafted-functions-rollout-docs-A/inventory.json`. No maintenance script, live cloud/vendor call or runtime suite was used. Prior unchanged-source test/build evidence remains applicable and was not rerun. This verifies the functions boundary only; the companion server/browser flag behavior is outside this check.


2026-10-22 cloud review closure: the cloud-only portion of the existing single combined tech-lead review found no blocker. Its bounded matrix correction is applied above against canonical server contract revision 8; the frozen reviewed README is unchanged. Existing source-inventory proof remains applicable (662 ms, zero flag references, six registration matches); all recorded source hashes still match. No runtime, test, dependency or configuration input changed, so no suite or cloud/vendor call was rerun. Documentation milestone commits are authorized; root publication and the overall server/browser runtime verdict remain pending.


## Interfaces and Dependencies

Libraries: `@google-cloud/functions-framework`, `firebase-admin`, `axios` / `fetch`, `moment`, `cors` — all already in each folder's `package.json`. No new dependency.

In each affected folder, `graphHost.js` (identical copies, D2):

    // The same five lines live beside refreshTokens, refreshInstagramRates, updateInstagramDemographics,
    // processInstagramComments and refreshAllCampaignAnalytics: legacy folders deploy alone.
    const graphHostFor = (instagramNode) =>
      instagramNode && instagramNode.api_path === "instagram"
        ? "https://graph.instagram.com/v24.0"
        : "https://graph.facebook.com/v24.0";
    module.exports = { graphHostFor };

and `socialErrors.js`:

    const metaMessageKey = (error) => /* 190+subcode → ig_190_<subcode>, 190 → ig_190, 102 → ig_102, 10 → ig_10, 200 → ig_200; 4/17/32 → null */;
    const tiktokMessageKey = (code) => /* 2190002, 2190003, 2190008, 10010 → tt_<code>; "invalid_grant" → tt_invalid_grant; else null */;
    const lastErrorFor = (code, subcode, message_key) => ({ code, ...(subcode !== undefined ? { subcode } : {}), message_key, at: new Date().toISOString() });
    module.exports = { metaMessageKey, tiktokMessageKey, lastErrorFor };

Function targets (unchanged): `refreshTiktokAccessTokens`, `refreshTiktokRatesForAllAccounts`, `refreshInstagramRates`, `fetchAndUpdateInstagramDemographics`, `processInstagramComments`, `refreshAllCampaignAnalytics`. New query scopes: `?user_id=` on the first four, `?campaign_id=` on the last two.

Dependencies on other plans: the server writes `api_path`, `instagram_user_id` and `access_token_expires_at` (server M5) and reads `last_error` (server M1.3's status read); the client renders `last_error` through the reconnect bars (client M3). This repository deploys first in every environment. External gates: P5 (TikTok secret rotation, operator), P9, P13; the server's P3 / P4 gate M5-fn's dev verification only (an Instagram-path creator cannot exist before the server's flag-on dev build).


## Revision note 1 — 2026-10-15, Tech Lead

Initial authoring from TRD v1.0 FINAL. Sections touched: all. Why: the user requested the three per-repo plans for review before implementation. Carries the TRD's decisions without reopening them; records the scoping-flag and undocumented-deploy findings as surprises (D1, D3); sets the copied-helper rule for the legacy layout (D2, BD-4) and the PR cadence (D5).

## Revision note 2 — 2026-10-15, orchestrator

Recorded the user's plan-review rulings in the Decision Log (PR cadence, BD-4 `.js` helpers allowed). Sections touched: Decision Log. Why: the user approved the plan with these rulings.


## Revision note 3 — 2026-10-15, Cloud Engineer

Implementation authorization recorded, TRD v1.1 and contract revision 2 rechecked (the Firebase contract is unchanged), M3-fn.1 implemented. Preflight discovered the live names match folder names, not HTTP entry points; details and verification follow in Artifacts and Notes.


## Revision note 4 — 2026-10-15, Cloud Engineer

Completed M3-fn.2/.3, recorded all preflight findings and measured check identities, added typed regression coverage and README operator instructions, and distinguished real-storage synthetic-vendor evidence from unavailable real-vendor F-FN. The demographics production target is a new load-bearing finding reported to the user via the orchestrator; no deployment is attempted.


## Revision note 5 — 2026-10-15, Tech Lead

Combined PR A technical review found no implementation blocker. Corrected stale plan instructions that permitted scoped invocation of a production-backed deployment and implied demographics belonged to PR A deployment. README guards and implementation/check identities are unchanged; real-vendor verification remains pending P5.


## Revision note 6 — 2026-10-20, Cloud Engineer

The user corrected the README’s temporary delivery narrative and regression-test placement. Rewrote the legacy-function section as durable operator guidance, moved the suite byte-identically to root __tests__, updated active commands and labeled the former-path check transcript as historical. Source behavior and retained check identities are unchanged; targeted new-path evidence follows.


## Revision note 7 — 2026-10-22, Tech Lead

Added revision-8 rollout contract guidance, M-Rollout ownership and legacy compatibility boundaries, the flag/misalignment test matrix and current incomplete Progress/Outcomes. User authorization expands scope to environment-wide feature gating; no implementation, configuration, deployment or credential was changed by this plan amendment.


## Revision note 8 — 2026-10-22, Cloud Engineer

Documented the master/subordinate experience flags and unconditional background maintenance in the durable README. Updated this branch’s M-Rollout progress, decision and outcome after a bounded source/registration inventory. No production, configuration or test code changed; no cloud/vendor calls or runtime suites were run. Cloud-only review is now closed without blockers; root publication and the whole-feature runtime verdict remain pending.
