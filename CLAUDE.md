# CLAUDE.md — Cloud Functions Code Patterns & Conventions

This file defines the patterns and anti-patterns for the Crafted Cloud Functions (Google Cloud Functions Framework).
Read this before making any changes.

---

## Branch Flow
```
dev → main
```

## Runtime
- Google Cloud Functions Framework (`@google-cloud/functions-framework`)
- Node.js, Firebase Realtime Database, REST APIs (TikTok, Instagram Graph API)
- Deployed as individual HTTP-triggered functions

---

## Repository Structure

```
functions/
├── creator-outreach/              ← Studio + Amplify outreach (scan, email, store results)
├── getBalancedUsers/              ← Retrieves users with balances
├── loadUsers/                     ← Loads/reformats user data
├── processInstagramComments/      ← Processes Instagram post comments
├── refreshAllCampaignAnalytics/   ← Refreshes TikTok + Instagram campaign analytics
├── refreshInstagramRates/         ← Updates Instagram suggested rates for creators
├── refreshTikTokRates/            ← Updates TikTok suggested rates
├── refreshTokens/                 ← Refreshes social API auth tokens
├── updateCampaignCreatorSocials/  ← Updates creator social data in campaigns
├── updateInstagramDemographics/   ← Updates Instagram demographic data
maintenance/                       ← One-off utility scripts (not deployed functions)
```

Each function folder contains:
- `index.js` — GCF registration (1-3 lines)
- `package.json` — function-specific dependencies
- Supporting `.js` files with implementation

The `maintenance/` directory holds data migration and one-off scripts (asset/draft inserts, analytics fixes, user queries). These are run manually and are not deployed as Cloud Functions.

---

## Tooling & Standards (creator-outreach reference)

`functions/creator-outreach/` is the **modernization reference** and is the only function on the
tooling below. **Every other function in `functions/` remains on the legacy per-directory
JavaScript pattern** (standalone `package.json`, no shared lint/type/test, no CI) documented in
the rest of this file. Migrating the rest to this template is future, separately green-lit work.
Full design context: `.agent/exec-plans/creator-outreach-modernization.md`.

- **npm workspace + Nx.** The repo root is a private npm workspace (`workspaces: ["packages/*",
  "functions/creator-outreach"]`) orchestrated by Nx. Root scripts fan out per-project via
  `nx run-many -t <target>`: `npm run check:ci`, `npm run typecheck`, `npm run test:ci`,
  `npm run build`. Only `creator-outreach` is a member, so these never touch sibling functions.
- **TypeScript.** `creator-outreach` is strict TypeScript; CI runs an explicit `tsc --noEmit`
  typecheck in addition to the build. Runtime is `nodejs22` throughout (`engines`, `.nvmrc`,
  `tsc` `target: ES2022`, the `google-22` buildpack builder, and every `--runtime=nodejs22`).
- **Biome** via `@crafted/shared-config` (`packages/shared-config/`, mirror of crafted-src): the
  function's `biome.json` `extends` `@crafted/shared-config/biome` (4-space indent, 120-char
  lines, double quotes). Biome is a **root-level dev tool only** — never a function dependency.
  Because Biome 2.x refuses a nested-root config from the workspace root, it is always run
  per-project with cwd = the project dir (which is exactly how Nx invokes each package's
  `check:ci`).
- **vitest** unit tests under `functions/creator-outreach/__tests__/`; the import-time-side-effect
  modules (`lib/firebase`, `lib/sentry`, `@sendgrid/mail`) are mocked.
- **commitlint + husky.** Conventional Commits enforced by the `commit-msg` hook; `pre-commit`
  runs lint-staged (Biome, per-package `.lintstagedrc.mjs` placement) + tests. `prepare: husky`
  lives **only** in the root `package.json` — never in the function manifest (a `prepare` script
  would run during the GCF build, which has no `.git`, and could fail the deploy).
- **CI/CD.** `.github/workflows/creator-outreach-build.yml` runs `quality` (Biome + typecheck +
  vitest) and `build-preview` (a `pack build` buildpack **dry-run**, credential-free) on PRs with
  no deploy, then deploys on push to `dev` (function `creator-outreach-dev`) and `main` (function
  `creator-outreach-staging`) — both into the **single shared hosting project** (repo-level
  `GCP_PROJECT`). `.github/workflows/creator-outreach-deploy-prod.yml` is the `workflow_dispatch`
  prod promotion (function `creator-outreach-prod`), gated by the `prod` GitHub Environment's
  required reviewer. The shared deploy config (`GCP_PROJECT`, `GCP_REGION`, `GCP_SA_KEY`) plus the
  `SENDGRID_API_KEY` and `SENTRY_DSN` runtime secrets are **repo-level** (set once — identical
  across all envs). The **only per-env secret is `FIREBASE_SA_KEY`** (the dev/staging/prod Firebase
  data projects genuinely differ); it stays in the three GitHub Environments (`dev`/`staging`/`prod`)
  along with the `prod` required-reviewer gate. A repo-level `secrets.*` value is still picked up by
  jobs that declare `environment:` (GitHub precedence is environment → repository) — see the
  "Secrets & Variables Matrix" in the ExecPlan.

