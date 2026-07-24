# Bring `creator-outreach` up to `crafted-src` tooling standards

> SUPERSEDED (2026-07-24) by `creator-outreach-modernization.md` in this same directory. This draft chose plain JavaScript with no build step and treated deploy automation as a non-goal; both decisions are reversed in the successor (TypeScript with `tsc --noEmit` in CI, built at deploy via a `gcp-build` script; automated per-branch deploys to three GCP projects with a manual prod promotion). This file is retained for historical context — its GCF constraints (npm-ci-at-deploy, no private workspace dep in the function manifest, import-time side effects, module-private matchers, buildpack dry-run) are still valid and are carried forward into the successor's Surprises & Discoveries. Do not implement from this file.

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. This document follows the ExecPlan format defined in `server/.agent/PLANS.md` (the canonical PLANS.md for this project family).


## Purpose / Big Picture

`crafted_cloud_functions` is a legacy GCF repo with no shared tooling: each of its 10 functions (and 17 `maintenance/` scripts) has its own isolated `package.json`/`node_modules`, no linting, no tests, no CI, no commit standards. The new `creator-outreach` function is the modern guiding example. The goal of this work is to wrap **only** `creator-outreach` in the same tooling the `crafted-src` monorepo uses — Biome, Nx, vitest, commitlint, husky, GitHub Actions CI — so it becomes the template we expand to the other functions later (a separate, future effort we will green-light explicitly).

After this change: a root npm workspace + Nx exists; `creator-outreach` is lint/format-checked by Biome (via a shared config), unit-tested with vitest, commit messages are enforced by commitlint via husky, and a GitHub Actions workflow runs lint + tests + a **buildpack dry-run deploy** on every PR. The GCF runtime is modernized from nodejs20 to **nodejs22**.

