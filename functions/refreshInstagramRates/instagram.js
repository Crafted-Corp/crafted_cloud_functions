require("dotenv").config();
const firebase = require(process.env.PRODEV);
const cors = require("cors")({ origin: true });
const moment = require("moment");
const { metaMessageKey, lastErrorFor } = require("./socialErrors");
const { graphHostFor } = require("./graphHost");

const BATCH_SIZE_USERS = 100;
const BATCH_SIZE_MEDIA = 5;

async function processUserInstagramRate(creator_id, user) {
  if (user && user.negotiated === true) {
    console.log(`[INFO] Skipping user ${creator_id} due to negotiated=true`);
    return { skipped: true, reason: "negotiated" };
  }

  const instagramInfo = user?.creator_socials?.instagram;

  if (
    !(instagramInfo?.api_path === "instagram" ? instagramInfo?.instagram_user_id : instagramInfo?.instagram_business_account_id) ||
    !instagramInfo?.access_token
  ) {
    console.warn(
      `[WARN] Missing Instagram info for user ${creator_id}, skipping`,
    );
    return { skipped: true, reason: "missing_instagram_info" };
  }

  console.log(`[INFO] Calculating suggested rate for user ${creator_id}`);
  let suggestedRate;
  let medianPlays;
  try {
    ({ suggestedRate, medianPlays } = await calculateSuggestedRate(
      instagramInfo.access_token,
      instagramInfo.api_path === "instagram" ? instagramInfo.instagram_user_id : instagramInfo.instagram_business_account_id,
      instagramInfo,
    ));
  } catch (error) {
    const graphError = error.graphError;
    const messageKey = metaMessageKey(graphError);
    if (messageKey) {
      await firebase.database().ref(`users/${creator_id}/creator_socials/instagram`).update({
        last_error: lastErrorFor(graphError.code, graphError.error_subcode, messageKey),
      });
      return { skipped: true, reason: "token_error" };
    }
    if ([4, 17, 32].includes(Number(graphError?.code))) {
      console.warn(`[WARN] rate limited for user ${creator_id}`);
      return { skipped: true, reason: "rate_limited" };
    }
    throw error;
  }
  if (!Number.isFinite(suggestedRate)) {
    throw new Error(`Failed to calculate suggested rate for creator ${creator_id}`);
  }
  await firebase.database().ref(`users/${creator_id}/creator_socials/instagram`).update({
    suggested_rate: suggestedRate,
    median_plays: medianPlays,
    updated: moment().format(),
    last_error: null,
  });

  console.log(`[INFO] Updated suggested rate for user ${creator_id}`);
  return { success: true, suggestedRate };
}

const refreshInstagramRates = async (req, res) => {
  cors(req, res, async () => {
    try {
      console.log("[INFO] Starting Instagram rates refresh process");
      const usersRef = firebase.database().ref("users");

      // Check for user_id in query
      const userId = req.query.user_id;
      if (userId) {
        // Process only the specified user
        const snapshot = await usersRef.child(userId).once("value");
        const user = snapshot.val();

        if (!user) {
          console.warn(`[WARN] User ${userId} not found or is null.`);
          return res.status(404).json({
            status: "404",
            statuscode: "-1",
            message: `User ${userId} not found.`,
          });
        }

        try {
          const result = await processUserInstagramRate(userId, user);

          if (result.skipped) {
            return res.status(200).json({
              status: "200",
              statuscode: "1",
              message: `User ${userId} skipped: ${result.reason}`,
            });
          }

          console.log(
            `[SUCCESS] Processed Instagram rate for user ${userId}`,
          );
          return res.status(200).json({
            status: "200",
            statuscode: "1",
            message: `Successfully updated Instagram rate for user ${userId}`,
            suggestedRate: result.suggestedRate,
          });
        } catch (err) {
          console.error(`[ERROR] Failed processing user ${userId}:`, err);
          return res.status(500).json({
            status: "500",
            statuscode: "-1",
            message: `Failed to process user ${userId}.`,
          });
        }
      }

      // Process all users in batches
      let lastKey = null;
      let moreUsers = true;

      while (moreUsers) {
        let query = usersRef.orderByKey().limitToFirst(BATCH_SIZE_USERS);
        if (lastKey) {
          query = query.startAfter(lastKey);
        }
        const usersSnapshot = await query.once("value");
        const users = usersSnapshot.val();
        const userKeys = users ? Object.keys(users) : [];

        if (!users || userKeys.length === 0) {
          console.log("[INFO] No more users found in this batch");
          break;
        }

        lastKey = userKeys[userKeys.length - 1];
        if (userKeys.length < BATCH_SIZE_USERS) {
          moreUsers = false;
        }

        console.log(`[INFO] Processing batch with ${userKeys.length} users`);

        const updatePromises = userKeys.map(async (creator_id) => {
          try {
            return await processUserInstagramRate(creator_id, users[creator_id]);
          } catch (error) {
            console.error(
              `[ERROR] Failed to process user ${creator_id}:`,
              error,
            );
            return null;
          }
        });

        await Promise.all(updatePromises);
      }

      console.log("[INFO] Finished refreshing all Instagram accounts");
      res.status(200).json({
        status: "200",
        statuscode: "1",
        message: "Refreshed all Instagram accounts successfully",
      });
    } catch (error) {
      console.error("[ERROR] Error refreshing Instagram accounts:", error);
      res.status(500).json({ status: "500", statuscode: "-1", result: error });
    }
  });
};