### TS build-at-deploy contract (do not break)

GCF Gen2 uploads **TypeScript source** and builds it at deploy: `npm ci` against the standalone
nested `package-lock.json`, then the `gcp-build` script (`tsc`, copy `templates/*.hbs` into
`dist/templates/`, and copy any `config/*.json` into `dist/config/`); `package.json`
`"main": "dist/index.js"`. Therefore:

- `tsconfig.json` is **self-contained** — no `extends` of a workspace path.
- The function manifest **never** lists `@crafted/shared-config` (or any private workspace pkg).
- `functions/creator-outreach/package-lock.json` is standalone and public-registry-only, and is
  **not** maintained by a root `npm install` — regenerate it deliberately when deps change (see
  the ExecPlan "Concrete Steps"). The PR `pack build` runs `npm ci` and fails on lockfile drift.
- The registered target and `--entry-point` are the identical string `creator-outreach` (the
  in-code `functions.http` target); the DEPLOYED name carries an env suffix
  (`creator-outreach-<env>`) because all three environments share one hosting project and are
  isolated by name. Both the Handlebars templates (for `lib/email.ts`) and the Firebase key file
  `config/*.json` (for `lib/firebase.ts`) must be copied under `dist/` by `gcp-build` — each
  resolves its asset via `__dirname/..`, which is `dist/lib` at runtime — or the module throws at
  cold start (the container then fails its healthcheck and never listens on PORT 8080).

### GCF infra (Gen2 / Cloud Run-backed) — per environment

**One shared hosting project holds all three environments; the environment is encoded in the
deployed function name** (env-in-name, not env-in-project). Identical shape across environments;
only the deployed function name, `NODE_ENV`, and Firebase key differ. `NODE_ENV` (set via
`env.yaml`) selects the Firebase **data** project's database URL + `config/*ServiceAccountKey.json`
in `lib/firebase.ts` and the Sentry `environment`.

| Setting | Value |
|---|---|
| Generation / runtime | Gen2 (Cloud Run-backed), nodejs22 |
| Region | `us-central1` |
| Entry point / in-code target | `creator-outreach` (identical; unchanged per deploy) |
| Deployed function name | `creator-outreach-<env>` — `creator-outreach-dev` / `-staging` / `-prod` |
| Hosting GCP project | single shared project (repo-level `GCP_PROJECT`) for all 3 envs |
| Trigger | HTTP |
| Resources / concurrency / timeout / max | 2 vCPU, 4Gi, concurrency 1, 3600s, max 50 |
| Runtime service account | default compute `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com` |
| Runtime env | `NODE_ENV=<dev\|staging\|prod>`, `LOG_EXECUTION_ID=true` |
| Auth | `--allow-unauthenticated` (public `allUsers` invoker) in all 3 envs — hardening deferred to ticket [353] / `server/.agent/exec-plans/creator-outreach-auth.md` |
| Firebase **data** project (per `NODE_ENV`) | `crafted-dev-v1` / `crafted-staging-v1` / `crafted-v1` — still per-env, selected in `lib/firebase.ts`; NOT the deploy `--project` |

---

## Function Structure

### One function per directory, index.js registers with framework
```
functions/
  refreshTokens/
    index.js       <- registers the function
    influencer.js  <- implementation
  processInstagramComments/
    index.js
    instagram.js
```

```js
// index.js
const functions = require("@google-cloud/functions-framework");
const { refreshTiktokAccessTokens } = require("./influencer");
functions.http("refreshTiktokAccessTokens", refreshTiktokAccessTokens);
```

### Function target name = `--entry-point`; deployed name may carry an env suffix

The hard invariant is that the string passed to `functions.http(<target>, …)` and the gcloud `--entry-point` **must be the same string** — a mismatch deploys but fails at cold start with `Function '<name>' is not defined in the provided module`. The canonical target matches the function's **directory**: `creator-outreach` registers `functions.http("creator-outreach", …)` and uses `--entry-point=creator-outreach`. The imported handler stays a valid JS identifier (e.g. `creatorOutreach`) — only the registered target string is kebab-case. (Some older functions use camelCase targets like `refreshTiktokAccessTokens`; new functions use their kebab-case directory name.)

The **deployed Cloud Function name is independent** of the target/entry-point. For a legacy function deployed once to a single project it happens to match them (`creator-outreach` → `creator-outreach`). For `creator-outreach`, all three environments now share **one hosting GCP project** and are isolated by **name**: the deploy keeps `--entry-point=creator-outreach` but names the function `creator-outreach-<env>` (`creator-outreach-dev` / `-staging` / `-prod`) — env-in-name, not env-in-project. Do not add the env suffix to the in-code `functions.http` target; only the deployed name is suffixed.

