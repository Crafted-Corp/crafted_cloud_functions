require("dotenv").config();
const firebase = require(process.env.PRODEV);
const cors = require("cors")({ origin: true });
const xlsx = require("xlsx");

const insertCampaignDrafts = async (req, res) => {
  const workbook = xlsx.readFile("amplify_assets_recovery.csv");

  cors(req, res, async () => {
    workbook.SheetNames.forEach(async (sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      data.forEach(async (row) => {
        const campaignId = row["campaignId"];
        const taskId = row["taskId"];
        const brandId = row["brandId"];
        const creatorId = row["creatorId"];
        const s3Link = row["s3Link"];

        const logObject = { campaignId, taskId, creatorId, s3Link };

        if (!brandId || !campaignId || !taskId || !creatorId || !s3Link) {
          console.error("Missing data in row:", logObject);
          return;
        }

        const brandAssetsSnapshot = await firebase
          .database()
          .ref(`brands/${brandId}/brand_assets`)
          .once("value");
        const brandAssets = brandAssetsSnapshot.val();

        const creatorAssetsSnapshot = await firebase
          .database()
          .ref(`users/${creatorId}/creator_assets`)
          .once("value");
        const creatorAssets = creatorAssetsSnapshot.val();

        let brandAssetId = null;
        for (const key in brandAssets) {
          if (
            brandAssets[key].task_id === taskId &&
            brandAssets[key].creator_id === creatorId &&
            brandAssets[key].type === "video"
          ) {
            brandAssetId = key;
            break;
          }
        }

        let creatorAssetId = null;
        for (const key in creatorAssets) {
          if (
            creatorAssets[key].task_id === taskId &&
            creatorAssets[key].type === "video"
          ) {
            creatorAssetId = key;
            break;
          }
        }

        console.log("brandAssetId: ", brandAssetId);
        console.log("creatorAssetId: ", creatorAssetId);

        try {
          await Promise.all([
            firebase
              .database()
              .ref(`brands/${brandId}/brand_assets/${brandAssetId}/source`)
              .set(s3Link),
            firebase
              .database()
              .ref(
                `influencer_campaigns/${campaignId}/tasks/${taskId}/assets/${creatorId}/source`,
              )
              .set(s3Link),
            firebase
              .database()
              .ref(`influencer_tasks/${taskId}/assets/${creatorId}/source`)
              .set(s3Link),
            firebase
              .database()
              .ref(`users/${creatorId}/creator_assets/${creatorAssetId}/source`)
              .set(s3Link),
          ]);
        } catch (error) {
          console.error("Error writing data to Firebase:", logObject, error);
        }
      });
    });

    res.send("All updates written into firebase.");
  });
};

module.exports = {
  insertCampaignDrafts,
};
