# Release Notes — creator-outreach modernization (TypeScript, Biome, vitest, multi-env CI/CD)

| | |
|---|---|
| **Area** | `crafted_cloud_functions` — `functions/creator-outreach` (infrastructure / tooling / CI/CD) |
| **ExecPlan** | `.agent/exec-plans/creator-outreach-modernization.md` |
| **Week** | 2026-W30 |
| **Status** | Implemented on `feature/creator-outreach-modernization` (M1–M11). Deploy is operator-driven — see the checklist. |

## Summary

`creator-outreach` — the HTTP-triggered Gen2 Cloud Function that scans the Firebase user base and
sends Studio/Amplify outreach emails on behalf of the `server` API — is now the modernization
**reference** for the `crafted_cloud_functions` repo. It moves from an untooled, plain-JavaScript
per-directory function to strict TypeScript with Biome, vitest, husky + commitlint, an Nx-driven
npm workspace, and full CI/CD: PR quality gate + buildpack dry-run, per-branch deploys to three
GCP projects, and a manual production promotion. The outreach behavior is unchanged; this is a
tooling/infrastructure modernization. Every other function in `functions/` stays on the legacy
per-directory JavaScript pattern (future work).

## What changed

- **TypeScript migration** of `functions/creator-outreach/` (`index.ts`, `function-handler.ts`,
  `lib/*.ts`) with a self-contained `tsconfig.json` (strict, `target ES2022`, `module commonjs`).
  Behavior-preserving; the `creator-outreach` naming invariant (registered target = `--entry-point`
  = deployed name) is kept.
- **TS build-at-deploy** via a `gcp-build` npm script: GCF Gen2 uploads TS source, runs `npm ci`
  against a standalone nested `package-lock.json`, then `gcp-build` (`tsc` + copy `templates/*.hbs`
  into `dist/templates/`); `package.json` `"main": "dist/index.js"`. Proven end-to-end by a
  credential-free `pack build` against `gcr.io/buildpacks/builder:google-22` (M7, exit 0).
- **Root npm workspace + Nx** (`package.json`, `nx.json`) and **`packages/shared-config/`**
  (`@crafted/shared-config`: Biome config + per-package lint-staged), mirroring `crafted-src`.
- **Biome** (`biome.json` extends the shared config), **vitest** unit tests under `__tests__/`
  (schemas, scanner matchers, email result/rate extraction, handler validate/scan/email/store),
  and **husky + commitlint** (`pre-commit` → lint-staged + tests; `commit-msg` → Conventional
  Commits).
- **CI/CD** — `.github/workflows/creator-outreach-build.yml` (`quality` = Biome + `tsc --noEmit` +
  vitest; `build-preview` = `pack build` dry-run; then branch-guarded `deploy-dev` →
  `crafted-dev-v1` and `deploy-staging` → `crafted-staging-v1`) and
  `.github/workflows/creator-outreach-deploy-prod.yml` (`workflow_dispatch` → `crafted-v1`, gated
  by the `prod` Environment's required reviewer).
- **Docs** — `README.md` gains the creator-outreach infrastructure + manual-deploy sections and a
  corrected folder/function list (no `studioOutreach`); `CLAUDE.md` gains a "Tooling & Standards
  (creator-outreach reference)" section with the TS-build-at-deploy contract and the per-env GCF
  infra table.

## Results

- `npm run check:ci`, `npm run typecheck`, `npm run test:ci`, `npm run build` all pass locally.
- The `pack build` buildpack dry-run compiles and produces a deployable image with no cloud
  credentials (M7 — the critical checkpoint that de-risked the whole TS-build-at-deploy model).
- The CI workflows parse clean (`actionlint`).
- Deploy posture is unchanged for the running integration: the endpoint stays public
  (`--allow-unauthenticated`) so the existing `server` → CF fire-and-forget calls keep working.

> **Auth is deliberately unchanged.** The function ships with `--allow-unauthenticated` (public
> `allUsers` invoker) in all three environments. Hardening (server-attached OIDC token +
> `roles/run.invoker` + dropping the public flag, CF and server shipping together) is a tracked
> fast-follow — Notion ticket [353] / `server/.agent/exec-plans/creator-outreach-auth.md` — and is
> **NOT** part of this ship.

## Per-environment deploy checklist

Do these in order. Steps 1–2 are one-time platform setup; 3–5 are the rollout dev → staging → prod.

### 0. One-time: GitHub Environments + secrets/variables

Configure three GitHub Environments (Settings → Environments): `dev`, `staging`, `prod`. On each,
set the secrets and variables per the **Secrets & Variables Matrix** in
`.agent/exec-plans/creator-outreach-modernization.md`:

- **Secrets:** `GCP_SA_KEY` (deploy service-account JSON key, per project), `FIREBASE_SA_KEY`
  (Firebase Admin SA JSON, materialized into `config/<env>ServiceAccountKey.json`),
  `SENDGRID_API_KEY`, `SENTRY_DSN`.
- **Variables:** `GCP_PROJECT` (`crafted-dev-v1` / `crafted-staging-v1` / `crafted-v1`),
  `GCP_REGION` (`us-central1`).
- On the **`prod`** Environment, add the **required-reviewer** protection rule so the manual prod
  deploy pauses for approval.

### 1. One-time: IAM roles on the deploy service account

Grant the deploy SA behind `GCP_SA_KEY` (per project) the roles the Gen2 build/deploy path needs
(Cloud Build → Artifact Registry → Cloud Run), per the ExecPlan matrix: **Cloud Functions
Developer, Cloud Run Admin, Cloud Build Editor, Artifact Registry Writer, Service Account User,
Storage Object Admin** (gcf source bucket).

> **Org-policy check:** the deploy uses `--allow-unauthenticated`. If an org policy forbids public
> Cloud Run services, the `allUsers` binding fails the deploy — in that case the auth fast-follow
> ([353]) becomes a hard dependency and the function must deploy privately with the server token
> from the start (see the ExecPlan Risks).

### 2. Deploy to dev

Push `feature/creator-outreach-modernization` → merge to `dev`. The `deploy-dev` job auto-deploys
to `crafted-dev-v1` and prints the `*.run.app` URL. Set the server's dev `CF_CREATOR_OUTREACH_URL`
to that URL. **Verify against the printed URL:**
- a valid **Studio** POST → **200**;
- a valid **Amplify** POST → **200**;
- an invalid body → **400**.

### 3. Deploy to staging

Merge `dev` → `main`. The `deploy-staging` job auto-deploys to `crafted-staging-v1` and prints the
URL. Set the staging `CF_CREATOR_OUTREACH_URL`. Repeat the Studio/Amplify/invalid checks.

### 4. Promote to prod (manual, gated)

Actions → **"creator-outreach Production Deploy"** → **Run workflow** → set `ref` to the SHA/tag
validated on `main`/staging → **Run**. Approve the required-reviewer prompt. The job deploys to
`crafted-v1` and prints the URL. Set the prod `CF_CREATOR_OUTREACH_URL`. CLI equivalent:
```bash
gh workflow run creator-outreach-deploy-prod.yml --ref main -f ref=<sha-or-tag>
```

### 5. Follow-up (NOT part of this ship)

Auth hardening — server-attached OIDC token, `roles/run.invoker` for the server's invoker SA, then
dropping `--allow-unauthenticated`, CF and server shipping together — is tracked as ticket [353] /
`server/.agent/exec-plans/creator-outreach-auth.md`. It ships as a separate coordinated PR.