async function calculateSuggestedRate(access_token, business_account_id, instagramInfo) {
  const mediaUrl = `${graphHostFor(instagramInfo)}/${business_account_id}/media?fields=media_type&access_token=${access_token}&limit=300`;
  console.log(
    `[INFO] Fetching media for business_account_id ${business_account_id}`,
  );
  const mediaResponse = await fetch(mediaUrl);
  const mediaData = await mediaResponse.json();

  if (mediaData.error || !mediaResponse.ok) {
    const error = new Error(`Failed fetching Instagram media (${mediaResponse.status})`);
    error.graphError = mediaData.error;
    throw error;
  }

  const reels = mediaData.data
    .filter((media) => media.media_type === "VIDEO")
    .slice(0, 25);

  const mediaIds = reels.map((media) => media.id);

  let allPlayCounts = [];
  for (let i = 0; i < mediaIds.length; i += BATCH_SIZE_MEDIA) {
    const mediaBatch = mediaIds.slice(i, i + BATCH_SIZE_MEDIA);

    const playPromises = mediaBatch.map(async (mediaId) => {
      try {
        const insightsUrl = `${graphHostFor(instagramInfo)}/${mediaId}/insights?access_token=${access_token}&metric=views`;
        const insightsResponse = await fetch(insightsUrl);
        const insightsData = await insightsResponse.json();

        if (insightsData.error || !insightsResponse.ok) {
          const error = new Error(`Failed fetching Instagram insights (${insightsResponse.status})`);
          error.graphError = insightsData.error;
          throw error;
        }

        if (insightsData.data && insightsData.data.length > 0) {
          return insightsData.data[0].values[0].value;
        }

        return null;
      } catch (error) {
        if (metaMessageKey(error.graphError) || [4, 17, 32].includes(Number(error.graphError?.code))) throw error;
        console.error(
          `[ERROR] Failed to fetch insights for mediaId ${mediaId} of business_account_id ${business_account_id}:`,
          error,
        );

        return null;
      }
    });

    const playArray = await Promise.all(playPromises);
    allPlayCounts = allPlayCounts.concat(
      playArray.filter((play) => play !== null),
    );
  }

  let medianPlays = median(allPlayCounts);
  let suggestedRate = parseInt((medianPlays / 1000) * 2500);

  console.log(`[INFO] Calculated suggested rate: ${suggestedRate}`);

  return { suggestedRate, medianPlays };
}

function median(arr) {
  if (arr.length === 0) return 0; // Handle empty array case

  let mid = Math.floor(arr.length / 2);
  let sortedArr = arr.sort((a, b) => a - b);

  if (arr.length % 2 === 0) {
    return (sortedArr[mid - 1] + sortedArr[mid]) / 2;
  } else {
    return sortedArr[mid];
  }
}

module.exports = {
  refreshInstagramRates,
  processUserInstagramRate,
};
