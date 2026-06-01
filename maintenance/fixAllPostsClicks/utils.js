require("dotenv").config();
const firebase = require(process.env.PRODEV);
const moment = require("moment");
const axios = require("axios");
const cors = require("cors")({ origin: true });

/**
 * Processes analytics for a single campaign.
 */
async function processCampaignAnalytics({
  firebase,
  moment,
  campaign_id,
  campaign,
  curDate,
}) {
  let brand_id = campaign.brand_id;
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalPosts = 0;
  let posts = 0;
  let totalClicks = 0;
  const tiktok_posts = [];
  const instagram_posts = [];
  const tasks = campaign.tasks;

  const { historical_analytics } = campaign;

  if (campaign.status === "completed") {
    console.warn(
      `[WARN] Campaign ${campaign_id} is completed. Skipping analytics processing.`,
    );
    return;
  }

  if (!historical_analytics || Object.keys(historical_analytics).length === 0) {
    console.warn(
      `[WARN] No historical_analytics found for campaign ${campaign_id}`,
    );
    return;
  }
  
  // Sort entries by key (ascending)
  const sortedEntries = Object.entries(historical_analytics).sort(
    ([aKey], [bKey]) => aKey.localeCompare(bKey),
  );

  // Divide totalClicks by 2 for all entries and update in Firebase
  for (const [entryId, entry] of sortedEntries) {
    if (typeof entry.totalClicks === "number") {
      const newClicks = Math.floor(entry.totalClicks / 2);
      console.log(
        `[INFO] Updating totalClicks for campaign ${campaign_id}, entry ${entryId}: ${entry.totalClicks} -> ${newClicks}`
      );
      await firebase
        .database()
        .ref(
          `influencer_campaigns/${campaign_id}/historical_analytics/${entryId}/totalClicks`,
        )
        .set(newClicks);
    } else {
      console.log(
        `[INFO] Skipping entry ${entryId} for campaign ${campaign_id}: totalClicks not present`
      );
    }
  }
}

const isPerformanceValid = (metrics) => {
  return (
    "likes" in metrics &&
    "comments" in metrics &&
    "shares" in metrics &&
    "views" in metrics
  );
};

module.exports = {
  processCampaignAnalytics,
};
