# CLAUDE.md — crafted_cloud_functions/

---

## 1. Business purpose

Google Cloud Functions (GCF) for Firebase-backed background processing and integrations. These functions handle:
- Instagram analytics data collection and refresh
- TikTok rate and analytics refresh
- Campaign analytics refresh
- Creator social data updates
- Firebase data loading utilities
- Studio and Amplify asset/draft management
- Campaign outreach email sending

These are internal backend functions — not directly user-facing. They support the Crafted Amplify/Studio platform (brand and creator side).

---

## 2. Technical role

Serverless **Google Cloud Functions** (HTTP trigger or Firebase callable) deployed from this directory. Each function is independently deployable. Functions communicate with **Firebase Firestore/Realtime Database** and external social APIs (Instagram, TikTok).

This is a **separate git repository root** (has its own `.git/`). It is a legacy system — part of the original Crafted platform alongside `api/` and `crafted-react-app/`.

---

## 3. Important files and subfolders

```
functions/
├── getBalancedUsers/               ← Retrieves users with balances
├── loadUsers/                      ← Loads/reformats user data
├── processInstagramComments/       ← Processes Instagram post comments
├── refreshAllCampaignAnalytics/    ← Refreshes TikTok + Instagram campaign analytics
├── refreshInstagramRates/          ← Updates Instagram suggested rates for creators
├── refreshTikTokRates/             ← Updates TikTok suggested rates
├── refreshTokens/                  ← Refreshes social API auth tokens
├── studioOutreach/                 ← Sends campaign brief emails to creators
├── updateInstagramDemographics/    ← Updates Instagram demographic data
├── updateCampaignCreatorSocials/   ← Updates creator social data in campaigns
├── getCampaignAssets/              ← Reads campaign asset data
├── getCampaignPosts/               ← Reads campaign post data
├── getCreatorsStudioDrafts/        ← Reads Studio draft data
├── getStudioAssets/                ← Reads Studio asset data
├── insertAmplifyAssets/            ← Writes Amplify asset data
├── insertAmplifyDrafts/            ← Writes Amplify draft data
├── insertStudioAssets/             ← Writes Studio asset data
└── insertStudioDrafts/             ← Writes Studio draft data
maintenance/                        ← Maintenance/utility scripts
```

Each function folder contains:
- `index.js` — function entry point
- `package.json` — function-specific dependencies
- Supporting `.js` files (e.g., `user.js`, `campaign.js`)

---

## 4. Libraries and frameworks

| Library | Purpose |
|---|---|
| `@google-cloud/functions-framework` | Local GCF development/testing |
| `firebase-admin` | Firebase Admin SDK (Firestore, Auth) |
| `firebase` | Firebase client SDK |
| `axios` | External API HTTP calls (Instagram, TikTok) |
| `dotenv` | Local environment configuration |

---

## 5. Patterns used here

### Function entry point
```javascript
// functions/{functionName}/index.js
const functions = require('@google-cloud/functions-framework');

functions.http('functionName', async (req, res) => {
    // handler logic
    res.json({ result: ... });
});
```

### Local development
```bash
cd functions/{function-name}
npm install
# Create .env with required variables
npm run dev  # starts on http://localhost:8080
```

### Firebase access
Functions use `firebase-admin` for Firestore/Realtime Database access. Credentials are configured via GCP service account (not committed).

### External API integrations
Instagram and TikTok APIs are called via `axios`. Tokens are stored in Firebase and refreshed by `refreshTokens/`.

---

## 6. Anti-patterns to avoid

- Committing API keys, Firebase credentials, or social API tokens in any function directory
- Sharing state between functions — each function is stateless and independently deployed
- Adding long-running synchronous operations — GCF has execution time limits
- Duplicating Firebase access logic that already exists in `api/` — check if the operation belongs in the Express API instead

---

## 7. Guidance for future code changes

**To add a new function:**
1. Create a new directory under `functions/`
2. Add `index.js` with the function handler and `package.json`
3. Test locally: `npm run dev`
4. Deploy via GCloud CLI: `gcloud functions deploy {functionName} --runtime nodejs18 --trigger-http`

**Before editing an existing function:**
- Read its `index.js` fully — functions can be short but dense
- Check if the same operation could be done in `api/` instead (avoids split ownership)

---

## 8. Open questions / ambiguities

- This directory is a separate git repository root — `git` operations here are scoped to its own history, separate from the crafted_web root repo.
- The `maintenance/` folder contains maintenance scripts — their purpose and operational context are not documented.
- Some function names suggest overlapping concerns with `api/` services (e.g., `refreshAllCampaignAnalytics` vs `AIReportsService.js` in api) — check both before making analytics-related changes.
- Deployment automation status is unclear — functions may be manually deployed via CLI rather than CI/CD.
