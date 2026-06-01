require("dotenv").config();
const firebase = require(process.env.PRODEV);
const cors = require("cors")({ origin: true });

const BATCH_SIZE_USERS = 100;

const getUserByIgBusinessId = async (req, res) => {
  cors(req, res, async () => {
    const { instagram_user_id } = req.query;

    // Validate input
    if (!instagram_user_id) {
      return res.status(400).json({
        error: "Missing required parameter: instagram_user_id",
      });
    }

    try {
      console.log(`[INFO] Searching for IG User ID: ${instagram_user_id}`);
      const usersRef = firebase.database().ref("users");

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

        // Search for matching user in this batch
        for (const uid of userKeys) {
          const user = users[uid];
          const instagramUserId =
            user?.creator_socials?.instagram?.instagram_user_id;

          if (instagramUserId === instagram_user_id) {
            console.log(`[INFO] Found matching user: ${uid}`);
            return res.status(200).json({
              uid: uid,
              handle: user?.creator_socials?.instagram?.handle || null,
              name: user?.name || null,
              email: user?.email || null,
            });
          }
        }
      }

      // User not found after searching all batches
      console.log(`[INFO] No user found for IG User ID: ${instagram_user_id}`);
      return res.status(404).json({
        error: "User not found for the provided Instagram User ID",
      });
    } catch (error) {
      console.error("Error fetching user by IG User ID:", error);
      return res.status(500).json({
        error: "Internal server error",
      });
    }
  });
};

module.exports = {
  getUserByIgBusinessId,
};
