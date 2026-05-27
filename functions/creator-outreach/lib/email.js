/**
 * Email service — brand data fetch, Handlebars rendering, SendGrid bulk send.
 *
 * Key improvement over the old studioOutreach/email.js: brand data is fetched
 * ONCE per request via fetchBrandData(), not per-creator. For 100 creators this
 * reduces Firebase reads from 700 to 2.
 *
 * Templates are compiled at module load (cold start), not per-request.
 */

const sgMail = require("@sendgrid/mail");
const Handlebars = require("handlebars");
const fs = require("fs");
const path = require("path");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM = "Crafted <team@usecrafted.com>";

// Compile templates once at module load — not per-request
const studioTemplate = Handlebars.compile(
  fs.readFileSync(path.resolve(__dirname, "../templates/StudioBriefInvite.hbs"), "utf8")
);
const amplifyTemplate = Handlebars.compile(
  fs.readFileSync(path.resolve(__dirname, "../templates/CampaignInviteInNetwork.hbs"), "utf8")
);

/**
 * Fetch brand name and email from Firebase — called ONCE per request.
 * This is the N+1 fix: the old code called fetchEmailData() per creator,
 * which made 7 Firebase reads each. Brand data is the same for every creator.
 */
const fetchBrandData = async (firebase, brandId) => {
  const [brandNameSnap, brandEmailSnap] = await Promise.all([
    firebase.database().ref(`brands/${brandId}/brand_name`).once("value"),
    firebase.database().ref(`brands/${brandId}/email`).once("value"),
  ]);
  return { brandName: brandNameSnap.val(), brandEmail: brandEmailSnap.val() };
};

/**
 * Fetch admin pricing data — needed for Amplify suggested rate calculation.
 */
const fetchAdminPrices = async (firebase) => {
  const snap = await firebase.database().ref("admin/pricing").once("value");
  return snap.val();
};

/**
 * Extract SendGrid bulk send results into a consistent shape.
 */
const extractResults = (result, personalizationCount) => {
  const successfulEmails = result.filter((r) => r[0].statusCode === 202);
  const messageIds = result
    .map((r) => r[0].headers["x-message-id"])
    .filter(Boolean)
    .join(",");

  return {
    messages: messageIds,
    sent: successfulEmails.length,
    failed: personalizationCount - successfulEmails.length,
  };
};

/**
 * Send Studio brief invite emails.
 *
 * Ported from studioOutreach/email.js and server/services/emailService.js:175-237.
 * Fixes: brand data fetched once (not per-creator), Handlebars instead of regex,
 * bulk SendGrid send instead of one-by-one transporter.sendMail().
 */
const sendStudioEmails = async (firebase, data, creators) => {
  const brand = await fetchBrandData(firebase, data.brand_id);

  const personalizations = [];

  for (const creator of creators) {
    if (!creator.email) continue;

    const html = studioTemplate({
      name: creator?.shipping_details?.fullname ?? "",
      brand_name: brand.brandName || "",
      brand_email: brand.brandEmail || "",
      task_name: data.task.name || "",
      note1: data.task.note1 || "",
      note2: data.task.note2 || "",
      note3: data.task.note3 || "",
      brief_link: data.task.brief_link || "",
      price: (data.task.price / 100).toFixed(2),
    });

    personalizations.push({
      from: FROM,
      to: creator.email,
      subject: `You've been invited to ${brand.brandName}'s Studio brief!`,
      html,
    });
  }

  if (personalizations.length > 0) {
    const result = await sgMail.send(personalizations, true);
    return extractResults(result, personalizations.length);
  }

  return { messages: "", sent: 0, failed: 0 };
};

/**
 * Send Amplify campaign invite emails.
 *
 * Ported from server/services/emailService.js:116-173.
 * Rate formula: parseInt((tiktokSuggestedRate || 0) / 100 + (instagramSuggestedRate || 0) / 100)
 *   + prices.creator_amplify_video_price / 100
 */
const sendAmplifyEmails = async (firebase, data, creators) => {
  const brand = await fetchBrandData(firebase, data.brand_id);
  const prices = await fetchAdminPrices(firebase);

  const personalizations = [];

  for (const creator of creators) {
    if (!creator.email) continue;

    const tiktokSuggestedRate = creator?.creator_socials?.tiktok?.performance?.suggestedRate;
    const instagramSuggestedRate = creator?.creator_socials?.instagram?.suggested_rate;

    // Skip creators without any rate data
    if (!tiktokSuggestedRate && !instagramSuggestedRate) continue;

    const suggestedRate =
      parseInt((tiktokSuggestedRate || 0) / 100 + (instagramSuggestedRate || 0) / 100) +
      prices.creator_amplify_video_price / 100;

    const html = amplifyTemplate({
      name: creator?.shipping_details?.fullname ?? "",
      brand_name: brand.brandName || "",
      brand_email: brand.brandEmail || "",
      message: data.message || "",
      campaign_name: data.campaign_name || "",
      suggested_rate: suggestedRate || 0,
    });

    personalizations.push({
      from: FROM,
      to: creator.email,
      subject: `You've been invited to ${brand.brandName}'s campaign!`,
      html,
    });
  }

  if (personalizations.length > 0) {
    const result = await sgMail.send(personalizations, true);
    return extractResults(result, personalizations.length);
  }

  return { messages: "", sent: 0, failed: 0 };
};

/**
 * Route to the correct email sender based on product type.
 *
 * @param {object} firebase - Firebase Admin app instance
 * @param {object} data - Validated request data
 * @param {Array} creators - Matched creator array from scanner
 * @returns {Promise<{messages: string, sent: number, failed: number}>}
 */
const sendOutreachEmails = async (firebase, data, creators) => {
  if (data.product === "studio") return sendStudioEmails(firebase, data, creators);
  return sendAmplifyEmails(firebase, data, creators);
};

module.exports = { sendOutreachEmails };
