require("dotenv").config();
const firebase = require(process.env.PRODEV);
const cors = require("cors")({ origin: true });
const axios = require("axios");

const BATCH_SIZE_USERS = 100;

async function processUserInstagramId(uid, user) {
  const instagramData = user?.creator_socials?.instagram;

  // Skip if no access token
  if (!instagramData?.access_token) {
    console.log(`[INFO] Skipping user ${uid}: no access_token`);
    return { skipped: true, reason: "no_access_token" };
  }

  // Skip if already has instagram_user_id
  if (instagramData?.instagram_user_id) {
    console.log(`[INFO] Skipping user ${uid}: already has instagram_user_id`);
    return { skipped: true, reason: "already_has_instagram_user_id" };
  }

  // Call Meta Graph API /me endpoint
  const meUrl = `https://graph.facebook.com/v24.0/me?access_token=${instagramData.access_token}`;
  const response = await axios.get(meUrl);
  const data = response.data;

  if (!data.id) {
    throw new Error("No id in response");
  }

  // Update instagram_user_id in RTDB
  await firebase
    .database()
    .ref(`users/${uid}/creator_socials/instagram/instagram_user_id`)
    .set(data.id);

  console.log(`[INFO] Updated instagram_user_id for user ${uid}: ${data.id}`);
  return { success: true, instagram_user_id: data.id };
}

const insertInstagramUserIds = async (req, res) => {
  cors(req, res, async () => {
    try {
      console.log("[INFO] Starting Instagram User IDs backfill process");
      const usersRef = firebase.database().ref("users");

      // Check for user_id in query params
      const { user_id:userId } = req.query;
      if (userId) {
        // Process only the specified user
        const snapshot = await usersRef.child(userId).once("value");
        const user = snapshot.val();

        if (!user) {
          console.warn(`[WARN] User ${userId} not found or is null.`);
          return res.status(404).json({
            status: "404",
            message: `User ${userId} not found.`,
          });
        }

        try {
          const result = await processUserInstagramId(userId, user);

          if (result.skipped) {
            return res.status(200).json({
              status: "200",
              message: `User ${userId} skipped: ${result.reason}`,
            });
          }

          console.log(
            `[SUCCESS] Processed Instagram User ID for user ${userId}`,
          );
          return res.status(200).json({
            status: "200",
            message: `Successfully updated instagram_user_id for user ${userId}`,
            instagram_user_id: result.instagram_user_id,
          });
        } catch (error) {
          const message =
            error.response?.data?.error?.error_user_msg ||
            error.response?.data?.error?.message ||
            error.message;
          console.error(`[ERROR] Failed processing user ${userId}: ${message}`);
          return res.status(500).json({
            status: "500",
            message: `Failed to process user ${userId}: ${message}`,
          });
        }
      }

      // Process all users in batches
      let lastKey = null;
      let moreUsers = true;
      let processed = 0;
      let skipped = 0;
      let errors = 0;

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

        // Process each user in the batch
        for (const uid of userKeys) {
          try {
            const result = await processUserInstagramId(uid, users[uid]);
            if (result.skipped) {
              skipped++;
            } else {
              processed++;
            }
          } catch (error) {
            const message =
              error.response?.data?.error?.error_user_msg ||
              error.response?.data?.error?.message ||
              error.message;
            console.error(`[ERROR] Failed to process user ${uid}: ${message}`);
            errors++;
          }
        }
      }

      console.log(
        `[INFO] Backfill complete. Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`,
      );
      return res.status(200).json({
        status: "200",
        message: "Backfill complete",
        processed,
        skipped,
        errors,
      });
    } catch (error) {
      console.error("[ERROR] Error during backfill:", error);
      return res.status(500).json({
        status: "500",
        error: "Internal server error",
      });
    }
  });
};

module.exports = {
  insertInstagramUserIds,
};
