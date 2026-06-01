require("dotenv").config();
const cors = require("cors")({ origin: true });
const firebase = require(process.env.PRODEV);
const moment = require("moment");

const refreshTiktokAccessTokens = async (req, res) => {
  cors(req, res, async () => {
    try {
      const usersRef = firebase.database().ref("users");
      let lastKey = null;
      const batchSize = 100; // Adjust as needed
      let moreUsers = true;
      let totalPromises = [];

      while (moreUsers) {
        let query = usersRef.orderByKey().limitToFirst(batchSize);
        if (lastKey) {
          query = query.startAfter(lastKey);
        }
        const usersSnapshot = await query.once("value");
        const users = usersSnapshot.val();
        const userKeys = users ? Object.keys(users) : [];

        if (!users || userKeys.length === 0) {
          break;
        }

        lastKey = userKeys[userKeys.length - 1];
        if (userKeys.length < batchSize) {
          moreUsers = false;
        }

        const promises = [];
        userKeys.forEach((key) => {
          const data = users[key];
          if (
            data.creator_socials &&
            data.creator_socials.tiktok &&
            data.creator_socials.tiktok.refresh_token
          ) {
            const refreshToken = data.creator_socials.tiktok.refresh_token;
            if (refreshToken) {
              const body = new URLSearchParams({
                client_key: "awdpgd7ih1asm72a",
                client_secret: "357014f753c08457f74c0e3115a2c3c1",
                grant_type: "refresh_token",
                refresh_token: refreshToken,
              }).toString();

              const options = {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body,
              };

              const promise = fetch(
                "https://open.tiktokapis.com/v2/oauth/token/",
                options,
              )
                .then((response) => response.json())
                .then(async (responseData) => {
                  const accessToken = responseData.access_token;
                  if (!accessToken) {
                    console.log(`Access token for user ${key} is undefined.`);
                    return Promise.resolve();
                  }
                  const accessExpiresAt = moment()
                    .add(responseData.expires_in, "seconds")
                    .toISOString();
                  const refreshExpiresAt = moment()
                    .add(responseData.refresh_expires_in, "seconds")
                    .toISOString();

                  // Update access token expiry date
                  const access_token_expire = firebase
                    .database()
                    .ref(
                      `users/${key}/creator_socials/tiktok/access_token_expiry_date`,
                    );
                  await access_token_expire.set(accessExpiresAt);

                  // Update refresh token expiry date
                  const refresh_token_expire = firebase
                    .database()
                    .ref(
                      `users/${key}/creator_socials/tiktok/refresh_token_expiry_date`,
                    );
                  await refresh_token_expire.set(refreshExpiresAt);

                  // Setting the access_token in the database
                  const tok = firebase
                    .database()
                    .ref(`users/${key}/creator_socials/tiktok/access_token`);
                  await tok.set(accessToken);
                })
                .catch((error) => {
                  console.error(
                    `Error refreshing token for user ${key}:`,
                    error,
                  );
                  // Don't throw, just log and continue
                });

              promises.push(promise);
            }
          }
        });

        console.log(`Processing batch of ${promises.length} users`);
        await Promise.all(promises);
        totalPromises = totalPromises.concat(promises);
      }

      console.log("All batches processed.");
      res
        .status(200)
        .json({ status: "200", statuscode: "1", result: "Refresh completed" });
    } catch (error) {
      console.error("Error message:", error.message);
      console.error("Stack trace:", error.stack);
      res
        .status(500)
        .json({ status: "500", statuscode: "-1", result: error.toString() });
    }
  });
};

module.exports = {
  refreshTiktokAccessTokens,
};
