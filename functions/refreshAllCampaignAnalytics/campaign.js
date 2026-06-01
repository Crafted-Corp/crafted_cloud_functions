require("dotenv").config();
const firebase = require(process.env.PRODEV);
const moment = require("moment");
const cors = require("cors")({ origin: true });
const { processCampaignAnalytics } = require("./utils");

const BATCH_SIZE = 10;

const refreshAllCampaignAnalytics = async (req, res) => {
  cors(req, res, async () => {
    try {
      const campaignsRef = firebase.database().ref("influencer_campaigns");
      let curDate = moment().format();

      // Check for campaign_id in query
      const campaignId = req.query.campaign_id;
      if (campaignId) {
        // Process only the specified campaign
        const snapshot = await campaignsRef.child(campaignId).once("value");
        const campaign = snapshot.val();
        if (!campaign || Object.keys(campaign).length === 0) {
          console.warn(`[WARN] Campaign ${campaignId} not found or is null.`);
          return res.status(404).json({
            statuscode: 404,
            message: `Campaign ${campaignId} not found.`,
          });
        }
        try {
          await processCampaignAnalytics({
            campaign_id: campaignId,
            campaign,
            curDate,
          });
          console.log(`[SUCCESS] Processed analytics for campaign ${campaignId}`);
          return res.status(200).json({
            statuscode: 200,
            message: `Successfully updated analytics for campaign ${campaignId}`,
          });
        } catch (err) {
          console.error(`[ERROR] Failed processing campaign ${campaignId}:`, err);
          return res.status(500).json({
            statuscode: 500,
            message: `Failed to process campaign ${campaignId}.`,
          });
        }
      }

      let lastKey = null;
      let moreCampaigns = true;
      let batchCount = 0;

      while (moreCampaigns) {
        let query = campaignsRef.orderByKey().limitToFirst(BATCH_SIZE);

        if (lastKey) {
          query = query.startAfter(lastKey);
        }

        const snapshot = await query.once("value");
        const campaigns = snapshot.val() || {};
        const campaignKeys = Object.keys(campaigns);

        if (campaignKeys.length === 0) {
          break;
        }

        lastKey = campaignKeys[campaignKeys.length - 1];

        if (campaignKeys.length < BATCH_SIZE) {
          moreCampaigns = false;
        }

        batchCount++;

        console.log(
          `[INFO] Processing batch ${batchCount}: ${campaignKeys.join(", ")}`,
        );

        for (const [campaign_id, campaign] of Object.entries(campaigns)) {
          if (!campaign || Object.keys(campaign).length === 0) {
            console.warn(
              `[WARN] Campaign ${campaign_id} not found or is null.`,
            );
            continue;
          }
          try {
            await processCampaignAnalytics({
              campaign_id,
              campaign,
              curDate,
            });
            console.log(
              `[SUCCESS] Processed analytics for campaign ${campaign_id}`,
            );
          } catch (err) {
            console.error(
              `[ERROR] Failed processing campaign ${campaign_id}:`,
              err,
            );
          }
        }
      }
      res.status(200).json({
        statuscode: 200,
        message: "Successfully updated campaign analytics",
      });
    } catch (error) {
      console.error("[FATAL] Error finding campaigns for brand", error);
      res
        .status(500)
        .json({ statuscode: 500, message: "Failed to find campaigns." });
    }
  });
};

module.exports = {
  refreshAllCampaignAnalytics,
};
