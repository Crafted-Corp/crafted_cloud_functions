require("dotenv").config();
const cors = require("cors")({ origin: true });
const firebase = require("./lib/firebase");
const Sentry = require("./lib/sentry");
const { outreachRequestSchema } = require("./lib/schemas");
const { scanCreators } = require("./lib/scanner");
const { sendOutreachEmails } = require("./lib/email");

/**
 * Store blast results in Firebase at the correct path per product.
 *
 * Studio: tasks/{task.uid}/invites
 * Amplify: atomic multi-path update to two paths
 */
const storeResults = async (firebase, data, blastResults) => {
  if (data.product === "studio") {
    await firebase
      .database()
      .ref(`tasks/${data.task.uid}/invites`)
      .set(blastResults);
  } else {
    const updates = {};
    updates[`brands/${data.brand_id}/influencer_campaigns/${data.campaign_id}/invites`] = blastResults;
    updates[`influencer_campaigns/${data.campaign_id}/invites`] = blastResults;
    await firebase.database().ref().update(updates);
  }
};

/**
 * Main HTTP handler for creator outreach.
 *
 * Flow: CORS -> validate (Zod) -> scan users -> send emails -> store results -> respond
 *
 * @param {object} req - GCF HTTP request
 * @param {object} res - GCF HTTP response
 */
const creatorOutreach = (req, res) => {
  cors(req, res, async () => {
    try {
      // 1. Validate
      const parsed = outreachRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          status: "400",
          statuscode: "-1",
          message: "Validation failed",
          errors: parsed.error.errors.map((e) => e.message),
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
        status: "200",
        statuscode: "1",
        message: data.message || "",
        length: matchingCreators.length,
        data: matchingCreators,
        blastResults,
      });
    } catch (error) {
      Sentry.captureException(error);
      console.error("creator-outreach error:", error);
      return res.status(500).json({
        status: "500",
        statuscode: "-1",
        message: "An unexpected error occurred during creator outreach.",
      });
    }
  });
};

module.exports = { creatorOutreach };
