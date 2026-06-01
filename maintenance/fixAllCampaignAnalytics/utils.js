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

  let filteredEntries = [];
  let prev = null;

  for (let i = 0; i < sortedEntries.length; i++) {
    const [entryId, entry] = sortedEntries[i];
    if (!prev) {
      filteredEntries.push([entryId, entry]);
      prev = [entryId, entry];
      continue;
    }
    if (entry.totalViews >= prev[1].totalViews) {
      filteredEntries.push([entryId, entry]);
      prev = [entryId, entry];
    } else {
      // Remove the current entry from Firebase
      await firebase
        .database()
        .ref(
          `influencer_campaigns/${campaign_id}/historical_analytics/${entryId}`,
        )
        .remove();
      // Do not update prev, so next is compared to the last kept
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