### Wrap all functions with CORS
```js
const cors = require("cors")({ origin: true });

const myFunction = (req, res) => {
  cors(req, res, async () => {
    try {
      // ... logic
      res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: error.message });
    }
  });
};
```

### Local development
```bash
cd functions/{function-name}
npm install
# Create .env with required variables
npm run dev  # starts on http://localhost:8080
```

---

## Firebase Connection

Legacy functions use the `PRODEV` environment variable pointing to a service account key:
```js
const firebase = require(process.env.PRODEV);
```

The `creator-outreach` function uses a multi-env pattern via `NODE_ENV` (`dev` | `staging` | `prod`), mapping to separate database URLs and key files. This is the preferred pattern for new functions.

---

## Firebase Batch Reads (Large Collections)

### Always paginate large Firebase reads in batches of 100
```js
const batchSize = 100;
let lastKey = null;
let moreUsers = true;

while (moreUsers) {
  let query = firebase.database().ref("users").orderByKey().limitToFirst(batchSize);
  if (lastKey) query = query.startAfter(lastKey);

  const snapshot = await query.once("value");
  const users = snapshot.val();
  const keys = users ? Object.keys(users) : [];

  if (!users || keys.length === 0) break;
  lastKey = keys[keys.length - 1];
  if (keys.length < batchSize) moreUsers = false;

  // Process batch...
  await Promise.all(keys.map(key => processUser(key, users[key])));
}
```

### Never read entire users collection at once
```js
// WRONG — will timeout or OOM on large collections (4,000+ users)
const snap = await firebase.database().ref("users").once("value");
```

---

## TikTok API

### Token Refresh
```js
const body = new URLSearchParams({
  client_key: process.env.TIKTOK_CLIENT_KEY,
  client_secret: process.env.TIKTOK_CLIENT_SECRET,
  grant_type: "refresh_token",
  refresh_token: refreshToken,
}).toString();

const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});
const data = await res.json();
const newAccessToken = data.access_token;
const newRefreshToken = data.refresh_token;
```

### Get user info (avatar, display name)
```js
const userRes = await fetch(
  "https://open.tiktokapis.com/v2/user/info/?fields=avatar_url,display_name,follower_count",
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
const { data: { user } } = await userRes.json();
// user.avatar_url, user.display_name, user.follower_count
```

### Write both new access_token AND refresh_token back to Firebase
```js
await firebase.database().ref(`users/${uid}/creator_socials/tiktok`).update({
  access_token: data.access_token,
  refresh_token: data.refresh_token, // TikTok rotates refresh tokens
  updated_at: Date.now(),
});
```

TikTok rotates refresh tokens on each use. Only updating `access_token` invalidates the old `refresh_token`.

---

## Instagram / Facebook Graph API

### Long-lived token info
- Tokens last **60 days** and cannot be refreshed after expiry
- Stored at: `users/{uid}/creator_socials/instagram/access_token`
- Business account ID: `users/{uid}/creator_socials/instagram/instagram_business_account_id`

### Get IG profile picture
```js
const url = `https://graph.facebook.com/v24.0/${igBusinessAccountId}?fields=profile_picture_url,username&access_token=${accessToken}`;
const res = await fetch(url);
const data = await res.json();

// Handle expired tokens
if (data.error?.code === 190) {
  console.log(`Token expired for user ${uid}`);
  return;
}
// data.profile_picture_url, data.username
```

Always handle error code 190 (expired token) — never assume IG tokens are valid.

---

## Token Storage in Firebase

```
users/{uid}/creator_socials/
  instagram/
    access_token              — FB long-lived token (60 days, no refresh)
    instagram_business_account_id
    username
  tiktok/
    access_token              — TikTok access token
    refresh_token             — TikTok refresh token (rotates on each use)
    avatar_url                — cached from last refresh
    display_name
```

Cache profile data during token refresh to avoid extra API calls.

---

## Error Handling

### Log errors and continue processing other users (batch jobs)
```js
const promises = userKeys.map(async (uid) => {
  try {
    await processUser(uid, users[uid]);
  } catch (error) {
    console.error(`Error processing user ${uid}:`, error.message);
    // don't throw — let other users continue processing
  }
});
await Promise.all(promises);
```

Never let one user's error kill the entire batch.

---

## Concurrency

### Batch Promise.all within each page, not across all users
```js
// Process each page of 100 users concurrently, but page-by-page
while (moreUsers) {
  // ... fetch batch
  await Promise.all(keys.map(key => processUser(key, users[key])));
}
```

Never collect all promises across pages and await at the end — 4,000 simultaneous Firebase writes will overwhelm the connection pool.

---

## Anti-patterns

- Committing API keys, Firebase credentials, or social API tokens
- Sharing state between functions — each function is stateless and independently deployed
- Reading the entire `users` collection at once — always paginate
- Long-running synchronous operations — GCF has execution time limits
- Letting one user's error crash an entire batch job

---

## Git Commit Convention
```
feat: add Instagram profile picture caching during token refresh
fix: handle TikTok refresh_token rotation correctly
chore: update Firebase SDK
```
