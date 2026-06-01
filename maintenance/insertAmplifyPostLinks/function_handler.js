require("dotenv").config();
const firebase = require(process.env.PRODEV);
const cors = require("cors")({ origin: true });
const xlsx = require("xlsx");
const { processInstagramPost, processTikTokPost } = require("./utils");

const insertCampaignDrafts = async (req, res) => {
  const workbook = xlsx.readFile("insertPostLinks-all.csv");
  console.log("Workbook read successfully");

  const existingPosts = [];
  const successfulPosts = [];
  const failedPosts = [];

  cors(req, res, async () => {
    for (const sheetName of workbook.SheetNames) {
      console.log(`Processing sheet: ${sheetName}`);
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      for (const row of data) {
        console.log(`Processing row: ${JSON.stringify(row)}`);
        const brandId = row["brandId"];
        const campaignId = row["campaignId"];
        const taskId = row["taskId"];
        const creatorId = row["creatorId"];
        const platform = row["platform"];
        const postLink = row["postLink"];
        const creatorName = row["creatorName"];

        const logObject = { campaignId, taskId, creatorId, platform, postLink };

        if (
          !campaignId ||
          !taskId ||
          !creatorId ||
          !platform ||
          !postLink ||
          !creatorName
        ) {
          console.error("Missing data in row:", logObject);
          return;
        }

        try {
          console.log("Checking if post already exists:", logObject);
          const postRef = firebase.database().ref(`influencer_tasks/${taskId}/posts/`);
          const snapshot = await postRef.once('value');
          const posts = snapshot.val();

          let postExists = false;
          if (posts) {
            for (const key in posts) {
              if (posts[key].link === postLink) {
                postExists = true;
                break;
              }
            }
          }

          if (postExists) {
            console.log("Post already exists:", logObject);
            existingPosts.push(logObject);
            continue;
          }

          const post = {
            social_media_link: postLink,
            platform,
          };

          console.log("Processing post for platform:", platform);
          switch (platform) {
            case "instagram":
              await processInstagramPost(
                post,
                creatorId,
                taskId,
                campaignId,
                "",
                creatorName,
                brandId,
              );
              console.log("Instagram post processed:", logObject);
              successfulPosts.push(logObject);
              break;

            case "tiktok":
              await processTikTokPost(
                post,
                campaignId,
                taskId,
                creatorId,
                brandId,
                "",
                creatorName,
              );
              console.log("TikTok post processed:", logObject);
              successfulPosts.push(logObject);
              break;

            default:
              console.log("Unsupported platform:", platform);
              break;
          }
        } catch (error) {
          console.error("Error creating post:", logObject, error);
          failedPosts.push({ ...logObject, error: error.message });
        }
      }
    }

    console.log("All updates written into firebase.");
    console.log("Existing posts:", existingPosts);
    console.log("Successfully added posts:", successfulPosts);
    console.log("Failed posts:", failedPosts);
    res.send("All updates written into firebase.");
  });
};

module.exports = {
  insertCampaignDrafts,
};
