# Modernize the creator-outreach Cloud Function (TypeScript, Biome, vitest, husky, multi-env CI/CD)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document follows the ExecPlan format defined in `server/.agent/PLANS.md` (the canonical PLANS.md for this project family — read it in full before authoring or executing this plan).

This plan supersedes `crafted_cloud_functions/.agent/exec-plans/creator-outreach-tooling.md` (2026-06-01). That earlier draft chose to keep the function as plain JavaScript with no build step, and treated deploy automation as a non-goal. Both of those decisions are reversed here. The earlier draft is retained for historical context (its GCF constraints are still valid and are carried forward into `Surprises & Discoveries` below) and has been marked superseded at its top.


## Purpose / Big Picture

`crafted_cloud_functions` is a legacy Google Cloud Functions (GCF) repository with no shared tooling: each function has its own isolated `package.json` and `node_modules`, and there is no linting, type-checking, testing, commit standard, or continuous integration. The `creator-outreach` function — which scans the Firebase user base and sends Studio and Amplify outreach emails on behalf of the `server` API — is the designated modern reference. Bringing it up to the standards used by the `crafted-src` monorepo makes it the template we expand to the other functions in a later, separately green-lit effort.

After this change, a reader can:

- Edit any file in `functions/creator-outreach/` in **TypeScript** with full type-checking (`tsc --noEmit`) catching errors before deploy.
- Run `npm run check:ci` (Biome lint + format) and `npm run test:ci` (vitest) at the repo root and see them pass for the function.
- Make a commit and have a `pre-commit` hook run Biome + tests, and a `commit-msg` hook enforce Conventional Commits.
- Open a pull request and see a GitHub Actions workflow run type-check + Biome + vitest + a **buildpack dry-run** that proves the TypeScript-build-at-deploy actually compiles and produces a deployable image — with **no** deploy and **no** cloud credentials.
- Push to `dev` and watch the function auto-deploy as `creator-outreach-dev`; merge to `main` and watch it auto-deploy as `creator-outreach-staging`; and run a **separate, manually triggered** workflow (with a required reviewer) to promote the same source as `creator-outreach-prod`. All three deploy into **one shared hosting GCP project** and are isolated by name (the Firebase data projects stay per-env via `NODE_ENV`).

The scope is **strictly the `creator-outreach` function**. The other nine functions and all seventeen `maintenance/` scripts are explicitly out of scope and remain on the legacy per-directory pattern; migrating them is future work.


## Scope & non-goals

In scope: TypeScript migration of `functions/creator-outreach/` with type-checking; Biome via a shared config; vitest unit tests; husky + commitlint; a PR/build workflow that does not deploy; a build/deploy workflow that deploys on branch push to `dev` (→ dev project) and `main` (→ staging project); a separate manual workflow that deploys to the prod project; GitHub Environments (`dev`/`staging`/`prod`) for env-scoped secrets with a required-reviewer rule on `prod`; and the root npm workspace + Nx scaffolding needed to host all of the above.

Out of scope (future, separately green-lit): the other nine functions and the seventeen `maintenance/` scripts; any change to the runtime behavior of the outreach logic (the migration is behavior-preserving); and the **auth hardening** of the endpoint. Auth is a coordinated cross-repo fast-follow tracked in the companion plan `server/.agent/exec-plans/creator-outreach-auth.md` (Notion ticket [353]); this plan's deploy workflow keeps `--allow-unauthenticated` in place until that fast-follow flips it (see Milestone M12 and the Risks section).


## Progress

- [x] M1: Root workspace scaffolding (`package.json`, `nx.json`, `commitlint.config.js`, `.nvmrc`, `.gitignore` additions). (done 2026-07-24)
- [x] M2: `packages/shared-config/` (Biome config + scoped lint-staged + package.json), mirror of `crafted-src`. (done 2026-07-24)
- [x] M3: TypeScript migration of `functions/creator-outreach/` source (`index.ts`, `function-handler.ts`, `lib/*.ts`) + `tsconfig.json` + build-at-deploy wiring (`gcp-build`, `main`) + regenerated standalone lockfile + `.gcloudignore`. (done 2026-07-24)
- [x] M4: Biome wiring for the function (`biome.json` extends shared-config; `check`/`check:ci`/`lint`/`format` scripts). (done 2026-07-24)
- [x] M5: vitest unit tests under `functions/creator-outreach/__tests__/` (schemas, scanner matchers, email result extraction + Amplify rate calc, handler validate/scan/email/store/respond + logging), mocking the side-effect lib modules. (done 2026-07-24)
- [x] M6: Husky hooks (`pre-commit` → lint-staged + tests; `commit-msg` → commitlint) + commit standards. (done 2026-07-24)
- [x] M7: TS-build-at-deploy feasibility prototype — local `pack build` buildpack dry-run proves `gcp-build` (tsc + template copy) compiles and the image is deployable (promote or discard criteria stated). **PASS** (done 2026-07-24; verdict promoted — see Decision Log + Surprises).
- [x] M8: PR/build workflow `.github/workflows/creator-outreach-build.yml` — `quality` job (Biome + `tsc --noEmit` + vitest) and `build-preview` job (`pack build`); no deploy on pull requests. (done 2026-07-24)
- [x] M9: Multi-env deploy jobs in the same workflow — `deploy-dev` (`dev` branch → function `creator-outreach-dev`) and `deploy-staging` (`main` → function `creator-outreach-staging`), both into the **single shared hosting project** (repo-level `GCP_PROJECT`); GitHub Environments `dev`/`staging` supply the per-env `FIREBASE_SA_KEY` (SendGrid/Sentry are repo-level); materialize the matching Firebase key + `NODE_ENV`. (done 2026-07-24; retargeted to single-project / env-in-name 2026-07-25 — see Decision Log)
- [x] M10: Manual production workflow `.github/workflows/creator-outreach-deploy-prod.yml` — `workflow_dispatch`, environment `prod` (required reviewer), deploys function `creator-outreach-prod` into the shared hosting project, `NODE_ENV=prod`; retire the old single-project `deploy-creator-outreach.yml` (**no-op on this branch — the file does not exist here; see M10 Surprise**). (done 2026-07-24; retargeted 2026-07-25)
- [x] M11: Documentation (final phase, after implementation) — updated `README.md` (creator-outreach infrastructure section: gen2/Cloud Run, single-shared-project env-in-name layout (`creator-outreach-<env>`), CI/CD flow, TS build-at-deploy mechanism, prominent `--allow-unauthenticated` auth model + [353] hardening; copy-pasteable per-env `gcloud functions deploy --gen2` + GitHub-native prod-promotion instructions; corrected stale folder/function list — no `studioOutreach`); added the `CLAUDE.md` "Tooling & Standards (creator-outreach reference)" section (TS-build-at-deploy contract + per-env GCF infra table); wrote release notes with a per-environment deploy checklist (`releases/2026-W30/creator-outreach-modernization.md`) and a manual test suite (`releases/2026-W30/creator-outreach-modernization-test-plan.md`). Locale coverage N/A (infra feature, no localized UI). (done 2026-07-24)
- [ ] M12: Auth-hardening cross-reference — confirm the coordinated fast-follow (server token + drop `--allow-unauthenticated`) is tracked in `server/.agent/exec-plans/creator-outreach-auth.md`; leave `--allow-unauthenticated` in this plan's deploy until then.


## Surprises & Discoveries

These are carried forward from the superseded draft (still valid) plus new findings from re-grounding on 2026-07-24. Each pins a real constraint that shaped the plan.

- Observation: GCF deploy is the **inverse** of the crafted-src Lambda deploy model. crafted-src Lambdas (e.g. `apps/reporting-service`) are esbuild-bundled into a single JS file before deploy, so their `@crafted/shared-config` devDependency never ships. GCF gen2, by contrast, uploads the `--source` directory and runs `npm ci` against the public registry at build time.
  Evidence: `apps/reporting-service/package.json` `build` uses `esbuild ... --bundle --outfile=dist/...`; the existing `.github/workflows/deploy-creator-outreach.yml` uses `gcloud functions deploy --gen2 --source=functions/creator-outreach`.

- Observation: A private workspace package (`@crafted/shared-config`) listed in the function's own `package.json` is a **hard deploy-breaker** — at deploy time `npm ci` cannot resolve a workspace symlink and fails with E404/unresolvable. It must never appear in the function manifest's `dependencies` or `devDependencies`.
  Evidence: The buildpack runs `npm ci` from the uploaded function dir only; the root workspace is not part of the upload.

- Observation: The same rule applies to **any** workspace-relative reference the deploy build touches. In particular, the function's `tsconfig.json` must **not** `extends` a base config from `@crafted/shared-config`, because the `gcp-build` step runs `tsc` at deploy time and would fail to resolve the workspace path. The tsconfig must be self-contained (compiler options inlined).
  Evidence: `apps/reporting-service/tsconfig.json` is self-contained (no `extends`); we mirror that.

- Observation: `lib/firebase.ts`, `lib/sentry.ts`, and `lib/email.ts` have **import-time side effects**. `lib/firebase.js` loads a service-account key and calls `admin.initializeApp` (and throws if the key is absent); `lib/sentry.js` calls `Sentry.init`; `lib/email.js` calls `sgMail.setApiKey` and `Handlebars.compile(fs.readFileSync(...))` at module load. Handler and unit tests must mock these modules, and a naive "boot the function" smoke test in CI would false-fail without credentials.
  Evidence: `lib/firebase.js:31-38` throws when `require(keyPath)` fails; `lib/email.js:13,18-23` run at module load.

- Observation: The pure matchers are module-private. `lib/scanner.js` exports only `scanCreators`; `lib/email.js` exports only `sendOutreachEmails`. The unit-testable pieces (`matchBatchStudio`, `matchBatchAmplify`, `parseFollowerCount`, `extractResults`, and the Amplify suggested-rate calc) are not exported. Tests reach them through the public exports (with Firebase/SendGrid mocked) or via small additive exports added during the TS migration.
  Evidence: `lib/scanner.js:161` (`module.exports = { scanCreators }`), `lib/email.js:162` (`module.exports = { sendOutreachEmails }`).

- Observation: The `functions.http` target is already the canonical kebab-case string `"creator-outreach"`, and `index.js` documents the naming invariant. But the function's `package.json` `dev`/`start` scripts are **stale**: `dev` still targets `creatorOutreach` (camelCase), which would fail to start locally because the registered target is `creator-outreach`. The TS migration must fix this to `--target=creator-outreach`.
  Evidence: `functions/creator-outreach/index.js:8` registers `functions.http("creator-outreach", creatorOutreach)`; `functions/creator-outreach/package.json:7` `dev` runs `functions-framework --target=creatorOutreach`.

- Observation: There is **no `--dry-run`** on `gcloud functions deploy`, and `gcloud` may not be installed in CI or locally. The credential-free way to prove a GCF gen2 deploy will succeed is a Cloud Native Buildpacks build (`pack build`) with the Google builder — it replicates the real build (npm ci, Node version selection, `gcp-build`, entrypoint resolution) without pushing anywhere and without GCP credentials.
  Evidence: Established in the superseded draft; the Google builder image is `gcr.io/buildpacks/builder:google-22`.

