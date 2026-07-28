# Release Notes — creator-outreach deployment-pipeline hardening

| | |
|---|---|
| **Area** | `crafted_cloud_functions` — `functions/creator-outreach` (CI/CD hardening) |
| **ExecPlan** | `.agent/exec-plans/creator-outreach-modernization.md` (Decision Log, 2026-07-27) |
| **Week** | 2026-W31 |
| **Status** | Implemented on `feature/creator-outreach-deploy-hardening`. Deploy is operator-driven — see the checklist. |

## Summary

Hardening pass over the two-workflow `creator-outreach` deploy pipeline. The gating model is
**unchanged** — `creator-outreach-build.yml` still auto-deploys `dev` (push to `dev`) and `staging`
(push to `main`), and the separate `creator-outreach-deploy-prod.yml` (`workflow_dispatch`) stays
for on-demand prod promotion of an arbitrary ref. This ship adds two safety nets: a **cold-start
smoke test** that boots the compiled function and blocks any deploy if it can't start, and an
**explicit prod rollback-on-failure** that reverts Cloud Run traffic to the last-good revision if a
prod rollout fails.

## What changed

- **Cold-start smoke test (`cold-start-smoke` job in `creator-outreach-build.yml`).** A new job
  (`needs: quality`) generates a structurally-valid dummy Firebase service-account key into
  `functions/creator-outreach/config/devServiceAccountKey.json` **before** building (so `gcp-build`
  copies it into `dist/config/`), runs `npm run build`, then boots
  `functions-framework --target=creator-outreach` against the compiled `dist/` and probes `:8080`.
  The container is UP if `curl` gets **any** HTTP response (a 400 on the empty body is healthy
  validation); the job fails only if `curl` cannot connect after the retries — i.e. the module threw
  at import and never listened. This is the guard `node --check` cannot give: `node --check` in
  `build-preview` parses the entrypoint but never executes it, so it caught nothing when the Firebase
  key path broke at import time in PR #14. The dummy key is never committed (`config/` is gitignored).
- **Deploys gated on the smoke test.** `cold-start-smoke` is added to the `needs:` array of both
  `deploy-dev` and `deploy-staging`, so a failing cold-start blocks any deploy. The existing `if:`
  branch guards (`github.ref_name == 'dev'` / `github.ref == 'refs/heads/main'`) are unchanged.
- **Prod rollback-on-failure (`creator-outreach-deploy-prod.yml`).** Before the deploy step, a
  `Capture current serving revision` step (`id: prev`) records the currently-serving Cloud Run
  revision (guarded so it is a no-op on the first-ever deploy, when the service does not yet exist).
  After the deploy, an `if: failure()` step reverts traffic to that revision when one was captured.
  gen2/Cloud Run already keeps the last-good revision serving on a failed rollout (traffic never
  shifts to a revision that fails its healthcheck); this step is explicit belt-and-suspenders.
- **Root `build` script.** Added `"build": "nx run-many -t build"` to the root `package.json` so
  `npm run build` fans out to the creator-outreach build (matching how `check:ci`, `typecheck`, and
  `test:ci` are already wired, and as `CLAUDE.md` documents). The `cold-start-smoke` job depends on
  it.

## Results

- Both workflow files parse clean (PyYAML `safe_load`).
- The smoke recipe was executed locally end-to-end (npm ci → dummy key → `npm run build` → boot
  `functions-framework` → `curl :8080`): the compiled function booted and served **HTTP 400** on the
  empty body — a healthy validation response, proving the module imports and listens.
- `npm run typecheck` and `npm run test:ci` are green.

## Deploy checklist

The gating structure is unchanged, so the rollout is the same as the modernization ship
(`releases/2026-W30/creator-outreach-modernization.md`). This hardening adds **no new code deploy
step** — the smoke test and rollback run inside the existing workflows. The only remaining work is
the **manual GitHub Settings** (they are not code and cannot be expressed in the workflow YAML).

### Manual GitHub Settings (one-time, not code)

In repo **Settings → Environments**:

- **Environment branch policies** (each Environment's "Deployment branches and tags" →
  *Selected branches*): restrict `prod` ← `main`, `staging` ← `main`, `dev` ← `dev`. This is
  defense-in-depth at the platform layer; the in-code `if:` branch guards already scope
  `deploy-dev`/`deploy-staging` by branch, and the prod workflow is `workflow_dispatch`-only.
- **`prod` required reviewer**: on the `prod` Environment, add the required-reviewer protection rule
  so the manual prod promotion pauses for approval before `deploy-prod` runs.

### Rollout (unchanged from 2026-W30)

1. Merge `feature/creator-outreach-deploy-hardening` → `dev`. The `quality` + `cold-start-smoke`
   jobs run, then `deploy-dev` deploys `creator-outreach-dev`.
2. Merge `dev` → `main`. `deploy-staging` deploys `creator-outreach-staging` (again gated on the
   smoke test).
3. Promote to prod: Actions → **"creator-outreach Production Deploy"** → **Run workflow** → set
   `ref` to the validated SHA/tag → approve the required-reviewer prompt. On a failed rollout the
   traffic-revert step pins prod back to the previous revision. CLI equivalent:
   ```bash
   gh workflow run creator-outreach-deploy-prod.yml --ref main -f ref=<sha-or-tag>
   ```
