# Build unified `creator-outreach` Cloud Function

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. This document follows the ExecPlan format defined in `server/.agent/PLANS.md` (the canonical PLANS.md for this project family).


## Purpose / Big Picture

Today, creator outreach emails are sent from two separate codepaths: a Cloud Function (`functions/studioOutreach/`) handles Studio brief invites, and server-side controller logic (`server/controller/influencer.js:644-713`) handles Amplify campaign invites. Both scan the `users` collection in Firebase, match creators by criteria, and send personalized emails via SendGrid. Both have critical bugs: no input validation, N+1 Firebase reads in the Studio path (7 reads per creator per email), null crashes on missing `shipping_details`, silent error swallowing, hardcoded production-only Firebase config, and 20 unused dependencies.

After this change, a single Cloud Function at `functions/creator-outreach/` will handle both products. It accepts a JSON body with a `product` field ("studio" or "amplify") that routes to the correct scanning logic, email template, and Firebase storage path. The function validates input with Zod, fetches brand data once per request (not per creator), renders Handlebars templates, sends bulk emails via SendGrid, and stores results in the correct Firebase paths.

To verify: run `cd functions/creator-outreach && npm install && npm run dev`, then send a POST with a Studio payload and an Amplify payload via curl. Both should return a success response with `blastResults` containing sent/failed counts and message IDs. Validation errors should return 400 with specific Zod error messages. Sentry should capture any unexpected errors.


## Progress