- Observation: The current deployed infra is **Gen2 (Cloud Run-backed)**, previously nodejs20, and there is exactly one existing workflow (`deploy-creator-outreach.yml`) which deploys to a single project selected by the `GCP_PROJECT` repo variable on push to `main`, with `--allow-unauthenticated`.
  Evidence: `.github/workflows/deploy-creator-outreach.yml`.

- Observation (2026-07-24, M1): **There is no `.github/` directory in this repo at all** — no `.github/workflows/`, and specifically no `deploy-creator-outreach.yml` on disk on the `dev` base. The workflow referenced in the Surprise above and in M10 must live in the deployed GitHub repository's default branch but is not present in this `dev` worktree. Consequence: **M10's "retire the old single-project `deploy-creator-outreach.yml`" step is a no-op on this branch** — there is nothing to delete here. M8/M9 create `.github/workflows/` from scratch. If the file does exist on the remote default branch, its removal has to be handled there (or it will simply be absent from this branch's tree and superseded once the new workflows land); confirm on the remote before assuming M10 deleted it.
  Evidence: `ls .github` → "No such file or directory"; repo root on `dev` contains only `.agent/`, `functions/`, `maintenance/`, `CLAUDE.md`, `README.md`, `.gitignore`, `.git`.

- Observation (2026-07-24, M2): **`biome check <subdir>` run from the workspace root fails with "Found a nested root configuration, but there's already a root configuration"** — this is inherent Biome 2.3.x monorepo behavior, not a config error, and it **reproduces identically in `crafted-src`** (e.g. `biome check apps/reporting-service` from the crafted-src root errors the same way). A `biome.json` without `"root": false` is a root config; running from the workspace root finds two roots (the workspace root project + the nested config) and refuses. Consequence: Biome must be invoked **per-project with cwd = the project directory** (exactly how Nx runs it via each package's `check`/`lint`/`format` script), where only one config is in scope. This shapes M4 (the function's `check`/`check:ci` scripts run in the function dir) and M8 (CI runs `npm run check:ci` → `nx run-many`, which sets per-project cwd — never a bare `biome check <subdir>` from root). The M2 acceptance ("resolves the extended config") is satisfied by the `node_modules/@crafted/shared-config` symlink + the `./biome` export target both resolving, verified via a per-project `biome check .` inside `packages/shared-config`.
  Evidence: `cd packages/shared-config && biome check .` runs (4 inherent `useBiomeIgnoreFolder` warnings from the verbatim config, no config error); the same command from the worktree root errors; crafted-src reproduces.

- Observation (2026-07-24, M2): The verbatim-copied `packages/shared-config/biome.json` (mirrored from crafted-src) emits 4 `lint/suspicious/useBiomeIgnoreFolder` **warnings** — since Biome 2.2.0 a folder ignore no longer needs a trailing `/**` (`!node_modules/**` → `!node_modules`). These are warnings, not errors, and are **present in crafted-src's own shared-config too**, so the file was kept verbatim to preserve the mirror. If a future cleanup wants a warning-free config, drop the `/**` suffixes in the shared-config `includes` (and propagate to crafted-src to keep them identical).
  Evidence: `cd packages/shared-config && biome check .` → "Found 4 warnings"; identical output in crafted-src's `packages/shared-config`.

- Observation (2026-07-24, M3): **SendGrid's declared `send()` return type is inaccurate for the multiple-send path.** `@sendgrid/mail@7.7.0` types `send(data, isMultiple?)` as resolving to a single `[ClientResponse, {}]` tuple, but with `isMultiple=true` it actually resolves to an **array** of per-message `[response, body]` tuples — which is exactly what `extractResults` iterates (`result.filter(r => r[0].statusCode === 202)`). Resolution: a minimal explicit `SendGridSendResult = Array<[{ statusCode; headers }, unknown]>` types `extractResults`, and the `sgMail.send(...)` result is cast `as unknown as SendGridSendResult` at the two call sites with a comment. This is the sanctioned narrow-cast-at-the-boundary; no `any`, exact runtime behavior preserved.
  Evidence: `node_modules/@sendgrid/mail/src/mail.d.ts` `send(...): Promise<[ClientResponse, {}]>`; the JS treats the result as an array.

- Observation (2026-07-24, M3): **The Firebase service-account load must remain a dynamic `require(keyPath)`** — the path is computed from `NODE_ENV` at runtime, so a static import cannot resolve it. Under `commonjs` + `esModuleInterop` this is fine; `require` is typed via `@types/node`. The `require` result is assigned to `Parameters<typeof admin.credential.cert>[0]` (i.e. `string | ServiceAccount`) rather than a firebase-admin `ServiceAccount` type import — v9 does **not** re-export `ServiceAccount` at `admin.ServiceAccount` or `admin.credential.ServiceAccount` (it lives only at the internal `firebase-admin/lib/credential/index` path), so deriving the type from the `cert` parameter avoids a fragile deep import while staying `any`-free.
  Evidence: `node_modules/firebase-admin/lib/credential/index.d.ts` declares `ServiceAccount` at module top level, outside the `credential` namespace; `firebase-namespace-api.d.ts` never re-exports it.

- Observation (2026-07-24, M4): **Biome's only lint finding on the pre-styled TS was two `lint/complexity/useOptionalChain` *warnings* on `matchBatchStudio`'s `userState`/`userCountry` `&&` chains — deliberately NOT auto-fixed.** The M3 author's TS was already clean except for these; the three "errors" from the first `biome check` were an `organizeImports` assist on `function-handler.ts` and two formatter diffs (a `scanner.ts` line-collapse and the `package.json` 2→4-space reindent), all safe-applied via `biome check --write`. The `useOptionalChain` suggestions are **unsafe** by Biome's own classification and are behavior-changing for untyped Firebase data: `a && a.b && a.b.c()` returns the falsy operand, whereas `a?.b?.c()` short-circuits only on null/undefined and would call `.toUpperCase()` on a non-string falsy value (e.g. a malformed `state: 0`) and throw. They are suppressed with scoped `// biome-ignore` comments (each carrying the why). Placement matters: the flagged expression sits on the *continuation* line of the `const x =` statement, so the ignore comment must go **between** the `=` and the expression (not above the `const`), or Biome reports `suppressions/unused`. After suppression, `biome ci .` is fully clean (0 warnings, 0 errors); the organizeImports reorder is behavior-neutral because it preserves `dotenv/config` first and the relative order of the three side-effecting modules (`lib/email`, `lib/firebase`, `lib/sentry`) — only the side-effect-free `scanner`/`schemas` pair swapped.
  Evidence: `cd functions/creator-outreach && biome ci .` → "Checked 10 files. No fixes applied." exit 0; `lib/scanner.ts:58-63`.

- Observation (2026-07-24, M5): **The handler test must drive the real `cors({origin:true})` middleware, which needs more `res` methods than `status`/`json`.** `creatorOutreach` wraps its body in `corsHandler(req, res, cb)`; for a non-OPTIONS request cors synchronously applies headers then calls the (async) `cb`. Because `origin:true` pushes a `Vary: Origin` header, cors calls the `vary` package against `res`, which reads `res.getHeader("Vary")` and writes `res.setHeader(...)`. So the mock `res` needs `getHeader` (return `undefined`) and `setHeader` (no-op) in addition to `status`/`json`, and the mock `req` needs `method: "POST"` and `headers: {}` (cors reads `req.method` and `req.headers.origin`). The handler itself is fire-and-forget (`HttpFunction` returns void; the async work inside the cors callback is not awaited by cors), so the test resolves a Promise from inside the `res.json` mock — every code path ends in `res.status(...).json(...)`, so that reliably signals completion.
  Evidence: `node_modules/cors/lib/index.js` `configureOrigin` (origin truthy → Vary push) + `applyHeaders` → `vary(res, ...)`; `function-handler.ts:31` `corsHandler(req, res, async () => {...})`.

- Observation (2026-07-24, M5): **SendGrid's multiple-send return shape must be hand-rolled in the mock; there is no importable result type.** `@sendgrid/mail` is mocked as `{ default: { setApiKey: vi.fn(), send: vi.fn() } }` (both are called at module load / send time). `extractResults` iterates `result[i][0].statusCode` / `result[i][0].headers["x-message-id"]`, so a fixture is an array of `[{ statusCode, headers }, body]` tuples — the internal `SendGridSendResult`/`SendGridResponse` types are **not exported** from `lib/email.ts`, so the fixture is a plain literal cast `as never` at the call boundary. `email.test.ts` imports the REAL `lib/email` (only `@sendgrid/mail` + the unused-but-instructed `../lib/firebase` are mocked) so module load runs the real `path.resolve(__dirname, "../templates/*.hbs")` reads against the TS source dir (`functions/creator-outreach/templates/`) — a broken template path throws at import and fails the whole file, which is the template-path regression guard. Both regression guards were demonstrated live: removing the top-level `influencer_campaigns/<id>/invites` write fails the amplify two-path handler test, and repointing the template path fails the email import.
  Evidence: `lib/email.ts:54` (`type SendGridSendResult` not exported), `lib/email.ts:20-25` (module-load template reads).

- Observation (2026-07-24, M3): **Two strict-mode-only transcription adjustments were needed, both provably behavior-neutral.** (1) In `matchBatchAmplify`, `states.includes(influencerState)` fails strict typing because `influencerState` is `string | undefined`; a `states.includes(influencerState as string)` cast is used — `Array.includes(undefined)` still returns `false` at runtime, so behavior is unchanged. (2) In `scanCreators`, the studio-only `taskRegions` fallback was changed from `null` to `[]` so its type is `string[]` (not `string[] | null`); the fallback value is **dead** for amplify (only `matchBatchStudio` reads it, and only on the studio branch), so the observable result is identical. Neither touches a log line, response shape, or Firebase path.
  Evidence: `lib/scanner.ts`; runtime parity confirmed via a node smoke test over the compiled `dist/lib/scanner.js` (matchers, `parseFollowerCount`, rate calc, `extractResults`, schema validation all match the original formulas).

- Observation (2026-07-24, M7 — **the critical-checkpoint proof**): The `pack build` buildpack dry-run against `gcr.io/buildpacks/builder:google-22` **PASSED (exit 0)** with **no cloud credentials**, faithfully replicating the gen2 build: `npm ci` against the standalone nested lockfile → `gcp-build` (tsc + idempotent template copy) → entrypoint resolution → image export. This proves the whole TS-build-at-deploy model works end-to-end. Decisive log lines: `Running "npm ci --quiet --no-fund --no-audit (NODE_ENV=development)"` → `added 394 packages in 5s` → `Done ... (5.07s)`; then `Running "npm run gcp-build"` → `> creator-outreach@1.0.0 build` → `> tsc -p tsconfig.json && mkdir -p dist/templates && cp templates/*.hbs dist/templates/` → `Done "npm run gcp-build" (1.85s)`; then the Functions Framework buildpack ran `node --check dist/index.js` (proving `main: dist/index.js` resolves and the compiled entrypoint is valid) → `Successfully built image 'creator-outreach-dryrun'`. Environment: Docker 29.6.1 present + daemon reachable; `pack` was absent and installed locally (v0.40.8, static binary in a scratch bin dir on PATH, no sudo). The Step-0 idempotent build fix is visible in the deploy-time build command above.
  Evidence: `pack build` exit 0; the log block reproduced verbatim above (npm ci ran, gcp-build/tsc ran, `node --check dist/index.js` passed, image built).

- Observation (2026-07-24, M7): **A local `pack build` does NOT pin the Node minor the way a real `gcloud functions deploy --runtime=nodejs22` does.** The runtime buildpack installed **Node v24.18.0**, not 22 — because `engines.node: ">=22.0.0"` is an open range (the buildpack resolves it to the highest available) and `--env GOOGLE_RUNTIME=nodejs22` selects the OS **stack** (Ubuntu 22.04), not the Node minor. A benign side effect was one `npm warn EBADENGINE` for the transitive `cloudevents@8.0.3` (declares `node >=16 <=22`), which would NOT appear on the real deploy where the platform pins Node to 22.x. This does **not** affect the M7 verdict (gcp-build compiled under ES2022, image built cleanly). Recommendation for M8's CI dry-run to be node-faithful to prod: pass `--env GOOGLE_NODEJS_VERSION=22` on the `pack build` step (or tighten `engines.node`) so the preview builds on the same Node minor that deploys.

- Observation (2026-07-25, first real `dev` deploy — **cold-start crash**): the deployed container failed its healthcheck (`The user-provided container failed to start and listen on PORT=8080`) with `Error: Firebase service account key not found at ".../dist/config/devServiceAccountKey.json"`. Root cause: after the TS migration `lib/firebase.ts` resolves the key via `path.resolve(__dirname, "..", keyFile)`, and at runtime `__dirname` is `dist/lib`, so it looks in `dist/config/` — but `gcp-build` only copied `templates/` into `dist/`, never `config/`. The exact dist-copy that fixed the templates was missing for the Firebase key. **Fix:** `gcp-build` now also copies `config/*.json` into `dist/config/` (guarded with a subshell `(cp … || true)` so keyless builds and the `pack` dry-run still pass, without masking real `tsc`/template failures). **Why M7 missed it:** the `pack build` proof ran `node --check dist/index.js`, which only parses syntax — it never *executes* the module, so `lib/firebase.ts`'s import-time key load never ran. The real regression guard is a cold-start smoke test (boot `functions-framework --target=creator-outreach` with a dummy key + `curl :8080`); verified manually for this fix and recommended as a CI step in `build-preview`.
  Evidence: build log `Installing Node.js v24.18.0.` under `google.nodejs.runtime@1.0.0`; `GOOGLE_RUNTIME=nodejs22` passed as an env var yet Node floated to 24 via the open `engines` range.

- Observation (2026-07-24, M6): **husky v9 hook files are just the command(s) — no shebang, no `_/husky.sh` sourcing shim — and do NOT need the executable bit.** The `prepare: husky` install writes `.husky/_/` (the `h` wrapper + per-hook stubs) and points `core.hooksPath` at `.husky/_`; git fires `.husky/_/<hook>`, which sources `h` and runs the user's `.husky/<hook>` via `sh -e "$s"`. Because it's `sh -e`, the user hook is executed by the interpreter, not exec'd directly, so the `+x` bit is irrelevant — crafted-src's `.husky/pre-commit`/`.husky/commit-msg` are mode `664` (non-executable), and these mirror that. `core.hooksPath` is shared config, and `prepare` already ran in this worktree's `npm install`, so no re-init was needed.
  Evidence: `.husky/_/h` ends in `sh -e "$s" "$@"`; `.husky/_/pre-commit` is `. "$(dirname "$0")/h"`; crafted-src hooks are `stat` mode `664`.

- Observation (2026-07-24, M6 — **corrected M2's lint-staged wiring**): **The M2 shared config's path-prefixed globs (`functions/creator-outreach/**` + `packages/**`) in a *single root* `.lintstagedrc` are incompatible with this repo's Biome setup.** A root `.lintstagedrc.mjs` re-exporting them makes lint-staged run `biome check --write <file>` with cwd = the repo root, which triggers the exact "Found a nested root configuration, but there's already a root configuration" error documented in the M2 Biome Surprise — biome treats the repo root as an implicit root and then finds `functions/creator-outreach/biome.json` (a second root) → hard fail. Verified: staging a sibling file was correctly *ignored* (scoping held), but staging a real `functions/creator-outreach/*.js` file made lint-staged **fail** (exit 1) — i.e. the single-root design would block every legitimate creator-outreach commit. Resolution: mirror `crafted-src`'s **per-package** wiring exactly — shared `lint-staged.mjs` reverted to crafted-src's verbatim bare-glob form (`*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}`), and a `.lintstagedrc.mjs` placed in each linted workspace member (`functions/creator-outreach/`, `packages/shared-config/`) re-exporting it. lint-staged then runs biome with cwd = the member dir (only one biome config in scope → no conflict), and scoping stays absolute via config *placement*: sibling `functions/*` dirs have no `.lintstagedrc.mjs`, so their files are never matched. No root `.lintstagedrc` exists (crafted-src has none). Verified all three cases: sibling → "No staged files match any configured task" (unchanged); `functions/creator-outreach/` → matched + reformatted, exit 0; `packages/shared-config/` → matched + reformatted, exit 0.
  Evidence: single-root run → `biome.json configuration ... Found a nested root configuration ...` exit 1; per-package run → `[COMPLETED] biome check --write` exit 0 with `functions/creator-outreach/.lintstagedrc.mjs — 1 file` grouping; sibling run → `No staged files match any configured task`.


- Observation (2026-07-24, M8): **The CI `build-preview` `pack build` carries the M7 Node-pin fix** — `--env GOOGLE_NODEJS_VERSION=22` is added alongside `GOOGLE_RUNTIME=nodejs22` so the preview builds on Node 22.x (matching the pinned deploy runtime) rather than floating to Node 24 via the open `engines.node` range (see the M7 Node-minor Surprise). The `pack` CLI is pinned to **v0.40.8** (the version proven in the M7 dry-run) and installed to `/usr/local/bin` on the runner; GitHub-hosted `ubuntu-latest` ships Docker, which `pack build` requires. A workflow-level `permissions: contents: read` is set (least-privilege): the deploy jobs authenticate to GCP with a downloaded SA-key JSON via `google-github-actions/auth@v2` (per the Secrets & Variables Matrix), not GitHub OIDC, so no `id-token: write` permission is needed.
  Evidence: `.github/workflows/creator-outreach-build.yml` `build-preview` step; M7 Surprise on the Node-minor float; `actionlint` v1.7.7 + PyYAML both parse the file clean.

- Observation (2026-07-24, M9): **`env.yaml` is written at the repo root, not inside `functions/creator-outreach/`.** `--env-vars-file` is read locally by `gcloud` at deploy time and is NOT part of the `--source` upload, so writing it at root keeps it out of the buildpack input entirely (the function's `.gcloudignore` already excludes `env.yaml` as a belt-and-suspenders guard, but root placement means it never enters the source dir). The Firebase Admin key, by contrast, **must** land inside `functions/creator-outreach/config/<env>ServiceAccountKey.json` because it is loaded by the deployed runtime (`lib/firebase.ts`) — `config/` is gitignored but is part of the uploaded source. Secrets are materialized only via step-level `env:` blocks and referenced as `$VAR` (`printf '%s' "$FIREBASE_SA_KEY" > …` for the key; unquoted-heredoc `${SENDGRID_API_KEY}`/`${SENTRY_DSN}` expansion for `env.yaml`) — no secret value ever appears inline in a `run:` line. `${{ vars.GCP_REGION || 'us-central1' }}` gives the region variable a safe hardcoded fallback.
  Evidence: `.github/workflows/creator-outreach-build.yml` `deploy-dev`/`deploy-staging`; both jobs `needs: [quality, build-preview]` and are branch-guarded (`github.ref_name == 'dev'` / `github.ref == 'refs/heads/main'`) so neither runs on a pull_request.

- Observation (2026-07-24, M10 — **the "retire the old workflow" step is a confirmed no-op on this branch**): `.github/workflows/deploy-creator-outreach.yml` does **not** exist on `feature/creator-outreach-modernization` (nor was there any `.github/` directory before M8 — see the M1 Surprise). It was neither found in the working tree nor in the locally available `origin/dev` / `origin/main` refs. There is therefore nothing to delete here; the new `creator-outreach-build.yml` + `creator-outreach-deploy-prod.yml` supersede it by name. If the file still lives on the deployed default branch, its removal is handled at merge time on that branch — it will simply be absent from this branch's tree. The manual prod workflow's `prod` GitHub Environment required-reviewer gate is an out-of-band repo setting (Settings → Environments → prod), not expressible in the workflow YAML; it is referenced in a top-of-file comment anchored to this ExecPlan's Secrets & Variables Matrix. `concurrency` on the prod workflow uses `cancel-in-progress: false` so a queued promotion is never cancelled mid-deploy.
  Evidence: `ls .github/workflows/deploy-creator-outreach.yml` → absent; `git ls-tree -r origin/dev` → no match; `.github/workflows/creator-outreach-deploy-prod.yml` header comment.

## Decision Log

- Decision: **Keep the current gating model (Option B) — dev/staging auto-deploy on branch push within `creator-outreach-build.yml`; prod stays a separate `workflow_dispatch` (`creator-outreach-deploy-prod.yml`) for on-demand promotion of an arbitrary ref — and harden it rather than restructure it.** Add a `cold-start-smoke` job (boots the compiled function, gates `deploy-dev`/`deploy-staging`) and a prod rollback-on-failure step; do **not** merge the two workflows.
  Rationale: On-demand prod promotion is the point of the separate workflow — an operator promotes a validated SHA/tag when they choose, with the run's status isolated from the dev/staging build run and the `prod` Environment's required-reviewer gate applied only there. The alternative (one workflow with a gated prod job) was rejected because the "concurrency cancels a pending approval" failure mode — where a newer push to the shared workflow cancels an in-progress run that is paused at the prod approval — **does not apply here**: prod lives in its own workflow with its own `concurrency` group (`cancel-in-progress: false`), so a dev/staging push can never cancel a queued prod approval. The hardening closes the two real gaps this model had: (1) `node --check` in `build-preview` parses but never executes the module, so it cannot catch an import-time throw (it missed the PR #14 Firebase key-path break) — the `cold-start-smoke` job boots `functions-framework` against the compiled `dist/` with a dummy key and fails the deploy if the module never listens; (2) a failed prod rollout now has an explicit traffic-revert belt-and-suspenders on top of Cloud Run's native last-good-revision behavior.
  Date/Author: 2026-07-27, cloud-engineer

- Decision: **One shared hosting GCP project for all three environments; encode the environment in the deployed function name (`creator-outreach-dev` / `-staging` / `-prod`), not in the project.** The in-code `functions.http` target and the gcloud `--entry-point` stay the single string `creator-outreach`; only the deployed function NAME gets the env suffix. `GCP_PROJECT`, `GCP_SA_KEY`, and `GCP_REGION` become **shared repo-level** config (one hosting project ⇒ one deploy SA ⇒ one region). This **supersedes the earlier decision (below) that deployed to three separate hosting projects** (`crafted-dev-v1` / `crafted-staging-v1` / `crafted-v1`) selected by per-env `GCP_PROJECT`.
  Rationale: same project, isolated by name — three functions in one project cost nothing extra, remove the per-env project/deploy-SA sprawl (one SA, one region, one `GCP_PROJECT` variable), and keep environments cleanly separated by the `creator-outreach-<env>` name. **The Firebase DATA projects remain per-env** (`crafted-dev-v1` / `crafted-staging-v1` / `crafted-v1`), still selected at runtime by `NODE_ENV` + the per-env `FIREBASE_SA_KEY` in `lib/firebase.ts` — only the function *hosting* project is collapsed to one; the databases are untouched. The three GitHub Environments (`dev`/`staging`/`prod`) are kept for the per-env `FIREBASE_SA_KEY` and the `prod` required-reviewer gate on the manual promotion (`SENDGRID_API_KEY`/`SENTRY_DSN` were moved to repo-level in the 2026-07-25 secrets-simplification entry below). `NODE_ENV` per deploy is unchanged (drives Firebase project/RTDB/key + Sentry environment). Gen2 build-at-deploy via `gcp-build` is unchanged.
  Date/Author: 2026-07-25, cloud-engineer

- Decision: **Simplify the secrets model — `SENDGRID_API_KEY` and `SENTRY_DSN` become repo-level secrets; `FIREBASE_SA_KEY` is the only per-env secret.** The two runtime keys are **identical across all environments**, so they are set once at the repository level rather than duplicated into each of the three GitHub Environments. `FIREBASE_SA_KEY` stays per-env (the dev/staging/prod Firebase data projects genuinely differ). The three GitHub Environments are still kept — now carrying only `FIREBASE_SA_KEY` plus the `prod` required-reviewer gate.
  Rationale: **identical across envs ⇒ repo-level** — duplicating the same SendGrid key and Sentry DSN into three Environments is pure maintenance overhead with no isolation benefit, and it drifts silently the day someone updates one and forgets the others. One DSN still separates events by environment because `lib/sentry.ts` sets Sentry's `environment` from `NODE_ENV` (set per deploy) within a single Sentry project. **No workflow change is needed**: the steps already reference `${{ secrets.SENDGRID_API_KEY }}` / `${{ secrets.SENTRY_DSN }}`, and GitHub resolves `secrets.*` as environment → repository, so a repo-level value is picked up even by jobs that declare `environment:`. Escape hatch: if one env ever needs a different value, add an environment-level secret of the same name — it overrides the repo-level one. Trade-off (accepted): repo-level secrets are readable by all repo workflow jobs (incl. the PR quality/build-preview jobs), not just jobs targeting a given environment — acceptable for these runtime keys. This refines the 2026-07-25 single-shared-project decision above; the Secrets & Variables Matrix, `README.md`, `CLAUDE.md`, and the release notes / test plan were updated to match.
  Date/Author: 2026-07-25, cloud-engineer

- Decision: **Reverse the plain-JavaScript decision — migrate `creator-outreach` to TypeScript** with strict type-checking (`tsc --noEmit` in CI).
  Rationale: The superseded draft avoided a build step by staying on plain JS. That optimized for "wrap existing JS in tooling" at the cost of type safety and alignment with `crafted-src`, where every app is strict TypeScript. The function is small, self-contained, and behavior-stable, which makes it a low-risk, high-value first TS migration and a truthful template for the rest of the fleet. The only real obstacle — that GCF runs `npm ci` on the uploaded source and therefore needs the build to happen at deploy — is solved cleanly by the `gcp-build` mechanism (below), which the superseded draft did not explore because it had ruled out TS. This reversal is the core of the plan.
  Date/Author: 2026-07-24, tech-lead

- Decision: **Reverse the "deploy automation is a non-goal" decision — automate deploys on branch push, with a separate manual production promotion.** Push to `dev` deploys to `crafted-dev-v1`; merge to `main` deploys to `crafted-staging-v1`; a separate `workflow_dispatch` workflow promotes to `crafted-v1`. **(Deploy-automation shape still holds; the three-separate-hosting-projects target is SUPERSEDED by the 2026-07-25 single-shared-project / env-in-name decision above.)**
  Rationale: The superseded draft left deploy manual and gated CI at a dry-run. Manual `gcloud` deploys are error-prone (wrong project, wrong `NODE_ENV`, forgotten key) and do not scale to a fleet. The crafted-src model (`convert-build.yml` deploy-dev/deploy-staging + `convert-deploy-prod.yml` manual) is proven in this org and is mirrored here, substituting `gcloud functions deploy --gen2` for the AWS/Pulumi steps. Manual prod with a required reviewer preserves the human gate where it matters.
  Date/Author: 2026-07-24, tech-lead

- Decision: **TS build-at-deploy mechanism = `gcp-build` npm script running `tsc` + a template copy, with `main` pointing at `dist/index.js`.** The function's `package.json` gets `"main": "dist/index.js"` and `"gcp-build": "npm run build"`, where `build` is `tsc -p tsconfig.json && cp -R templates dist/templates`.
  Rationale: The GCF gen2 buildpack automatically runs a `gcp-build` script (if present) after `npm ci`, with devDependencies available, before producing the runtime image. This is the documented, idiomatic way to ship a TypeScript GCF function: the deploy stays a plain `gcloud functions deploy --source=<dir>` with no committed build artifacts and no change to the deploy command. `main: dist/index.js` tells the functions-framework which module to load; the registered target `"creator-outreach"` is found inside it. Alternatives rejected: (a) **commit compiled JS** — pollutes the repo with generated artifacts and invites source/build drift; (b) **pre-build in CI and deploy `dist/` as the source** — changes the deploy source shape, needs a staging directory, and still needs a lockfile for the runtime `npm ci`; (c) **esbuild single-file bundle** (the Lambda pattern) — non-idiomatic for GCF buildpacks and it breaks the Handlebars template reads, which use `path.resolve(__dirname, "../templates/...")` and `fs.readFileSync` at module load. The `gcp-build` approach keeps TS as the single source of truth and is fully validated by the M7 `pack build` dry-run before any real deploy.
  Date/Author: 2026-07-24, tech-lead

- Decision: **PROMOTE the `gcp-build` TS-build-at-deploy prototype — M7 critical checkpoint PASSED.** The `pack build … --builder gcr.io/buildpacks/builder:google-22 --env GOOGLE_FUNCTION_TARGET=creator-outreach --env GOOGLE_RUNTIME=nodejs22` dry-run exited 0 with no cloud credentials, running `npm ci` against the nested lockfile, then `gcp-build` (`tsc` + the idempotent template copy), then `node --check dist/index.js` (entrypoint resolution), then a successful image export. The default `gcp-build` path is confirmed viable; the pre-built-`dist/` fallback (Risks) is **not** needed and stays unused. The plan continues from M8 on this mechanism.
  Rationale: The whole TS migration rested on the unproven assumption that the GCF gen2 buildpack runs `gcp-build` at deploy. M7 removes that risk with a credential-free build that reproduces the real gen2 pipeline. Carry-forward for M8: the CI `build-preview` job runs exactly this `pack build`, and (to be node-faithful to the pinned prod runtime) should add `--env GOOGLE_NODEJS_VERSION=22` so the preview builds on Node 22.x rather than letting the open `engines.node` range float to Node 24 (see the M7 Surprise). Also fixed in this milestone (Step 0): the `build` script is now idempotent (`mkdir -p dist/templates && cp templates/*.hbs dist/templates/`) so repeated local builds don't nest `dist/templates/templates/`; no new function dependency was added, so the deploy-time `gcp-build` toolchain is unchanged.
  Date/Author: 2026-07-24, cloud-engineer (M7 implementation)

- Decision: **Copy `templates/` into `dist/templates/` as part of the build**, and keep the `../templates` relative path in `lib/email.ts`.
  Rationale: `tsc` with `outDir: dist` compiles `lib/email.ts` → `dist/lib/email.js`, whose `__dirname` is `dist/lib`; `path.resolve(__dirname, "../templates/...")` then resolves to `dist/templates`. Without copying the `.hbs` files there, the module-load `readFileSync` throws at cold start. The `cp -R templates dist/templates` in `build`/`gcp-build` makes the path resolve correctly in the built output. This is a real cold-start footgun that the M7 dry-run and the M5 handler test guard against.
  Date/Author: 2026-07-24, tech-lead

- Decision: **All build tooling that the deploy build needs lives in the function's own `package.json` devDependencies, from the public registry only** — `typescript`, `@types/node`, `@types/cors`, and `vitest`. **Never `@crafted/shared-config`.** The function's `tsconfig.json` is self-contained (no `extends`).
  Rationale: `gcp-build` runs `tsc` at deploy, so `typescript` and the `@types` it needs must be resolvable by the deploy-time `npm ci` from the public registry. A private workspace dep or a workspace-relative `tsconfig extends` would break `npm ci` at deploy. Biome resolves its `@crafted/shared-config/biome` extends at dev/CI time from the root-hoisted `node_modules` (the workspace symlink), so Biome does not need to be listed as a function dependency and `biome.json` is excluded from the deploy upload anyway.
  Date/Author: 2026-07-24, tech-lead

- Decision: **Regenerate and commit a standalone `functions/creator-outreach/package-lock.json`** that includes the new devDependencies and resolves entirely from the public registry (no workspace links). This nested lockfile is the deploy contract — GCF's `npm ci` uses it.
  Rationale: The superseded draft's rule "never change the nested lockfile / no devDeps" was tied to the plain-JS decision. TS requires devDeps, so the lockfile must change. Because the function is a workspace member, a root `npm install` writes only the root lockfile and does not maintain the nested one, so the nested lockfile must be regenerated deliberately (see Concrete Steps for the temp-directory method) and kept in sync whenever deps change. The M7/M8 `pack build` runs `npm ci` and will fail the PR if the nested lockfile drifts from the manifest — that gate is what keeps this honest.
  Date/Author: 2026-07-24, tech-lead

- Decision: **Keep `creator-outreach` as an explicit single workspace member** (`workspaces: ["packages/*", "functions/creator-outreach"]`), not `functions/*`, and **scope Biome/lint-staged to `creator-outreach` + `packages/` only.**
  Rationale: A `functions/*` glob or a broad Biome glob would pull in / reformat the twenty-six un-migrated sibling manifests and files, violating the "only creator-outreach now" scope. Expand the array per function as each is migrated later. (Carried forward from the superseded draft; still correct.)
  Date/Author: 2026-07-24, tech-lead

- Decision: **Achieve lint-staged scoping via per-package `.lintstagedrc.mjs` placement (crafted-src's mechanism), not via path-prefixed globs in a single root config.** The shared `lint-staged.mjs` carries crafted-src's verbatim bare glob (`*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}` → `biome check --write --files-ignore-unknown=true`); a `.lintstagedrc.mjs` re-exporting it is placed in `functions/creator-outreach/` and `packages/shared-config/`. There is no root `.lintstagedrc`.
  Rationale: The M2-era single-root config with path-prefixed globs failed at first use in M6 — a root-cwd `biome check` hits Biome's "nested root configuration" conflict (same constraint as the M2 Biome Surprise), which would block every real creator-outreach commit. Per-package config placement makes lint-staged run biome with cwd = the member dir (one biome config in scope, no conflict) and keeps scoping absolute: sibling `functions/*` dirs have no `.lintstagedrc.mjs`, so their staged files are never matched. This mirrors crafted-src exactly. See the M6 Surprise for the full evidence.
  Date/Author: 2026-07-24, cloud-engineer (M6 implementation)

- Decision: **`prepare: husky` lives only in the root `package.json`, never in the function manifest.**
  Rationale: A `prepare` script in the function would run during the GCF build (which has no `.git`) and can fail the deploy. (Carried forward; still correct.)
  Date/Author: 2026-07-24, tech-lead

- Decision: **Runtime stays nodejs22**, consistently across the `engines` field, `.nvmrc`, `tsc` target (ES2022), the `pack build` builder (`google-22`), and all `gcloud functions deploy --runtime=nodejs22` invocations.
  Rationale: Aligns with `crafted-src` (Node 22) and the existing deploy workflow; the dry-run must build on what actually deploys, so all must agree. (Carried forward; still correct.)
  Date/Author: 2026-07-24, tech-lead

- Decision: **CI runs an explicit `tsc --noEmit` typecheck**, in addition to Biome and vitest — even though the crafted-src `reporting-service` (which builds via esbuild) does not run a standalone typecheck.
  Rationale: The task requires type-checking in CI, and correctness comes first. esbuild transpiles without full type-checking; `tsc --noEmit` is the gate that actually enforces types. This is a deliberate improvement over the reporting-service precedent.
  Date/Author: 2026-07-24, tech-lead

- Decision: **Defer auth hardening to a coordinated fast-follow**; this plan's deploy keeps `--allow-unauthenticated`.
  Rationale: Removing public access requires the `server` to attach a Google-signed OIDC token first, or every blast 403s. That is a cross-repo change (Notion ticket [353]) owned by `server/.agent/exec-plans/creator-outreach-auth.md`. Shipping the modernization without breaking the running integration is the priority; the auth flip is sequenced separately so CF and server ship together. See Risks.
  Date/Author: 2026-07-24, tech-lead

- Decision: **Add a root `typecheck` npm script (`nx run-many -t typecheck`) and a cacheable `typecheck` Nx targetDefault** — neither exists in the mirrored `crafted-src` root (its Lambdas type-check implicitly via esbuild/`tsc` in their own `build`).
  Rationale: This is required plumbing for the plan's own CI. M8's `quality` job runs `npm run typecheck` at the repo root, and M3 adds a `typecheck` script to the function manifest. The root `nx run-many -t typecheck` is the only wiring that lets the root command fan out to the function's `tsc --noEmit`; without the root script and its cacheable targetDefault the CI step has nothing to invoke. Adding it now (M1) keeps the scaffolding complete before M3/M8 depend on it.
  Date/Author: 2026-07-24, cloud-engineer (M1 implementation)


## Outcomes & Retrospective

Entry (2026-07-24, M11 — closing milestone). M1–M11 are implemented and committed on
`feature/creator-outreach-modernization`; M12 (auth hardening) remains explicitly out of scope for
this run.

**What shipped (M1–M11).** `functions/creator-outreach/` is now strict TypeScript built at deploy
via a `gcp-build` script (`tsc` + `templates/*.hbs` → `dist/templates/`; `main: dist/index.js`),
with a self-contained `tsconfig.json` and a standalone nested `package-lock.json` — the deploy
contract that keeps the private `@crafted/shared-config` workspace dep out of the function
manifest. Tooling mirrors `crafted-src`: a root npm workspace + Nx, `packages/shared-config/`
(Biome + per-package lint-staged), Biome via `extends`, vitest unit tests (schemas, scanner
matchers, email result/rate extraction, handler validate/scan/email/store/respond + logging), and
husky + commitlint (`prepare: husky` root-only). CI/CD is two workflows:
`creator-outreach-build.yml` (`quality` = Biome + `tsc --noEmit` + vitest; `build-preview` =
`pack build` dry-run; branch-guarded `deploy-dev` → function `creator-outreach-dev`,
`deploy-staging` → function `creator-outreach-staging`) and `creator-outreach-deploy-prod.yml`
(`workflow_dispatch` → function `creator-outreach-prod`, `prod` Environment required-reviewer
gate) — all three into one shared hosting project, isolated by name (Firebase data projects stay
per-env via `NODE_ENV`). M11 documented all of it: the `README.md`
infrastructure + manual-deploy sections, the `CLAUDE.md` tooling section, release notes with a
per-env deploy checklist, and a manual test suite.

**The proven build model.** M7 was the critical checkpoint: a credential-free `pack build` against
`gcr.io/buildpacks/builder:google-22` ran `npm ci` → `gcp-build` (tsc + template copy) →
`node --check dist/index.js` → image export, exit 0. That removed the plan's highest risk (that
the GCF Gen2 buildpack runs `gcp-build` at deploy) before any real deploy, and the same `pack build`
gates every PR (`build-preview`), so lockfile drift or a broken template path fails the PR rather
than a deploy.

**Against the plan's Purpose.** The Purpose set five reader-facing outcomes — edit in TypeScript
with `tsc` catching errors; run `check:ci`/`test:ci`; commit through the hooks; open a PR that runs
typecheck + Biome + vitest + a credential-free buildpack dry-run with no deploy; and per-branch
deploys of `creator-outreach-<env>` into one shared hosting project with a manual prod promotion.
All five are implemented in the tree and
documented so a novice can go clone → green PR → dev deploy, and understand the manual per-env
deploy and the prod promotion, from the docs alone. Scope held: only `creator-outreach` was
migrated; the other nine functions and the `maintenance/` scripts remain legacy per-directory JS.

**Auth posture (deliberate).** The function ships with `--allow-unauthenticated` (public `allUsers`
invoker) in all three environments — preserved intentionally so the running `server` → CF
fire-and-forget integration keeps working. This is documented prominently in `README.md`,
`CLAUDE.md`, and the release notes, with the org-policy risk called out.

**What remains.**
- **M12 (out of scope for this run):** the auth-hardening fast-follow — `server` attaches a
  Google-signed OIDC token (audience = the CF URL), the server's invoker SA gets
  `roles/run.invoker`, and only then is `--allow-unauthenticated` removed, CF and server shipping
  together. Tracked in `server/.agent/exec-plans/creator-outreach-auth.md` (Notion ticket [353]).
- **Live post-push verification:** this run did not push or deploy. The operator performs the
  deploy-checklist steps (configure the three GitHub Environments + secrets/variables + the `prod`
  required reviewer; grant the deploy-SA IAM roles; push `dev`/`main`; run the manual prod
  workflow) and the live URL checks (Studio 200 / Amplify 200 / invalid 400) per the release notes
  and manual test suite. The org-policy interaction with `--allow-unauthenticated` (ExecPlan Risks)
  is verified for real only at the first dev deploy.


## Context and Orientation

This work happens in the `crafted_cloud_functions` repository (its own git repo; branch flow `dev → main`). A reader new to the repo needs the following.

### What the function does today

`functions/creator-outreach/` is a single HTTP-triggered GCF gen2 function. The `server` API calls it fire-and-forget when a brand starts a Studio or Amplify creator blast. Its flow is CORS → validate (Zod) → scan the Firebase `users` collection in pages of 100 → send personalized SendGrid emails → store the blast results in Firebase → respond. The current files (all CommonJS plain JavaScript):

- `index.js` — GCF registration. Requires `creatorOutreach` from `./function-handler` and calls `functions.http("creator-outreach", creatorOutreach)`. The registered target string, the gcloud `--entry-point`, and the deployed function name must all be the identical string `"creator-outreach"` (a mismatch deploys but fails at cold start with "Function ... is not defined in the provided module"). The imported handler identifier stays the valid JS/TS identifier `creatorOutreach`. **Both of these must survive the TS migration unchanged.**
- `function-handler.js` — exports `creatorOutreach(req, res)`. Wraps everything in `cors`, `safeParse`s against `outreachRequestSchema`, logs a start line, calls `scanCreators`, `sendOutreachEmails`, then `storeResults` (Studio writes `tasks/{task.uid}/invites`; Amplify does an atomic two-path update to `brands/{brand_id}/influencer_campaigns/{campaign_id}/invites` and `influencer_campaigns/{campaign_id}/invites`), logs a completion line, and responds. On a thrown error it calls `Sentry.captureException` and returns 500.
- `lib/schemas.js` — Zod discriminated union `outreachRequestSchema` over `product` ("studio" | "amplify"), each branch `.passthrough()`.
- `lib/scanner.js` — batched user scan (`scanCreators`) plus the private matchers `matchBatchStudio`, `matchBatchAmplify`, and `parseFollowerCount`.
- `lib/email.js` — `sendOutreachEmails` (routes to `sendStudioEmails`/`sendAmplifyEmails`), plus private `fetchBrandData`, `fetchAdminPrices`, `extractResults`, and the Amplify suggested-rate calculation. Handlebars templates compile at module load from `../templates/*.hbs`.
- `lib/firebase.js` — selects a Firebase project by `NODE_ENV` (`dev`/`staging`/`prod`), loading `config/devServiceAccountKey.json` / `config/stagingServiceAccountKey.json` / `config/serviceAccountKey.json` (the `config/` directory is gitignored) and calling `admin.initializeApp`. Throws on an unknown `NODE_ENV` or a missing key.
- `lib/sentry.js` — `Sentry.init` at module load, `environment` set from `NODE_ENV`.
- `templates/StudioBriefInvite.hbs`, `templates/CampaignInviteInNetwork.hbs`.
- `package.json` (8 runtime deps: `@google-cloud/functions-framework`, `@sendgrid/mail`, `@sentry/node`, `cors`, `dotenv`, `firebase-admin`, `handlebars`, `zod`), `package-lock.json`, `.env.example`, and a `.gcloudignore` (currently excludes `.git`, `.gitignore`, `node_modules/`, `.env`, `*.log`, `env.yaml`).

The repo root currently has no `package.json`, no `nx.json`, no `.husky/`, no `commitlint.config.js`, and no Biome config — the workspace scaffolding is greenfield. The only workflow present is `.github/workflows/deploy-creator-outreach.yml` (single-project, push-to-main, `--allow-unauthenticated`), which this plan retires in M10.

### The crafted-src tooling to mirror

Read these in `crafted-src/` and reproduce their structure (not their AWS/Pulumi specifics):

- Root `package.json`: `private`, `workspaces`, devDeps `@biomejs/biome 2.3.15`, `@commitlint/cli`/`@commitlint/config-conventional ^19.8.0`, `commitizen`/`cz-conventional-changelog`, `husky ^9.1.7`, `lint-staged ^15.5.1`, `nx ^22.5.0`, `rimraf`, `typescript ^5.8.2`; scripts `prepare: husky`, `lint`/`format`/`check`/`check:ci`/`test`/`test:ci` (each `nx run-many -t <target>`), `commitlint`, `cz`, `lint-staged`; `config.commitizen` block; `packageManager npm@10.9.2`.
- `packages/shared-config/biome.json`: 4-space indent, `lineWidth 120`, double quotes, `recommended` rules, `$schema` 2.3.15, `includes` ignoring `node_modules`/`dist`/`build`. Members extend it via `"extends": ["@crafted/shared-config/biome"]` (see `apps/reporting-service/biome.json`).
- `.husky/pre-commit` = `npm run lint-staged` then `npm run test`; `.husky/commit-msg` = `npm run commitlint ${1}`.
- `apps/reporting-service/tsconfig.json`: `target ES2022`, `module commonjs`, `outDir ./dist`, `strict`, `esModuleInterop`, `skipLibCheck`, `resolveJsonModule`, `types ["node"]`, `exclude ["node_modules","dist","**/*.test.ts"]`. Mirror this (self-contained, no `extends`).
- CI: `.github/workflows/reporting-service-build.yml` and `convert-build.yml` — path-filtered `push` + `pull_request` to `dev`/`main` + `workflow_dispatch`; a `build` job (`actions/setup-node@v4` node 22 + npm cache → `npm ci --no-audit` → `npm run check:ci` → `npm run test:ci` → build); then `deploy-dev` (`if: github.ref_name == 'dev'`, `environment:`) and `deploy-staging` (`if: github.ref == 'refs/heads/main'`, `environment:`).
- Manual prod: `.github/workflows/convert-deploy-prod.yml` / `reporting-service-deploy-prod.yml` — `workflow_dispatch` only, `environment: <app>-prod`, env-scoped secrets.

### How the TS-build-at-deploy works (the critical mechanism, in plain terms)

"Buildpack" = a build system (Cloud Native Buildpacks) that turns source code into a runnable container image without a Dockerfile. GCF gen2 uses Google's buildpack under the hood. When you run `gcloud functions deploy --gen2 --source=functions/creator-outreach`, GCF uploads that directory (minus `.gcloudignore` entries), then the Node.js buildpack:

1. Runs `npm ci` using the uploaded `package-lock.json` (this is why the nested lockfile must be valid and public-registry-only).
2. Because a `gcp-build` script is present, runs it with devDependencies available. Our `gcp-build` runs `tsc` (compiling `*.ts` → `dist/*.js`) and copies `templates/` into `dist/templates/`.
3. Reads `main` from `package.json` (`dist/index.js`) to know which module the functions-framework should load, and finds the registered target `"creator-outreach"` inside it.

The credential-free proof that all three steps succeed is `pack build <name> --path functions/creator-outreach --builder gcr.io/buildpacks/builder:google-22 --env GOOGLE_FUNCTION_TARGET=creator-outreach --env GOOGLE_RUNTIME=nodejs22` (build only, no `--publish`). If that succeeds locally or in CI, a real deploy will build.

### GCF infra (Gen2 / Cloud Run-backed) — per environment

One shared hosting project holds all three environments; the environment is encoded in the deployed function name. The shape is identical across environments; only the deployed name, `NODE_ENV`, and Firebase key differ.

| Setting | Value |
|---|---|
| Generation | Gen2 (Cloud Run-backed) |
| Runtime | nodejs22 |
| Region | `us-central1` |
| Entry point / in-code target | `creator-outreach` (identical; unchanged per deploy) |
| Deployed function name | `creator-outreach-<env>` (`creator-outreach-dev` / `-staging` / `-prod`) |
| Hosting GCP project | single shared project (repo-level `GCP_PROJECT`) for all 3 envs |
| Trigger | HTTP |
| Resources / concurrency / timeout / max-instances | 2 vCPU, 4Gi, concurrency 1, 3600s, max 50 (keep current shape) |
| Runtime service account | default compute `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com` |
| Runtime env | `NODE_ENV=<dev|staging|prod>`, `LOG_EXECUTION_ID=true` |
| Firebase **data** project (per `NODE_ENV`, in `lib/firebase.ts`) | `crafted-dev-v1` (project number `321295875407`) / `crafted-staging-v1` / `crafted-v1` — still per-env; NOT the deploy `--project` |


## Plan of Work

Work in a dedicated worktree off `dev` (`.tools/wt-new --repo crafted_cloud_functions --type feature --name creator-outreach-modernization`, or the manual worktree recipe from the root `CLAUDE.md`). Commit after each milestone. Each milestone is independently verifiable.

### M1 — Root workspace scaffolding

Create at the repo root: `package.json` (`private`, `workspaces: ["packages/*", "functions/creator-outreach"]`, the crafted-src devDeps listed in Context, scripts mirroring crafted-src, `prepare: husky`, `engines.node ">=22.0.0"`, `packageManager "npm@10.9.2"`, `config.commitizen`); `nx.json` (copy crafted-src `targetDefaults` with caching for lint/format/check/check:ci/build/test*, `defaultBase: "dev"`, no `plugins`); `commitlint.config.js` (`module.exports = { extends: ["@commitlint/config-conventional"] };`); `.nvmrc` (`22`); extend the root `.gitignore` with `.nx/cache`, `.nx/workspace-data`, `coverage`, `dist`. Acceptance: `npm install` at root succeeds and creates a root lockfile.

### M2 — `packages/shared-config/`

Create `packages/shared-config/package.json` (`@crafted/shared-config`, `private`, `type: module`, `exports` for `./biome` and `./lint-staged`), `biome.json` (copy crafted-src verbatim), and `lint-staged.mjs` scoped to `functions/creator-outreach/**` and `packages/**` only (running `biome check --write --files-ignore-unknown=true`). Acceptance: `npx biome check functions/creator-outreach` resolves the extended config.

### M3 — TypeScript migration of the function

Rename and convert the source to TypeScript, preserving behavior and the naming invariant. Create `functions/creator-outreach/tsconfig.json` self-contained (mirror reporting-service compiler options; `include` the source, `exclude` `node_modules`, `dist`, `**/*.test.ts`, `__tests__`). Convert:

- `index.js` → `index.ts`: keep `functions.http("creator-outreach", creatorOutreach)` and the naming-invariant comment.
- `function-handler.js` → `function-handler.ts`: type `req`/`res` (functions-framework `HttpFunction` / express types via `@types/node` + the framework's own types), type `storeResults`, and infer `data` from the Zod schema (`z.infer<typeof outreachRequestSchema>`).
- `lib/schemas.js` → `lib/schemas.ts`: export the inferred types (`OutreachRequest`, and the studio/amplify variants) alongside `outreachRequestSchema`.
- `lib/scanner.ts`, `lib/email.ts`, `lib/firebase.ts`, `lib/sentry.ts`: convert with explicit types for the matched-creator shapes and the `{ messages, sent, failed }` result. Add small **additive exports** for the pure functions needed by tests (`matchBatchStudio`, `matchBatchAmplify`, `parseFollowerCount`, `extractResults`, and the Amplify rate calc extracted into a named pure function) — zero runtime behavior change.

Edit `package.json`: set `"main": "dist/index.js"`; add `"engines": { "node": ">=22.0.0" }`; add scripts `build` (`tsc -p tsconfig.json && cp -R templates dist/templates`), `gcp-build` (`npm run build`), `typecheck` (`tsc --noEmit -p tsconfig.json`), `dev` (`npm run build && functions-framework --target=creator-outreach`), `start` (`functions-framework --target=creator-outreach`), plus the Biome + vitest scripts added in M4/M5; add devDependencies `typescript`, `@types/node`, `@types/cors`, `vitest` (public registry; **no** `@crafted/shared-config`). Keep the 8 runtime deps. Regenerate the standalone nested `package-lock.json` (see Concrete Steps). Update `.gcloudignore` to additionally exclude `__tests__/`, `*.test.ts`, `vitest.config.*`, `biome.json`, `coverage/`, and `dist/` (build at deploy), while keeping `*.ts`, `tsconfig.json`, `package.json`, `package-lock.json`, and `templates/`.

Acceptance: `npm run typecheck` passes; `npm run build` produces `dist/index.js`, `dist/lib/*.js`, and `dist/templates/*.hbs`.

### M4 — Biome wiring for the function

Add `functions/creator-outreach/biome.json` = `{ "extends": ["@crafted/shared-config/biome"], "files": { "includes": ["!node_modules", "!coverage", "!config", "!dist"] } }`. Add scripts `lint`/`format`/`check`/`check:ci` (`biome lint --write .` / `biome format --write .` / `biome check --write .` / `biome ci .`). Acceptance: `npm run check:ci` at root reports the function and shows no diff in any other function directory.

### M5 — vitest unit tests

Add `functions/creator-outreach/vitest.config.ts` (`globals: true`, `environment: "node"`, `include: ["__tests__/**/*.test.ts"]`, v8 coverage over `lib/**` and `function-handler.ts`) and tests under `__tests__/`. Mock `../lib/firebase`, `../lib/sentry`, and `@sendgrid/mail` before importing units (import-time side effects). Cover, at minimum: `schemas.test.ts` (valid studio, valid amplify, passthrough extras, invalid → error); `scanner.test.ts` (`matchBatchStudio` region/country logic, `matchBatchAmplify` follower-range/state/platform logic, `parseFollowerCount` string vs number); `email.test.ts` (`extractResults` sent/failed/message-ids, the Amplify suggested-rate calc, skip-creator-without-rate); `handler.test.ts` (`creatorOutreach`: 400 on invalid body, 200 happy path with the response shape, 500 on thrown error, the Studio vs Amplify `storeResults` paths, and that the start/completion log lines fire). Add scripts `test` (`vitest run`), `test:ci` (`vitest run`), `test:watch` (`vitest`). Acceptance: `npm run test:ci` passes; a test fails if the `storeResults` Amplify two-path update or the template path resolution regresses.

### M6 — Husky + commit standards

Add `.husky/pre-commit` (`npm run lint-staged` then `npm run test`) and `.husky/commit-msg` (`npm run commitlint ${1}`). `prepare: husky` is only in the root `package.json`. Acceptance: a non-conventional commit message is rejected; a conventional one passes; staging a file outside `creator-outreach`/`packages` is not reformatted.

### M7 — TS-build-at-deploy feasibility prototype (de-risking)

Scope: prototyping. Prove, with no cloud credentials, that the `gcp-build` mechanism compiles and yields a deployable image. Install the `pack` CLI locally (or in a scratch CI run) and run, from the repo root:

    pack build creator-outreach-dryrun \
      --path functions/creator-outreach \
      --builder gcr.io/buildpacks/builder:google-22 \
      --env GOOGLE_FUNCTION_TARGET=creator-outreach \
      --env GOOGLE_RUNTIME=nodejs22

Promote criteria: the build runs `npm ci`, runs `gcp-build` (tsc + template copy), and completes with a built image. If it fails on lockfile drift, regenerate the nested lockfile (Concrete Steps) and retry. If it fails on template path resolution at any framework probe, confirm `cp -R templates dist/templates` ran. Discard criteria: if buildpacks cannot run `gcp-build` for gen2 in this org's builder version, fall back to the pre-built-`dist/` deploy variant (documented in Risks) — but only after proving the default path cannot work. Acceptance: `pack build` exits 0.

### M8 — PR/build workflow (no deploy)

Add `.github/workflows/creator-outreach-build.yml`. Triggers: `push` (paths `functions/creator-outreach/**`, `packages/shared-config/**`, root `package.json`/`package-lock.json`/`nx.json`/`commitlint.config.js`, and the workflow file), `pull_request` to `dev`/`main` (same paths), and `workflow_dispatch`. `concurrency` group cancels in-progress. Job `quality`: `actions/setup-node@v4` (node 22, npm cache) → `npm ci --no-audit` → `npm run check:ci` → `npm run typecheck` → `npm run test:ci`. Job `build-preview` (needs `quality`): install `pack`, run the M7 `pack build` (build only, no push, no creds). Neither job deploys. Acceptance: on a PR, `gh pr checks` shows `quality` and `build-preview` green and nothing deploys.

### M9 — Multi-env deploy jobs (dev + staging)

In `creator-outreach-build.yml`, add deploy jobs that run only on branch pushes (never on PRs). Both target the **single shared hosting project** (`vars.GCP_PROJECT`, repo-level) and differ only in the deployed function NAME (`creator-outreach-<env>`), the `NODE_ENV`, and the per-env Firebase key. `deploy-dev` (`needs: [quality, build-preview]`, `if: github.ref_name == 'dev'`, `environment: dev`): authenticate with `google-github-actions/auth@v2` using the repo-level `secrets.GCP_SA_KEY`; materialize the dev Firebase key from the env-scoped `secrets.FIREBASE_SA_KEY` into `functions/creator-outreach/config/devServiceAccountKey.json`; write `env.yaml` with `NODE_ENV: "dev"`, `SENDGRID_API_KEY`, `SENTRY_DSN`, `LOG_EXECUTION_ID: "true"`; `gcloud functions deploy creator-outreach-dev --gen2 --project=${{ vars.GCP_PROJECT }} --region=${{ vars.GCP_REGION || 'us-central1' }} --runtime=nodejs22 --trigger-http --allow-unauthenticated --entry-point=creator-outreach --source=functions/creator-outreach --env-vars-file=env.yaml --memory=4Gi --cpu=2 --timeout=3600s --concurrency=1 --max-instances=50`; print the deployed URL (describing `creator-outreach-dev`). `deploy-staging` (`if: github.ref == 'refs/heads/main'`, `environment: staging`): identical but deploys `creator-outreach-staging`, `NODE_ENV: "staging"`, and materializes the staging Firebase key file `config/stagingServiceAccountKey.json`. The deploy `--project` is the same shared `vars.GCP_PROJECT` in both. Secrets never appear inline in the shell (passed via `env:`). Acceptance: a push to `dev` deploys the function **`creator-outreach-dev`** into the shared hosting project and the run log prints its `*.run.app` URL; the function responds to a POST with a valid Studio/Amplify body. A push to `main` deploys **`creator-outreach-staging`** into the same project.

### M10 — Manual production workflow

Add `.github/workflows/creator-outreach-deploy-prod.yml`: `on: workflow_dispatch` with an optional `ref` input (git SHA/tag to promote; default the current `main`). Single job `deploy-prod`, `environment: prod` (configured in GitHub with a required reviewer). Steps mirror `deploy-staging` but deploy the function **`creator-outreach-prod`** into the **same shared hosting project** (`vars.GCP_PROJECT`), with `NODE_ENV: "prod"` and key file `config/serviceAccountKey.json` from the prod environment's runtime secrets. Delete the superseded `.github/workflows/deploy-creator-outreach.yml`. Acceptance: the workflow appears under Actions as manually runnable, requires an approval, and deploys the chosen `ref` as **`creator-outreach-prod`** into the shared hosting project.

### M11 — Documentation (final phase, after implementation)

This is the closing milestone; run it only once M1–M10 are merged and a dev deploy is green, so the docs describe what actually shipped. It has two mandatory parts.

Part 1 — Infrastructure documentation in `README.md`. Add (or replace) a "creator-outreach" section that describes the new infrastructure for a reader who has never seen it:

- **Runtime & platform:** Gen2 Cloud Functions (Cloud Run-backed), nodejs22, region `us-central1`, HTTP-triggered, entry point / in-code target `creator-outreach`, deployed name `creator-outreach-<env>`, 2 vCPU / 4Gi / concurrency 1 / 3600s / max 50. State that the function is the modernization reference and the other functions remain legacy.
- **Multi-env layout (one shared hosting project, env-in-name):** all three environments deploy into a **single shared GCP hosting project** (repo-level `GCP_PROJECT`) and are isolated by the deployed function name: `dev` branch → `creator-outreach-dev` (`NODE_ENV=dev`); `main` → `creator-outreach-staging` (`NODE_ENV=staging`); manual promotion → `creator-outreach-prod` (`NODE_ENV=prod`). Note that `NODE_ENV` selects the per-env Firebase **data** project, database URL, and `config/*ServiceAccountKey.json` in `lib/firebase.ts` (the Firebase data projects `crafted-dev-v1` / `crafted-staging-v1` / `crafted-v1` stay per-env; only the hosting project is single).
- **CI/CD flow:** on a pull request, the `quality` job (Biome + `tsc --noEmit` + vitest) and the `build-preview` job (`pack build` buildpack dry-run) run and **nothing deploys**; on a push to `dev`/`main` the matching deploy job runs; production is a separate `workflow_dispatch` workflow gated by the `prod` GitHub Environment's required reviewer. List the two workflow files and the three GitHub Environments (`dev`/`staging`/`prod`) with a pointer to the Secrets & Variables Matrix in this plan.
- **TS build-at-deploy mechanism:** explain that the deploy uploads TypeScript source, the GCF buildpack runs `npm ci` then the `gcp-build` script (`tsc` + copy `templates/` into `dist/templates/`), and `main` points at `dist/index.js`. Note the deploy contract: self-contained `tsconfig.json`, no `@crafted/shared-config` in the function manifest, and a standalone nested `package-lock.json`.
- **Auth model (ticket [353]):** describe the current state (`--allow-unauthenticated`, `allUsers` invoker) and the planned hardening — the `server` attaches a Google-signed OIDC identity token (audience = the CF URL) before its fire-and-forget `fetch`, the server's invoker service account is granted `roles/run.invoker` on the function, and `--allow-unauthenticated` is then removed; CF and server ship together. Cross-reference `server/.agent/exec-plans/creator-outreach-auth.md`.

Part 2 — Manual deploy instructions in `README.md`. These must be copy-pasteable. Document the local `gcloud` deploy per environment, including sourcing the runtime env vars and materializing the matching Firebase key into `config/`. The canonical command (substitute the bracketed values per env):

    # Prereqs: gcloud authenticated (gcloud auth login), pack optional for a local dry-run.
    # 1) Place the matching Firebase Admin key at the path lib/firebase.ts expects:
    #      dev     -> functions/creator-outreach/config/devServiceAccountKey.json
    #      staging -> functions/creator-outreach/config/stagingServiceAccountKey.json
    #      prod    -> functions/creator-outreach/config/serviceAccountKey.json
    # 2) Write the runtime env file (NODE_ENV must match the deployed function's env):
    cat > env.yaml <<'EOF'
    NODE_ENV: "dev"                 # dev | staging | prod
    SENDGRID_API_KEY: "SG.xxxx"
    SENTRY_DSN: "https://xxxx"
    LOG_EXECUTION_ID: "true"
    EOF
    # 3) Deploy. One shared hosting project ($GCP_PROJECT) for all envs; the env is in the NAME.
    #    dev shown; for staging use name creator-outreach-staging (key stagingServiceAccountKey.json,
    #    NODE_ENV=staging), for prod use creator-outreach-prod (key serviceAccountKey.json, NODE_ENV=prod).
    #    --entry-point stays creator-outreach in ALL envs (it is the in-code functions.http target).
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
    # 4) Print the deployed URL (set the server's CF_CREATOR_OUTREACH_URL to it):
    gcloud functions describe creator-outreach-dev --gen2 --region=us-central1 \
      --project="$GCP_PROJECT" --format='value(serviceConfig.uri)'

Also document how to run the manual production promotion without a local deploy — the GitHub-native path:

    # Manual prod promotion (preferred — goes through the required-reviewer gate):
    #   GitHub → Actions → "creator-outreach Production Deploy" → Run workflow
    #     → optionally set the `ref` input to the git SHA/tag validated on main → Run.
    # CLI equivalent:
    gh workflow run creator-outreach-deploy-prod.yml --ref main -f ref=<sha-or-tag>

Note that the buildpack runs `gcp-build` (the TS compile + template copy) during every `gcloud functions deploy`, so no local build is required before deploying; `npm run build` locally is only to verify the output.

Part 3 — Also update the `CLAUDE.md` "Tooling & Standards (creator-outreach reference)" section (Biome-via-shared-config, vitest, the Nx workspace, commitlint/husky, the CI + pack dry-run, the **TS-build-at-deploy contract**, and the per-environment GCF infra table), and write release notes with a per-environment deploy checklist plus a manual test suite per the root `CLAUDE.md` conventions.

Acceptance: `README.md` contains the infrastructure section (runtime/platform, single-shared-project env-in-name layout, CI/CD flow, TS build-at-deploy mechanism, auth model from [353]) and a manual-deploy section whose `gcloud functions deploy --gen2` command (deployed name `creator-outreach-<env>`, `--entry-point=creator-outreach`, shared `--project`) and `gh workflow run` command are copy-pasteable and correct for each environment; `CLAUDE.md` has the tooling section; release notes and the manual test suite exist. A novice can follow the README from clone to a green PR to a dev deploy, and can perform (or understand) a manual per-env deploy and the prod promotion from the docs alone.

### M12 — Auth-hardening cross-reference (fast-follow, separate PR)

Do not remove `--allow-unauthenticated` in this plan. Confirm the coordinated auth change is captured in `server/.agent/exec-plans/creator-outreach-auth.md` (Notion ticket [353]): the `server` attaches a Google-signed OIDC token (audience = the CF URL) before its fire-and-forget `fetch`, the CF's runtime is granted `roles/run.invoker` for the server's invoker service account, and only then is `--allow-unauthenticated` removed — CF and server shipping together. Acceptance: the companion plan exists and is cross-referenced here; this plan's deploy remains unauthenticated until the fast-follow.


## Concrete Steps

All commands run from the `crafted_cloud_functions` worktree root unless noted.

Regenerating the standalone nested lockfile (M3) — because the function is a workspace member, a root `npm install` will not maintain `functions/creator-outreach/package-lock.json`; generate it in isolation and copy it back:

    rm -rf /tmp/co-lock && cp -R functions/creator-outreach /tmp/co-lock
    rm -rf /tmp/co-lock/node_modules /tmp/co-lock/package-lock.json
    (cd /tmp/co-lock && npm install --package-lock-only)
    cp /tmp/co-lock/package-lock.json functions/creator-outreach/package-lock.json

Then prove it is deploy-valid (M7):

    pack build creator-outreach-dryrun --path functions/creator-outreach \
      --builder gcr.io/buildpacks/builder:google-22 \
      --env GOOGLE_FUNCTION_TARGET=creator-outreach --env GOOGLE_RUNTIME=nodejs22

Local quality gate before pushing:

    npm ci
    npm run check:ci
    npm run typecheck
    npm run test:ci
    npm run build   # expect dist/index.js, dist/lib/*.js, dist/templates/*.hbs


## Validation and Acceptance

1. `npm run typecheck` passes with zero errors; `npm run build` emits `dist/index.js`, `dist/lib/*.js`, and `dist/templates/*.hbs`.
2. `npm run check:ci` passes and touches only `creator-outreach` + `shared-config` (no diff in sibling functions).
3. `npm run test:ci` passes; the handler test proves the Studio path writes `tasks/{task.uid}/invites` and the Amplify path writes both `brands/.../invites` and `influencer_campaigns/.../invites`; a 400 is returned on invalid body and a 500 on a thrown error.
4. A non-conventional commit message is rejected by `commit-msg`; a conventional one passes.
5. `pack build … --env GOOGLE_RUNTIME=nodejs22 --env GOOGLE_FUNCTION_TARGET=creator-outreach` exits 0 (proves TS-build-at-deploy).
6. On a PR, `gh pr checks` shows `quality` + `build-preview` green and no deploy job ran.
7. A push to `dev` deploys the function `creator-outreach-dev` into the shared hosting project; the printed `*.run.app` URL responds 200 to a valid Studio and a valid Amplify POST (invalid body → 400).
8. A merge to `main` deploys `creator-outreach-staging`; the manual prod workflow requires approval and deploys `creator-outreach-prod` (all into the same shared hosting project).


## Idempotence and Recovery

Every artifact is additive except the deletion of `deploy-creator-outreach.yml` (M10) and the source-file renames (M3). Re-running `npm install`, `npm run build`, and `pack build` is safe and repeatable. The rollout reverts cleanly by removing the root scaffolding, `packages/`, `.husky/`, the two new workflows, and the function's added config, and by restoring the JS sources from git history. If a deploy fails partway, re-run the workflow — `gcloud functions deploy` is idempotent (it updates in place). The standalone nested lockfile can be regenerated at any time with the temp-directory recipe above.


## Risks

- **TS-build-at-deploy mechanism (highest).** The whole TS migration rests on the GCF gen2 buildpack running `gcp-build` (tsc + template copy) at deploy. Mitigation: the M7 `pack build` dry-run gates every PR and reproduces the real build with no credentials; the M5 handler test guards the template-path resolution. Fallback if the buildpack cannot run `gcp-build` in this org's builder: build in CI and deploy a pre-built `dist/` as the source (documented, but only after the default path is proven impossible).
- **Standalone nested lockfile drift.** The function is a workspace member, so root installs do not maintain its nested lockfile; a stale lockfile fails deploy-time `npm ci`. Mitigation: regenerate via the temp-directory recipe whenever deps change, and rely on the M7/M8 `pack build` (which runs `npm ci`) to fail the PR on drift.
- **Template cold-start footgun.** If `templates/` is not copied into `dist/templates/`, `lib/email.ts` throws at module load. Mitigation: `build`/`gcp-build` copies it; the M5 handler/email tests and M7 dry-run cover it.
- **gen2 `allUsers` / org-policy interaction with auth (item 6).** This plan deploys with `--allow-unauthenticated`, which grants `allUsers` the Cloud Run `run.invoker` role — subject to an org policy that may forbid public Cloud Run services (deploy would fail). If the org policy already blocks `allUsers`, the current function is either exempt or the auth fast-follow must land first. Mitigation: verify the dev deploy succeeds with the flag; if org policy blocks it, escalate the auth fast-follow (`server/.agent/exec-plans/creator-outreach-auth.md`) to a hard dependency and deploy privately with the server token from the start.
- **Prod promotion re-builds from source rather than promoting an immutable artifact.** Unlike crafted-src (which promotes a pre-built ECR image tag), `gcloud functions deploy` rebuilds via buildpacks each time. Determinism relies on the pinned lockfile, the pinned `google-22` builder, and the `ref` input. Mitigation: the prod workflow takes a `ref` so you promote exactly the SHA validated on `main`/staging.
- **Secret handling in workflows.** The Firebase key and API keys are materialized into files/`env.yaml` at deploy. Mitigation: pass via `env:` (never inline in the shell), keep `config/` and `env.yaml` gitignored and `.gcloudignore`-excluded from source uploads where not needed, and scope secrets to GitHub Environments.


## Secrets & Variables Matrix

**Topology (2026-07-25): one shared hosting project; env encoded in the deployed function name.** Because all three environments deploy `creator-outreach-<env>` into a **single** GCP hosting project, the deploy config is **shared repo-level**. The two runtime keys that are **identical across all environments** — `SENDGRID_API_KEY` and `SENTRY_DSN` — are **repo-level secrets too** (set once). The **only per-env secret is `FIREBASE_SA_KEY`**, because the dev/staging/prod Firebase **data** projects genuinely differ. The deployed function name in each job is `creator-outreach-dev` / `creator-outreach-staging` / `creator-outreach-prod`; `--entry-point` stays `creator-outreach` everywhere.

GitHub Environments: `dev`, `staging`, `prod` — kept for the **per-env `FIREBASE_SA_KEY`** and for the `prod` **required-reviewer** protection rule (the manual prod deploy pauses for approval). Auth model for the deploy: **downloaded service-account JSON key** (`GCP_SA_KEY`), the closest analog to crafted-src's static AWS access keys. Workload Identity Federation (keyless GitHub OIDC → GCP) is the more secure alternative and the recommended hardening path — it removes the long-lived downloaded key entirely; adopt it in a follow-up once the SA-key flow is proven.

Shared repo-level config (Settings → Secrets and variables → Actions → repository-level; one value for all three envs):

| Name | Kind | Purpose | Value |
|---|---|---|---|
| `GCP_PROJECT` | Variable | The single shared **hosting** GCP project id for the deploy `--project` (all 3 envs). NOT a Firebase data project. | the one shared hosting project |
| `GCP_REGION` | Variable | Deploy region (workflow falls back to `us-central1` if unset). | `us-central1` |
| `GCP_SA_KEY` | Secret | JSON key of the **one** deploy service account (the shared hosting project). Gen2 deploys via Cloud Build → Artifact Registry → Cloud Run, so it needs Cloud Functions Developer, Cloud Run Admin, Cloud Build Editor, Artifact Registry Writer, Service Account User, and Storage Object Admin (gcf source bucket). | key for the shared hosting project |
| `SENDGRID_API_KEY` | Secret | SendGrid key used at runtime (`lib/email.ts`), written into `env.yaml`. Identical in every env → set once. | same key for all 3 envs |
| `SENTRY_DSN` | Secret | Sentry DSN used at runtime (`lib/sentry.ts`), written into `env.yaml`. Identical in every env → set once (see note below on why one DSN is fine). | same DSN for all 3 envs |

Per-env runtime secret (Settings → Environments → `<env>` → Secrets; the deploy job's `environment:` selects the set):

| Secret | Purpose | dev | staging | prod |
|---|---|---|---|---|
| `FIREBASE_SA_KEY` | Firebase Admin SA JSON, materialized into `config/<env>ServiceAccountKey.json` (config/ is gitignored). Selects the per-env Firebase **data** project; chosen by `NODE_ENV` in `lib/firebase.ts`. **The only genuinely per-env secret** — the data projects differ. | `crafted-dev-v1` Firebase | `crafted-staging-v1` Firebase | `crafted-v1` Firebase |

**Why a single `SENTRY_DSN` is fine.** `lib/sentry.ts` sets Sentry's `environment` from `NODE_ENV` (which is set per deploy), so one DSN still separates events by environment inside one Sentry project — no per-env DSN is needed to tell dev/staging/prod events apart.

**Escape hatch.** If one environment ever needs a *different* SendGrid or Sentry value, add an environment-level secret of the **same name** (`SENDGRID_API_KEY` / `SENTRY_DSN`) to that GitHub Environment; it overrides the repo-level one. GitHub secret precedence is environment → repository, so the workflow's `${{ secrets.* }}` reference resolves to the environment value for jobs targeting that environment and to the repository value everywhere else — no workflow change required either way.

**Trade-off (accepted).** Repo-level secrets are readable by **all** repository workflow jobs, including the PR `quality`/`build-preview` jobs, whereas environment-level secrets are only exposed to jobs that declare `environment:` for that env. For these runtime keys (a SendGrid send key and a Sentry DSN, not deploy credentials) that broader exposure is acceptable; `GCP_SA_KEY` — the actual deploy credential — is also repo-level but is only referenced by the deploy jobs.

`NODE_ENV` is set per job to match the environment (`dev`/`staging`/`prod`) via `env.yaml`; it drives both the Firebase key file name and the database URL in `lib/firebase.ts`, and the Sentry `environment`. The **Firebase data projects stay per-env** (`crafted-dev-v1` / `crafted-staging-v1` / `crafted-v1`) — only the function hosting project is collapsed to one. The server's `CF_CREATOR_OUTREACH_URL` (per env) is set on the `server` side (Heroku), not here; each env's server points at the matching `creator-outreach-<env>` URL. It is the fire-and-forget target and, later, the OIDC audience — see the auth companion plan.


## Interfaces and Dependencies

Runtime dependencies (unchanged, 8): `@google-cloud/functions-framework`, `@sendgrid/mail`, `@sentry/node`, `cors`, `dotenv`, `firebase-admin`, `handlebars`, `zod`. Added devDependencies (public registry, function manifest): `typescript`, `@types/node`, `@types/cors`, `vitest`. Never add `@crafted/shared-config` to the function manifest.

`functions/creator-outreach/package.json` must end with `"main": "dist/index.js"`, `"engines": { "node": ">=22.0.0" }`, and scripts including `build` (`tsc -p tsconfig.json && cp -R templates dist/templates`), `gcp-build` (`npm run build`), `typecheck` (`tsc --noEmit -p tsconfig.json`), `dev`, `start`, `lint`, `format`, `check`, `check:ci`, `test`, `test:ci`, `test:watch`.

The registered target and deployed name is the exact string `"creator-outreach"`; the handler identifier is `creatorOutreach`. `index.ts` ends with:

    import * as functions from "@google-cloud/functions-framework";
    import { creatorOutreach } from "./function-handler";

    functions.http("creator-outreach", creatorOutreach);

`lib/schemas.ts` exports `outreachRequestSchema` plus `type OutreachRequest = z.infer<typeof outreachRequestSchema>` (and the studio/amplify variants). `lib/scanner.ts` and `lib/email.ts` keep their public exports (`scanCreators`, `sendOutreachEmails`) and add additive exports for the pure functions the tests exercise.


---

Revision note (2026-07-24, tech-lead): Authored as the successor to `creator-outreach-tooling.md`. Reverses that draft's two decisions — plain JavaScript (now TypeScript with `tsc --noEmit` in CI, built at deploy via a `gcp-build` script) and manual deploy (now automated per-branch deploys to three GCP projects with a manual prod promotion mirroring `crafted-src`). Carried forward the still-valid GCF constraints (npm-ci-at-deploy, no private workspace dep in the manifest, import-time side effects, module-private matchers, buildpack dry-run) into Surprises & Discoveries. Added the per-GitHub-Environment secrets/variables matrix, the risk list, and the auth fast-follow cross-reference. Not yet implemented — gated on user review.

Revision note (2026-07-25, cloud-engineer): Retargeted the deploy topology from **three separate hosting GCP projects** to **one shared hosting project with the environment encoded in the deployed function name** (`creator-outreach-dev` / `-staging` / `-prod`). The in-code `functions.http` target and `--entry-point` stay `creator-outreach`; `NODE_ENV` per deploy and the **per-env Firebase data projects** are unchanged (only the function hosting project is collapsed). `GCP_PROJECT`/`GCP_SA_KEY`/`GCP_REGION` moved to shared repo-level config; the three GitHub Environments now hold only the per-env `FIREBASE_SA_KEY` plus the `prod` required-reviewer gate (`SENDGRID_API_KEY`/`SENTRY_DSN` are also repo-level — identical across envs; see the 2026-07-25 secrets-simplification Decision Log entry). Updated: the two workflows, `index.ts` + `CLAUDE.md` naming standard, the Decision Log (new entry supersedes the three-project decision), the Secrets & Variables Matrix, M9/M10 (descriptions + acceptance), the Purpose/Outcomes/infra-table wording, and the README + release-notes deploy checklist. See the 2026-07-25 Decision Log entry for rationale ("same project, isolated by name").
