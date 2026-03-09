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

## Function Structure

### ✅ DO: One function per directory, index.js registers with framework
```
functions/
  refreshTokens/
    index.js       ← registers the function
    influencer.js  ← implementation
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

### ✅ DO: Wrap all functions with CORS
```js
const cors = require("cors")({ origin: true });

const myFunction = async (req, res) => {
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

---

## Firebase Connection

### ✅ DO: Use environment variable for Firebase config path
```js
const firebase = require(process.env.PRODEV); // points to correct serviceAccountKey.json
```

### Environment variables
- `PRODEV` — path to Firebase service account key file
- Set per environment (dev/staging/prod) in Cloud Functions config

---

## Firebase Batch Reads (Large Collections)

### ✅ DO: Always paginate large Firebase reads in batches of 100
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

### ❌ DON'T: Read entire users collection at once
```js
// WRONG — will timeout or OOM on large collections (4,000+ users)
const snap = await firebase.database().ref("users").once("value");
```

---

## TikTok API

### Token Refresh
```js
// TikTok OAuth token refresh
const body = new URLSearchParams({
  client_key: "awdpgd7ih1asm72a",
  client_secret: "357014f753c08457f74c0e3115a2c3c1",
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

### ✅ DO: Write both new access_token AND refresh_token back to Firebase
```js
await firebase.database().ref(`users/${uid}/creator_socials/tiktok`).update({
  access_token: data.access_token,
  refresh_token: data.refresh_token, // TikTok rotates refresh tokens
  updated_at: Date.now(),
});
```

### ❌ DON'T: Only update access_token — refresh_token also rotates
```js
// WRONG — old refresh_token becomes invalid after use
await firebase.database().ref(`users/${uid}/creator_socials/tiktok/access_token`).set(data.access_token);
```

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

### ❌ DON'T: Assume IG tokens are valid — always handle error code 190
```js
// WRONG — will throw on expired token
const { data } = await axios.get(igUrl);
const pic = data.profile_picture_url; // undefined if token expired
```

---

## Token Storage in Firebase

### User social token paths
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

### ✅ DO: Cache profile data during token refresh to avoid extra API calls
```js
await firebase.database().ref(`users/${uid}/creator_socials/tiktok`).update({
  access_token: data.access_token,
  refresh_token: data.refresh_token,
  avatar_url: userInfo.avatar_url,      // cache it here
  display_name: userInfo.display_name,  // cache it here
  updated_at: Date.now(),
});
```

---

## Error Handling

### ✅ DO: Log errors and continue processing other users (batch jobs)
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

### ❌ DON'T: Let one user's error kill the entire batch
```js
// WRONG
await Promise.all(userKeys.map(uid => processUser(uid, users[uid]))); // one error kills all
```

---

## Concurrency

### ✅ DO: Batch Promise.all within each page, not across all users
```js
// Process each page of 100 users concurrently, but page-by-page
while (moreUsers) {
  // ... fetch batch
  await Promise.all(keys.map(key => processUser(key, users[key]))); // ✅ 100 concurrent
}
```

### ❌ DON'T: Collect all promises and await at the end
```js
// WRONG — 4000 simultaneous Firebase writes will overwhelm connection pool
const allPromises = [];
while (moreUsers) {
  allPromises.push(...keys.map(key => processUser(key, users[key])));
}
await Promise.all(allPromises); // explodes
```

---

## Git Commit Convention
```
feat: add Instagram profile picture caching during token refresh
fix: handle TikTok refresh_token rotation correctly
chore: update Firebase SDK
```
