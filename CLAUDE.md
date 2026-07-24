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

### Function target name = `--entry-point` = deployed name

The string passed to `functions.http(<target>, …)`, the gcloud `--entry-point`, and the deployed Cloud Function name **must be the same string**. A mismatch deploys but fails at cold start with `Function '<name>' is not defined in the provided module`. The canonical name matches the function's **directory**: `creator-outreach` registers `functions.http("creator-outreach", …)`, deploys as `creator-outreach`, and uses `--entry-point=creator-outreach`. The imported handler stays a valid JS identifier (e.g. `creatorOutreach`) — only the registered target string is kebab-case. (Some older functions use camelCase targets like `refreshTiktokAccessTokens`; new functions use their kebab-case directory name.)

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