To verify: `npm install` at the repo root, then `npm run check:ci` (Biome) and `npm run test:ci` (vitest) pass; a conventional-commit message is required by the commit-msg hook; and `pack build … --env GOOGLE_RUNTIME=nodejs22 --env GOOGLE_FUNCTION_TARGET=creatorOutreach` builds successfully (proving a deploy won't fail) with no GCP credentials.


## Scope & non-goals

- **No code migration.** `creator-outreach` stays CommonJS **plain JavaScript** — chosen over a full TypeScript rewrite and over the JSDoc/`checkJs` middle ground. No type-checking step is added. This keeps the work to "wrap existing JS in tooling" with **no build step and no change to the GCF deploy model**.
- **Runtime modernized to nodejs22** in both the real deploy and the dry-run (an infra/runtime update, not a code migration).
- The other 9 functions and all 17 `maintenance/` scripts are **not touched**.
- Out of scope: real deploy automation on merge (manual `gcloud` deploy stays; can be added later once the dry-run gate is proven), and migrating any other function.


## Progress

- [ ] Milestone 1: Root workspace scaffolding (`package.json`, `nx.json`, `commitlint.config.js`, `.nvmrc`, `.gitignore` additions)
- [ ] Milestone 2: `packages/shared-config/` (biome.json + scoped lint-staged.mjs + package.json) — mirror of `crafted-src`
- [ ] Milestone 3: `creator-outreach` tooling (package.json scripts + `engines`, `biome.json`, `vitest.config.mjs`, `.gcloudignore`)
- [ ] Milestone 4: vitest unit tests under `functions/creator-outreach/__tests__/`
- [ ] Milestone 5: Husky hooks (`pre-commit`, `commit-msg`) + commit standards
- [ ] Milestone 6: CI workflow `.github/workflows/creator-outreach-build.yml` (quality + buildpack dry-run)
- [ ] Milestone 7: Docs (`README.md`, `CLAUDE.md`)
- [ ] Milestone 8: Verification (root install, check:ci, test:ci, commit-msg gate, local `pack build`, PR checks green)


## Surprises & Discoveries

- **`crafted-src` apps are esbuild-bundled before deploy, so their `@crafted/shared-config` devDep never ships. GCF is the inverse** — `gcloud functions deploy` uploads the function directory and runs `npm ci` against the public registry at build time. The `crafted-src` tooling pattern was designed for a world where the deploy artifact is decoupled from the workspace; GCF couples them. This drives the two highest-risk constraints below.
- A private workspace package (`@crafted/shared-config`) in the function's `package.json` is a **hard deploy-breaker**: at deploy time `npm ci` cannot resolve it (E404 / unresolvable workspace link). It must never appear in the function manifest.
- `lib/firebase.js`, `lib/sentry.js`, `lib/email.js` have **import-time side effects** (load a service-account key, `initializeApp`, `Sentry.init`, `sgMail.setApiKey`). They throw on import without credentials — so handler tests must mock these modules, and a naive functions-framework "boot" smoke test would false-fail in CI.
- `scanner.js` exports only `scanCreators`; `email.js` exports only `sendOutreachEmails`. The pure matchers (`matchBatchStudio`/`matchBatchAmplify`/`parseFollowerCount`) and `extractResults` + the Amplify rate calc are module-private — test them through the public exports, or add additive `module.exports` entries (zero runtime impact).
- Tooling verified locally: Node 22.22, npm 10.9.4, Docker 29.5.2 present; `gcloud` NOT installed and `gcloud functions deploy` has **no `--dry-run` flag** — confirming buildpacks (`pack build`) as the correct dry-run mechanism.
- GCF infra (from the deployed service YAML) is **Gen2 (Cloud Run-backed)**, currently nodejs20 — modernized here to nodejs22. See the infra table in Context.


## Decision Log

- Decision: Keep `creator-outreach` as **plain JavaScript** (no TS, no JSDoc/`checkJs`).
  Rationale: Avoids a build step and any change to the GCF deploy model; keeps the work to "wrap existing JS in tooling." TS would force a compile step + change the deploy artifact and is a rewrite of a production function — deferred as its own effort.
  Date/Author: 2026-06-01

- Decision: **Modernize the GCF runtime to nodejs22** (from the current nodejs20) in the real deploy, the `engines` field, CI, `.nvmrc`, and the pack dry-run.
  Rationale: Aligns the Node version with `crafted-src`; the dry-run must build on what actually deploys, so all five must agree.
  Date/Author: 2026-06-01

- Decision: PR **dry-run deploy = buildpack build** (`pack build` with `gcr.io/buildpacks/builder:google-22`, `GOOGLE_RUNTIME=nodejs22`, `GOOGLE_FUNCTION_TARGET=creatorOutreach`), build-only/no-push.
  Rationale: Replicates the real Gen2 build (npm ci, Node-version selection, entrypoint resolution) with **no GCP credentials**. Catches the actual deploy-breakers (missing deps, lockfile drift, unresolvable packages, bad entrypoint). A real ephemeral `gcloud` deploy would need Workload Identity creds + cleanup; a boot smoke test doesn't replicate the build and would false-fail on the import-time side effects.
  Date/Author: 2026-06-01

- Decision: The function's `package.json` stays **self-contained** (its current 8 runtime deps + only `engines` and `scripts` added). No `devDependencies`, and **never** `@crafted/shared-config`.
  Rationale: GCF runs `npm ci` from the function manifest at deploy. Adding `scripts`/`engines` does not affect lockfile validity; adding a private workspace dep breaks the deploy. Biome/vitest binaries resolve from the root-hoisted `node_modules/.bin` at dev/CI time, so the scripts work without listing those tools as the function's own deps.
  Date/Author: 2026-06-01

- Decision: **Never delete `functions/creator-outreach/package-lock.json`.**
  Rationale: It is the deploy contract — GCF uses it for a reproducible `npm ci`. npm workspaces keep one lockfile at root and leave the nested one alone; it stays valid because we do not change runtime deps. Deleting it silently downgrades the deploy from `npm ci` to `npm install` (version drift).
  Date/Author: 2026-06-01

- Decision: Workspace globs are `["packages/*", "functions/creator-outreach"]` — an **explicit single function**, not `functions/*`.
  Rationale: `functions/*` would pull the 26 bloated sibling manifests into the root install. Expand this array per function as each is migrated later.
  Date/Author: 2026-06-01

- Decision: **Scope Biome/lint-staged to creator-outreach + packages only** (a deliberate divergence from `crafted-src`'s broad glob).
  Rationale: A broad glob would reformat the 26 un-migrated sibling functions on the first stage/commit, violating the "only creator-outreach now" scope. Each workspace member runs Biome in its own dir via Nx; lint-staged is scoped by path.
  Date/Author: 2026-06-01

- Decision: `prepare: husky` lives **only** in the root `package.json`, never in the function manifest.
  Rationale: A `prepare` script in the function would run during the GCF build (which has no `.git`) and can fail the deploy.
  Date/Author: 2026-06-01


## Outcomes & Retrospective

(To be filled at completion.)


## Context and Orientation

This work happens in the `crafted_cloud_functions` repository.

### Current state
- Pure CommonJS JavaScript; no root `package.json`, no workspace. Each function/maintenance script is isolated with its own `package.json` + `node_modules`.
- `functions/creator-outreach/`: lean 8 runtime deps, scripts `dev`/`start`, **no tests, no devDeps, no `engines`**. Files: `index.js` (registers `functions.http("creatorOutreach", handler)`), `function-handler.js`, `lib/{firebase,sentry,schemas,scanner,email}.js`, `templates/*.hbs`, `package.json`, `package-lock.json`, `.env.example`.
- No CI, husky, commitlint, or Biome anywhere. Root `.gitignore` is minimal (`.env`, `serviceAccountKey.json`, `node_modules`).

### `crafted-src` tooling to mirror (versions pinned)
- **Nx `^22.5.0`** via npm workspaces — no `project.json`, no inference plugins (Nx auto-infers targets from `package.json` scripts). `nx.json` has `targetDefaults` with caching + `defaultBase: "dev"`; root scripts run `nx run-many -t <target>`.
- **Biome `2.3.15`** centralized in `packages/shared-config/biome.json` (4-space indent, lineWidth 120, double quotes, recommended rules). Members extend via `"extends": ["@crafted/shared-config/biome"]`.
- **vitest `^3.0.0`** (not jest): `globals: true`, `environment: "node"`, v8 coverage. Scripts `test: vitest run`, `test:ci: vitest run`.
- **commitlint `^19.8.0`** + `@commitlint/config-conventional`. **husky `^9.1.7`**: `commit-msg` = `npm run commitlint ${1}`, `pre-commit` = `npm run lint-staged` then `npm run test`. **lint-staged `^15.5.1`**. **commitizen** (`npm run cz`).
- App standard scripts: `lint` (`biome lint --write .`), `format` (`biome format --write .`), `check` (`biome check --write .`), `check:ci` (`biome ci .`).
- CI: GitHub Actions, per-app workflow, path-filtered triggers on push+PR to `dev`/`main`; `actions/setup-node@v4` + npm cache, `npm ci --no-audit`, `npm run check:ci`, `npm run test:ci`.

### GCF infra (from the deployed service YAML — runtime modernized to nodejs22)
Gen2 (Cloud Run-backed). Keep the existing shape; bump runtime to nodejs22.

| Setting | Value |
|---|---|
| Generation | Gen2 |
| Runtime | **nodejs22** (bumped from nodejs20) |
| Region | `us-central1` |
| Dev project | `crafted-dev-v1` (project number `321295875407`) |
| Trigger | HTTP, ingress all |
| Entry point | `creatorOutreach` |
| Resources | 2 vCPU, 4Gi memory |
| Concurrency | 1 |
| Timeout | 3600s |
| Max instances | 50 |
| Service account | `321295875407-compute@developer.gserviceaccount.com` (default compute) |
| Env | `NODE_ENV=<env>`, `LOG_EXECUTION_ID=true` |
| Base image | automatic updates, startup CPU boost on |

Canonical deploy command (documented; not run as part of this work):
```
gcloud functions deploy creatorOutreach --gen2 --runtime=nodejs22 --region=us-central1 \
  --source=functions/creator-outreach --entry-point=creatorOutreach --trigger-http \
  --memory=4Gi --cpu=2 --timeout=3600s --concurrency=1 --max-instances=50 \
  --set-env-vars=NODE_ENV=dev,LOG_EXECUTION_ID=true --project=crafted-dev-v1
```


## Plan of Work

### Milestone 1 — Root workspace scaffolding (new files at repo root)
- `package.json`: `private`, `workspaces: ["packages/*", "functions/creator-outreach"]`. devDeps: `nx`, `@biomejs/biome`, `@commitlint/cli`, `@commitlint/config-conventional`, `commitizen`, `cz-conventional-changelog`, `husky`, `lint-staged`, `rimraf`. Scripts mirror `crafted-src`: `prepare: husky`, `lint`/`format`/`check`/`check:ci`/`test`/`test:ci` (each `nx run-many -t <t>`), `commitlint: commitlint --edit`, `cz`, `lint-staged`, `clean`. `engines.node ">=22.0.0"`, `packageManager "npm@10.9.2"`, `config.commitizen` block.
- `nx.json`: copy `crafted-src` `targetDefaults` (cache lint/format/check/check:ci/build/test*) + `defaultBase: "dev"`. No `plugins`.
- `commitlint.config.js`: `module.exports = { extends: ['@commitlint/config-conventional'] };`
- `.nvmrc`: `22`.
- Extend root `.gitignore` with `.nx/cache`, `.nx/workspace-data`, `coverage`, `dist`.

**Verification:** `npm install` at root succeeds, creates a root lockfile, and **leaves `functions/creator-outreach/package-lock.json` unchanged**.

### Milestone 2 — `packages/shared-config/` (mirror of `crafted-src`)
- `package.json` named `@crafted/shared-config`, `private`, `type: module`, `exports: { "./biome": "./biome.json", "./lint-staged": "./lint-staged.mjs" }`.
- `biome.json`: copy verbatim from `crafted-src` (4-space, lineWidth 120, double quotes, recommended; `$schema` 2.3.15).
- `lint-staged.mjs`: **scoped** to creator-outreach + packages only:
  ```js
  export default {
    "functions/creator-outreach/**/*.{js,mjs,cjs,json}": ["biome check --write --files-ignore-unknown=true"],
    "packages/**/*.{js,mjs,cjs,json}": ["biome check --write --files-ignore-unknown=true"],
  };
  ```

### Milestone 3 — `functions/creator-outreach/` tooling (edit manifest + add config; do NOT touch `lib/` runtime logic)
- `package.json`: add `engines.node ">=22.0.0"` and scripts `lint`/`format`/`check`/`check:ci` (biome) + `test: vitest run`, `test:ci: vitest run`, `test:watch: vitest`. **Do not add devDeps; do not add `@crafted/shared-config`; keep the 8 runtime deps untouched.**
- `biome.json`: `{ "extends": ["@crafted/shared-config/biome"], "files": { "includes": ["!node_modules", "!coverage", "!config"] } }`.
- `vitest.config.mjs`: ESM config — `globals: true`, `environment: "node"`, `include: ["__tests__/**/*.test.js"]`, v8 coverage over `lib/**`.
- `.gcloudignore`: exclude `__tests__/`, `*.test.js`, `vitest.config.mjs`, `biome.json`, `coverage/`, `node_modules/`, `.env*`.

### Milestone 4 — vitest unit tests (`functions/creator-outreach/__tests__/`)
Mock `../lib/firebase`, `../lib/sentry`, and `@sendgrid/mail` before importing units under test (import-time side effects).
- `schemas.test.js` — `outreachRequestSchema`: valid studio, valid amplify, `.passthrough` extras, invalid → error.
- `handler.test.js` — `creatorOutreach`: 400 on invalid body, 200 happy path, 500 on thrown error, and the **studio vs amplify `storeResults` paths**.
- `scanner.test.js` / `email.test.js` — matchers + Amplify rate calc, via public `scanCreators`/`sendOutreachEmails` (firebase/SendGrid mocked), or via small additive exports.

### Milestone 5 — Husky + commit standards
- `.husky/commit-msg`: `npm run commitlint ${1}`.
- `.husky/pre-commit`: `npm run lint-staged` then `npm run test`. (Future: switch to `nx affected -t test` as more functions migrate.)
- `prepare: husky` only in root `package.json`.

### Milestone 6 — CI (`.github/workflows/creator-outreach-build.yml`)
Adapt `crafted-src`'s `reporting-service-build.yml`. Triggers: push + PR to `dev`/`main`, path filter `functions/creator-outreach/**`, `packages/shared-config/**`, root `package.json`/`package-lock.json`/`nx.json`/`commitlint.config.js`, and the workflow file.
- **Job `quality`**: `actions/setup-node@v4` (node 22, npm cache) → `npm ci --no-audit` → `npm run check:ci` → `npm run test:ci`.
- **Job `dry-run-deploy`** (needs `quality`): install the `pack` CLI, then `pack build creator-outreach-dryrun --path functions/creator-outreach --builder gcr.io/buildpacks/builder:google-22 --env GOOGLE_FUNCTION_TARGET=creatorOutreach --env GOOGLE_RUNTIME=nodejs22` (build only, no push, no GCP creds).

### Milestone 7 — Docs
- `README.md`: update folder structure (show `packages/shared-config`, root configs); add Prerequisites (Node 22 / npm 10), root `npm install`, dev/test/lint/check commands, commit conventions (`npm run cz`), pre-commit hooks, CI overview, and the dry-run (`pack build`) check. Note `creator-outreach` is the reference; other functions not yet migrated.
- `CLAUDE.md`: add a "Tooling & Standards (creator-outreach reference)" section — Biome via shared-config, vitest, Nx workspace, commitlint/husky, CI + pack dry-run, the **deploy-contract rules**, and the **GCF infra table + canonical deploy command**. Mark the other functions as still on the legacy pattern.


## Validation and Acceptance
1. `npm install` at root succeeds; `functions/creator-outreach/package-lock.json` is unchanged (8 runtime deps).
2. `npm run check:ci` passes and touches only creator-outreach + shared-config (no diff in other functions).
3. `npm run test:ci` runs vitest; all creator-outreach tests pass.
4. A non-conventional commit message is rejected by `commit-msg`; a conventional message passes. Staging a file outside creator-outreach/packages is **not** reformatted by lint-staged.
5. `pack build … --env GOOGLE_RUNTIME=nodejs22 --env GOOGLE_FUNCTION_TARGET=creatorOutreach` builds successfully (proves deploy won't fail). Validatable locally after a `pack` install, or via CI.
6. Push branch → open PR → `gh pr checks <PR>` shows `quality` and `dry-run-deploy` green.


## Idempotence and Recovery
Every artifact is additive. The rollout reverts cleanly by deleting root `package.json`/`nx.json`/`packages/`/`.husky/`/`.github/workflows/creator-outreach-build.yml` and the function's added config — returning the repo to per-directory installs. The one rule: **never delete `functions/creator-outreach/package-lock.json`**.


## Execution approach
Work in a dedicated worktree/branch off `dev`. Per repo conventions, delegate via **tech-lead** (cross-cutting infra + tests) → **cloud-engineer** (workspace, Biome, Nx, husky, CI, pack dry-run) and **backend-engineer** (vitest tests), then **product-owner** to validate against the acceptance checks. Commit per milestone. **Implementation is gated on explicit user go-ahead.**