- [x] Milestone 1: Infrastructure scaffolding (package.json, firebase.js, sentry.js, .env.example, index.js)
- [x] Milestone 2: Zod schemas (lib/schemas.js)
- [x] Milestone 3: Handlebars templates (templates/*.hbs)
- [x] Milestone 4: Scanner module (lib/scanner.js)
- [x] Milestone 5: Email service (lib/emailService.js)
- [x] Milestone 6: Main handler (function-handler.js) and integration
- [ ] Milestone 7: Local testing with curl (requires dev Firebase service account key + SendGrid API key)


## Surprises & Discoveries

- The old studioOutreach/firebase_connect.js imports both `firebase` (client SDK) and `firebase-admin` — but only uses `admin`. The client SDK import is dead code. New firebase.js uses only `firebase-admin`.
- The old studioOutreach/package.json lists 21 deps but only 4 are imported. The remaining 17 are dead weight (puppeteer, openai, stripe, etc.). Trimmed to exactly 8.
- The Studio template in server/ has a `<title>Invitation to {{campaign_name}}</title>` but Studio doesn't have a `campaign_name` field — it uses `task_name`. Left as-is since email titles are not user-visible and it matches the original template.


## Decision Log

- Decision: Use 8 dependencies only: `@google-cloud/functions-framework`, `firebase-admin`, `@sendgrid/mail`, `@sentry/node`, `cors`, `dotenv`, `handlebars`, `zod`. Remove all 20 unused deps from the original `studioOutreach/package.json`.
  Rationale: The original package.json includes puppeteer, openai, stripe, agora, express, moment, nodemailer, and many others that are never imported. Fewer deps means faster cold starts and smaller attack surface.
  Date/Author: 2026-05-27

- Decision: Use Handlebars instead of regex string replacement for email templates.
  Rationale: The original code uses fragile regex replacement (`template.replace(/{{brand_name}}/g, ...)`) which breaks on nested templates and requires manual conditional removal of HTML sections. Handlebars provides `{{#if}}` blocks natively, which makes the Studio template's optional `note3` and `brief_link` sections clean.
  Date/Author: 2026-05-27

- Decision: Multi-env Firebase config via `NODE_ENV` instead of the `PRODEV` env var pattern.
  Rationale: The existing `PRODEV` pattern (`require(process.env.PRODEV)`) requires the env var to be a file path string pointing to a module, which is fragile and non-standard. A `NODE_ENV` switch is explicit, testable, and matches the server's pattern in `server/firebase/firebase_connect.js`.
  Date/Author: 2026-05-27


## Outcomes & Retrospective

(To be filled at completion.)


## Context and Orientation

This work happens in the `crafted_cloud_functions` repository. The relevant source files and their roles:

**Files being replaced (the old `studioOutreach` function):**

- `functions/studioOutreach/index.js` (4 lines) — Registers the Cloud Function with `@google-cloud/functions-framework`. The function name is `findCreatorsForStudioBrief`.
- `functions/studioOutreach/task.js` (121 lines) — The main handler. Extracts `brand_id`, `message`, `task` from `req.body`, then paginates through the Firebase `users` collection in batches of 100 (lines 18-71). For each user, it checks if they have `creator_tasks` and if their shipping state/country matches the task's regions (lines 41-68). After scanning, it calls `email.inviteCreators()` and stores results at `tasks/{task.uid}/invites` (lines 73-94).
- `functions/studioOutreach/email.js` (153 lines) — The email sender. The critical N+1 bug is at lines 90-97: the `for (const creator of creators)` loop calls `fetchEmailData()` on every iteration, which makes 7 Firebase reads per creator. `fetchEmailData` (lines 10-68) reads brand_name, brand_email, creator_email, creator_name, creator_fullname, task_name, and task_brief — but brand_name and brand_email are the same for every creator and should be fetched once. The template uses `fs.readFileSync('./StudioBriefInvite.html')` and regex replacement.
- `functions/studioOutreach/firebase_connect.js` (11 lines) — Hardcoded to production Firebase project `crafted-v1` with `serviceAccountKey.json`. No dev or staging support.
- `functions/studioOutreach/package.json` — Lists 21 dependencies, of which only 4 are actually imported (`@google-cloud/functions-framework`, `@sendgrid/mail`, `cors`, `dotenv`). Firebase is imported via `PRODEV` env var, not from `package.json`.

**Server-side files being consolidated into this function (Amplify path):**

- `server/utils/influencer.js:15-72` — The `getMatchingCreators()` function. Takes `{ users, platforms, states, minFollowerCount, maxFollowerCount }` and filters users by: (a) both TikTok and Instagram follower counts must exist (`!== undefined`), (b) combined follower count (TikTok + Instagram) falls within `[min, max]`, (c) user's state matches `states` array (or states is `["USA"]` which matches all), (d) user has at least one platform from the `platforms` array. Handles comma-separated follower count strings (lines 33-40). Returns `{ creator_socials, email, id, shipping_details }`.
- `server/services/emailService.js:116-173` — The `sendCampaignInviteEmails()` function. Fetches `admin/pricing` for `creator_amplify_video_price`, then fetches brand_name and brand_email (once, not per-creator — this is correct). For each creator, calculates `suggestedRate` as `parseInt((tiktokRate || 0) / 100 + (igRate || 0) / 100) + prices.creator_amplify_video_price / 100`. Skips creators without either suggested rate. Uses `sgMail.send(personalizations, true)` for bulk sending.
- `server/services/emailService.js:175-237` — The `sendStudioBriefInviteEmails()` function. Similar to above but for Studio: fetches brand data once, conditionally removes `note3` and `brief_link` HTML sections via regex, sends one-by-one via `transporter.sendMail()` (not bulk).

**Email templates to convert to Handlebars:**

- `server/emailTemplates/StudioBriefInvite.html` (123 lines) — Studio template. Placeholders: `{{name}}`, `{{brand_name}}`, `{{brand_email}}`, `{{task_name}}`, `{{price}}`, `{{note1}}`, `{{note2}}`, `{{note3}}`, `{{brief_link}}`. Has `lang="e"` bug on line 1 (should be `lang="en"`). The `note3` and `brief_link` list items need `{{#if}}` conditionals.
- `server/campaignEmailTemplates/CampaignInviteInNetwork.html` (124 lines) — Amplify template. Placeholders: `{{name}}`, `{{brand_name}}`, `{{brand_email}}`, `{{message}}`, `{{campaign_name}}`, `{{suggested_rate}}`. Also has `lang="e"` bug. No conditionals needed.

**Firebase storage paths (storeResults):**

- Studio: `tasks/{task.uid}/invites` — single `.set()` with the blast results object (`{ messages, sent, failed }`).
- Amplify: atomic multi-path update to two paths — `brands/{brandId}/influencer_campaigns/{campaignId}/invites` and `influencer_campaigns/{campaignId}/invites`. This is done by `CampaignService.updateCampaignInviteResults()` in `server/services/campaignService.js:1246`.


## Plan of Work

The new function lives at `functions/creator-outreach/` with this structure:

    functions/creator-outreach/
      index.js
      function-handler.js
      lib/
        firebase.js
        sentry.js
        schemas.js
        scanner.js
        emailService.js
      templates/
        StudioBriefInvite.hbs
        CampaignInviteInNetwork.hbs
      config/              (gitignored — service account keys)
      .env.example
      package.json


### Milestone 1 — Infrastructure scaffolding

Create the directory structure and foundational files.

**`package.json`** — Name the package `creator-outreach`. Set `main` to `index.js`. Scripts: `"dev": "functions-framework --target=creatorOutreach"`, `"start": "node index.js"`. Dependencies (exactly 8, no more):

    @google-cloud/functions-framework  ^3.0.0
    firebase-admin                     ^9.9.0
    @sendgrid/mail                     ^7.7.0
    @sentry/node                       ^7.112.2
    cors                               ^2.8.5
    dotenv                             ^16.0.0
    handlebars                         ^4.7.8
    zod                                ^3.23.0

**`.env.example`** — Three variables:

    NODE_ENV=development
    SENDGRID_API_KEY=SG.YOUR-SENDGRID-API-KEY
    SENTRY_DSN=https://YOUR-DSN@o0000000000.ingest.us.sentry.io/0000000000

**`lib/firebase.js`** — Initialize Firebase Admin SDK. Map `NODE_ENV` to project config:

- `development` → database URL `https://crafted-dev-v1-default-rtdb.firebaseio.com`, key file `config/devServiceAccountKey.json`
- `staging` → database URL `https://crafted-staging-v1-default-rtdb.firebaseio.com`, key file `config/stagingServiceAccountKey.json`
- `production` → database URL `https://crafted-v1.firebaseio.com`, key file `config/serviceAccountKey.json`

Use `admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL })`. Export the app. If the key file does not exist at the resolved path, throw a clear error message saying which file is missing and what `NODE_ENV` is set to. Use `path.resolve(__dirname, '..', keyPath)` to resolve relative to the function root.

**`lib/sentry.js`** — Initialize Sentry and export the `Sentry` object:

    const Sentry = require("@sentry/node");
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || "development" });
    module.exports = Sentry;

**`index.js`** — Three lines:

    const functions = require("@google-cloud/functions-framework");
    const { creatorOutreach } = require("./function-handler");
    functions.http("creatorOutreach", creatorOutreach);

**Verification:** Run `cd functions/creator-outreach && npm install`. Confirm no install errors. The `function-handler.js` does not exist yet, so the function will not start — that is expected.


### Milestone 2 — Zod schemas

Create `lib/schemas.js`. Define a Zod discriminated union on the `product` field with two branches.

**Studio schema** (discriminator: `product: z.literal("studio")`):

    brand_id: z.string().min(1)
    message: z.string().default("")
    task: z.object({
      id: z.string(),
      uid: z.string(),
      name: z.string(),
      regions: z.array(z.object({ value: z.string() })).min(1),
      price: z.number().positive(),
      note1: z.string().optional(),
      note2: z.string().optional(),
      note3: z.string().optional(),
      brief_link: z.string().optional(),
    }).passthrough()

**Amplify schema** (discriminator: `product: z.literal("amplify")`):

    brand_id: z.string().min(1)
    message: z.string()
    campaign_id: z.string().min(1)
    campaign_name: z.string().min(1)
    follower_count: z.array(z.number()).length(2)
    platforms: z.array(z.enum(["tiktok", "instagram"])).min(1)
    states: z.array(z.string()).min(1)

Both schemas use `.passthrough()` at the top level so that extra fields sent by the frontend (like `email_body`, `platform`) do not cause validation errors. The discriminated union is `z.discriminatedUnion("product", [studioSchema, amplifySchema])`.

Export the union schema as `outreachRequestSchema`.

**Verification:** This is a pure data definition file. Verification happens in milestone 6 when the handler uses it.


### Milestone 3 — Handlebars templates

Create two `.hbs` files in `templates/`.

**`templates/StudioBriefInvite.hbs`** — Copy `server/emailTemplates/StudioBriefInvite.html` verbatim, then make these changes:
1. Line 1: Change `lang="e"` to `lang="en"`.
2. Lines 101-102: Wrap the `note3` list item in `{{#if note3}}...{{/if}}`.
3. Lines 102-103: Wrap the `brief_link` list item in `{{#if brief_link}}...{{/if}}`.
4. No other changes — all `{{placeholders}}` are already valid Handlebars syntax since the original template uses double-brace notation.

The final template will contain these conditional sections in the `<ul>`:

    <li>Product: <strong>{{note1}}</strong></li>
    <li>Target Audience: <strong>{{note2}}</strong></li>
    {{#if note3}}<li>Additional Information: <strong>{{note3}}</strong></li>{{/if}}
    {{#if brief_link}}<li>Brief Link: <strong>{{brief_link}}</strong></li>{{/if}}

**`templates/CampaignInviteInNetwork.hbs`** — Copy `server/campaignEmailTemplates/CampaignInviteInNetwork.html` verbatim, then change `lang="e"` to `lang="en"` on line 1. No other changes — there are no conditional sections in the Amplify template.

**Verification:** Open both `.hbs` files and confirm the `lang="en"` fix and the `{{#if}}` blocks are present and syntactically correct.


### Milestone 4 — Scanner module

Create `lib/scanner.js`. This module exports a single function `scanCreators(firebase, data)` that returns an array of matching creator objects.

The function uses batched pagination (100 users at a time) to iterate through the `users` collection. This is the same pattern used in `studioOutreach/task.js:18-71` and `server/controller/influencer.js:667-698`. The pagination loop is shared; the per-batch matching logic differs by product.

**Shared pagination loop** (port from `studioOutreach/task.js:18-40`):

    const usersRef = firebase.database().ref("users");
    let lastKey = null;
    const batchSize = 100;
    let moreUsers = true;
    let matchingCreators = [];

    while (moreUsers) {
      let query = usersRef.orderByKey().limitToFirst(batchSize);
      if (lastKey) query = query.startAfter(lastKey);
      const snapshot = await query.once("value");
      const users = snapshot.val();
      if (!users) break;
      const keys = Object.keys(users);
      if (keys.length === 0) break;
      lastKey = keys[keys.length - 1];
      if (keys.length < batchSize) moreUsers = false;

      // Delegate to product-specific matcher
      const batch = data.product === "studio"
        ? matchBatchStudio(users, taskRegions)
        : matchBatchAmplify(users, data);
      matchingCreators = matchingCreators.concat(batch);
    }

**`matchBatchStudio(users, taskRegions)`** — Port from `studioOutreach/task.js:41-68`. For each user entry:
1. Check `user.creator_tasks` exists (this is the Studio eligibility flag — users who have opted into creator tasks).
2. Extract `userState = user?.shipping_details?.state?.toUpperCase()` and `userCountry = user?.shipping_details?.country?.toUpperCase()`.
3. Check region match: `(taskRegions.includes("USA") && userCountry === "USA") || (taskRegions.includes("CAN") && userCountry === "CAN") || (userState && taskRegions.includes(userState))`.
4. If matched, push `{ email: user.email || user.paypail_email, id: key, shipping_details: user.shipping_details }`.

Note: The original CF code (line 62) uses `user.email || user.paypail_email` (the field is actually named `paypail_email` with a typo — this is the real field name in Firebase, not a typo in the code). Preserve this fallback.

**`matchBatchAmplify(users, data)`** — Port from `server/utils/influencer.js:15-72`. For each user entry:
1. Get `instagramFollowerCount = user?.creator_socials?.instagram?.follower_count` and `tiktokFollowerCount = user?.creator_socials?.tiktok?.performance?.followerCount`.
2. If either is `undefined`, skip the user (line 28-29 of source).
3. Parse both as numbers, handling comma-separated strings (e.g., `"12,345"` → `12345`). See source lines 33-40.
4. Compute combined follower count: `(parsedTiktok || 0) + (parsedInstagram || 0)`. Skip if `isNaN(followerCount)`.
5. Check state: if `states` is `["USA"]` match all users; otherwise match `user?.shipping_details?.state` against `states` array.
6. Check follower range: `followerCount >= minFollowerCount && followerCount <= maxFollowerCount`.
7. Check platform: at least one platform in the `platforms` array exists in `user?.creator_socials`.
8. If all conditions pass, push `{ creator_socials: user.creator_socials, email: user.email, id: key, shipping_details: user.shipping_details }`.

Extract `[minFollowerCount, maxFollowerCount]` from `data.follower_count` (a 2-element array).

**Verification:** This module is pure logic over data. It will be tested via the curl integration in milestone 7.


### Milestone 5 — Email service

Create `lib/emailService.js`. This module exports `sendOutreachEmails(firebase, data, creators)` which routes to `sendStudioEmails` or `sendAmplifyEmails` based on `data.product`.

**Setup at module load:**

    const sgMail = require("@sendgrid/mail");
    const Handlebars = require("handlebars");
    const fs = require("fs");
    const path = require("path");

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const FROM = "Crafted <team@usecrafted.com>";

    const studioTemplate = Handlebars.compile(
      fs.readFileSync(path.resolve(__dirname, "../templates/StudioBriefInvite.hbs"), "utf8")
    );
    const amplifyTemplate = Handlebars.compile(
      fs.readFileSync(path.resolve(__dirname, "../templates/CampaignInviteInNetwork.hbs"), "utf8")
    );

Templates are compiled once at cold start, not per-request.

**`fetchBrandData(firebase, brandId)`** — Two Firebase reads (not per-creator — this fixes the N+1 bug in `studioOutreach/email.js:90-97`):

    const [brandNameSnap, brandEmailSnap] = await Promise.all([
      firebase.database().ref(`brands/${brandId}/brand_name`).once("value"),
      firebase.database().ref(`brands/${brandId}/email`).once("value"),
    ]);
    return { brandName: brandNameSnap.val(), brandEmail: brandEmailSnap.val() };

**`fetchAdminPrices(firebase)`** — One Firebase read (Amplify only):

    const snap = await firebase.database().ref("admin/pricing").once("value");
    return snap.val();

**`sendStudioEmails(firebase, data, creators)`** — Port from `studioOutreach/email.js:70-148` and `server/services/emailService.js:175-237`, fixing the N+1 bug:

1. Call `fetchBrandData(firebase, data.brand_id)` once.
2. Build the `personalizations` array. For each creator:
   - Skip if `!creator.email`.
   - Render the Handlebars template with: `{ name: creator?.shipping_details?.fullname ?? "", brand_name: brand.brandName || "", brand_email: brand.brandEmail || "", task_name: data.task.name || "", note1: data.task.note1 || "", note2: data.task.note2 || "", note3: data.task.note3 || "", brief_link: data.task.brief_link || "", price: (data.task.price / 100).toFixed(2) }`.
   - Push `{ from: FROM, to: creator.email, subject: "You've been invited to ${brand.brandName}'s Studio brief!", html: rendered }`.
3. If `personalizations.length > 0`, call `sgMail.send(personalizations, true)` (bulk mode).
4. Extract results: count successful (statusCode 202), extract message IDs from headers.
5. Return `{ messages, sent, failed }`.

**`sendAmplifyEmails(firebase, data, creators)`** — Port from `server/services/emailService.js:116-173`:

1. Call `fetchBrandData(firebase, data.brand_id)` once.
2. Call `fetchAdminPrices(firebase)` once.
3. Build the `personalizations` array. For each creator:
   - Get `tiktokSuggestedRate = creator?.creator_socials?.tiktok?.performance?.suggestedRate` and `instagramSuggestedRate = creator?.creator_socials?.instagram?.suggested_rate`.
   - If neither rate exists, skip (no email for creators without rate data).
   - Compute `suggestedRate = parseInt((tiktokSuggestedRate || 0) / 100 + (instagramSuggestedRate || 0) / 100) + prices.creator_amplify_video_price / 100`. This formula matches `server/services/emailService.js:137-138` exactly.
   - Render the Handlebars template with: `{ name: creator?.shipping_details?.fullname ?? "", brand_name: brand.brandName || "", brand_email: brand.brandEmail || "", message: data.message || "", campaign_name: data.campaign_name || "", suggested_rate: suggestedRate || 0 }`.
   - Push `{ from: FROM, to: creator.email, subject: "You've been invited to ${brand.brandName}'s campaign!", html: rendered }`.
4. Same bulk send and result extraction as Studio.
5. Return `{ messages, sent, failed }`.

**`sendOutreachEmails(firebase, data, creators)`** — Router function:

    if (data.product === "studio") return sendStudioEmails(firebase, data, creators);
    return sendAmplifyEmails(firebase, data, creators);

**Verification:** Module correctness is verified via curl in milestone 7.


### Milestone 6 — Main handler and result storage

Create `function-handler.js`. This is the single entry point for HTTP requests.

**Flow:**

    require("dotenv").config();
    const cors = require("cors")({ origin: true });
    const firebase = require("./lib/firebase");
    const Sentry = require("./lib/sentry");
    const { outreachRequestSchema } = require("./lib/schemas");
    const { scanCreators } = require("./lib/scanner");
    const { sendOutreachEmails } = require("./lib/emailService");

    const creatorOutreach = (req, res) => {
      cors(req, res, async () => {
        try {
          // 1. Validate
          const parsed = outreachRequestSchema.safeParse(req.body);
          if (!parsed.success) {
            return res.status(400).json({
              status: "400", statuscode: "-1",
              message: "Validation failed",
              errors: parsed.error.errors.map(e => e.message),
            });
          }
          const data = parsed.data;

          // 2. Scan
          const matchingCreators = await scanCreators(firebase, data);

          // 3. Email
          const blastResults = await sendOutreachEmails(firebase, data, matchingCreators);

          // 4. Store results
          await storeResults(firebase, data, blastResults);

          // 5. Respond
          return res.status(200).json({
            status: "200", statuscode: "1",
            message: data.message || "",
            length: matchingCreators.length,
            data: matchingCreators,
            blastResults,
          });
        } catch (error) {
          Sentry.captureException(error);
          console.error("creator-outreach error:", error);
          return res.status(500).json({
            status: "500", statuscode: "-1",
            message: "An unexpected error occurred during creator outreach.",
          });
        }
      });
    };

**`storeResults(firebase, data, blastResults)`** — Routes by product:

- **Studio:** `firebase.database().ref("tasks/" + data.task.uid + "/invites").set(blastResults)`.
  This matches the existing behavior in `studioOutreach/task.js:106-116`.

- **Amplify:** Atomic multi-path update to two Firebase paths:

      const updates = {};
      updates[`brands/${data.brand_id}/influencer_campaigns/${data.campaign_id}/invites`] = blastResults;
      updates[`influencer_campaigns/${data.campaign_id}/invites`] = blastResults;
      await firebase.database().ref().update(updates);

  This matches `server/services/campaignService.js:1246` (`updateCampaignInviteResults`), but uses a single atomic update instead of the sequential `.set()` calls in the original.

Export `creatorOutreach`.

**Verification:** See milestone 7.


### Milestone 7 — Local testing with curl

Start the function locally:

    cd functions/creator-outreach
    cp .env.example .env
    # Edit .env with real SENDGRID_API_KEY and SENTRY_DSN
    # Copy the dev service account key to config/devServiceAccountKey.json
    npm install
    npm run dev

The function starts on `http://localhost:8080`.

**Test 1 — Validation error (missing product field):**

    curl -X POST http://localhost:8080 \
      -H "Content-Type: application/json" \
      -d '{"brand_id": "test"}'

Expected: HTTP 400 with `"Validation failed"` message and Zod error details.

**Test 2 — Studio payload (use a test brand_id from dev Firebase):**

    curl -X POST http://localhost:8080 \
      -H "Content-Type: application/json" \
      -d '{
        "product": "studio",
        "brand_id": "REAL_DEV_BRAND_ID",
        "message": "Test studio outreach",
        "task": {
          "id": "test-task-id",
          "uid": "test-task-uid",
          "name": "Test Brief",
          "regions": [{"value": "NY"}],
          "price": 5000,
          "note1": "Test product",
          "note2": "Test audience"
        }
      }'

Expected: HTTP 200 with `length` (number of matching creators), `data` (array of creator objects), and `blastResults` (`{ messages, sent, failed }`).

**Test 3 — Amplify payload:**

    curl -X POST http://localhost:8080 \
      -H "Content-Type: application/json" \
      -d '{
        "product": "amplify",
        "brand_id": "REAL_DEV_BRAND_ID",
        "message": "Join our campaign!",
        "campaign_id": "test-campaign-id",
        "campaign_name": "Test Campaign",
        "follower_count": [100, 50000],
        "platforms": ["tiktok", "instagram"],
        "states": ["NY", "CA"]
      }'

Expected: HTTP 200 with same shape as Test 2.


## Concrete Steps

All commands assume the working directory is `functions/creator-outreach/` inside the `crafted_cloud_functions` worktree.

1. Create the directory structure: `mkdir -p lib templates config`
2. Create `package.json` with 8 deps as specified in Milestone 1.
3. Create `.env.example` with three env vars.
4. Create `lib/firebase.js` with multi-env config.
5. Create `lib/sentry.js`.
6. Create `index.js` (3-line registration).
7. Run `npm install` — expect clean install with 8 deps.
8. Create `lib/schemas.js` with Zod discriminated union.
9. Copy `server/emailTemplates/StudioBriefInvite.html` to `templates/StudioBriefInvite.hbs`, apply fixes (lang, {{#if}} blocks).
10. Copy `server/campaignEmailTemplates/CampaignInviteInNetwork.html` to `templates/CampaignInviteInNetwork.hbs`, fix lang.
11. Create `lib/scanner.js` with shared pagination + two matchers.
12. Create `lib/emailService.js` with brand fetch, price fetch, two email senders, router.
13. Create `function-handler.js` with CORS, validate, scan, email, store, respond flow.
14. Configure `.env` with real dev credentials and run `npm run dev`.
15. Run the three curl tests from Milestone 7.
16. Commit after each milestone passes.


## Validation and Acceptance

1. `npm install` completes with exactly 8 direct dependencies (check `package.json`).
2. `npm run dev` starts the function on port 8080 without errors.
3. POST with missing `product` field returns HTTP 400 with Zod validation errors.
4. POST with valid Studio payload returns HTTP 200, `data` array contains matched creators with `{ email, id, shipping_details }` shape, `blastResults` shows sent count.
5. POST with valid Amplify payload returns HTTP 200, `data` array contains matched creators with `{ creator_socials, email, id, shipping_details }` shape.
6. Firebase dev database shows stored results at the correct path after each test.
7. Sentry dashboard shows test errors (trigger by sending malformed internal state).
8. No `require("firebase")` anywhere (only `firebase-admin`).
9. No `require("moment")` anywhere (not needed).
10. No `PRODEV` env var used anywhere.
11. Both `.hbs` templates have `lang="en"`, not `lang="e"`.


## Idempotence and Recovery

All curl tests can be re-run safely. The `storeResults` function uses `.set()` for Studio (idempotent overwrite) and atomic `.update()` for Amplify (idempotent overwrite). No incremental counters or append-only writes.

If `npm run dev` fails after a partial implementation, check the error message — the most likely cause is a missing `.env` value or missing service account key file. Fix and re-run.


## Artifacts and Notes

**N+1 fix evidence** — The old `studioOutreach/email.js` lines 90-97:

    for (const creator of creators) {
      if (!creator.email) { continue; }
      const emailData = await fetchEmailData(brand_id, task.id, creator.id);
      // 7 Firebase reads PER CREATOR

The new code calls `fetchBrandData(firebase, data.brand_id)` once before the loop. For 100 creators, this reduces Firebase reads from 700 to 2.

**Template diff for StudioBriefInvite.hbs** — Only three lines change from the HTML source:

    Line 1:  <html lang="e">  →  <html lang="en">
    Line 101: <li>Additional Information: <strong>{{note3}}</strong></li>
           →  {{#if note3}}<li>Additional Information: <strong>{{note3}}</strong></li>{{/if}}
    Line 102: <li>Brief Link: <strong>{{brief_link}}</strong></li>
           →  {{#if brief_link}}<li>Brief Link: <strong>{{brief_link}}</strong></li>{{/if}}


## Interfaces and Dependencies

**Exported from `function-handler.js`:**

    module.exports = { creatorOutreach };

    // creatorOutreach(req, res) — Google Cloud Functions HTTP handler signature.
    // Request body: validated by outreachRequestSchema (Zod discriminated union).
    // Response: { status, statuscode, message, length, data, blastResults }

**Exported from `lib/schemas.js`:**

    module.exports = { outreachRequestSchema };

    // outreachRequestSchema — z.discriminatedUnion("product", [studioSchema, amplifySchema])

**Exported from `lib/scanner.js`:**

    module.exports = { scanCreators };

    // scanCreators(firebase, data) → Promise<Array<{ email, id, shipping_details, creator_socials? }>>
    // Returns Studio shape (no creator_socials) or Amplify shape (with creator_socials)

**Exported from `lib/emailService.js`:**

    module.exports = { sendOutreachEmails };

    // sendOutreachEmails(firebase, data, creators) → Promise<{ messages: string, sent: number, failed: number }>

**Exported from `lib/firebase.js`:**

    module.exports = firebase;  // firebase-admin App instance

**Exported from `lib/sentry.js`:**

    module.exports = Sentry;  // @sentry/node instance
