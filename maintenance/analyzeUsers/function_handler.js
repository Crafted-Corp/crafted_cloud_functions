require("dotenv").config();
const firebase = require(process.env.PRODEV);
const cors = require("cors")({ origin: true });
const xlsx = require("xlsx");
const z = require("zod");
const fs = require('fs');

const schema = z.object({
  email: z.string(),
  name: z.string(),
  username: z.string(),
  avatar: z.string(),
  bio: z.string(),
  average_rating: z.number(),
  shipping_details: z.object({
    address1: z.string(),
    address2: z.string(),
    city: z.string(),
    country: z.string(),
    fullname: z.string(),
    state: z.string(),
    zipcode: z.string(),
  }),
  creator_socials: z.object({
    instagram: z.object({
      access_token: z.string(),
      follower_count: z.number(),
      handle: z.string(),
      instagram_business_account_id: z.string(),
      median_comments: z.number(),
      median_likes: z.number(),
      median_plays: z.number(),
      median_shares: z.number(),
      page_access_token: z.string(),
      profile_picture: z.string().url(),
      suggested_rate: z.number(),
      updated: z.string(),
    }),
    tiktok: z.object({
      access_token: z.string(),
      access_token_expiry_date: z.string(),
      handle: z.string(),
      performance: z.object({
        followerCount: z.number(),
        median_comments: z.number(),
        median_likes: z.number(),
        median_shares: z.number(),
        median_views: z.number(),
        suggestedRate: z.number(),
        updated: z.string(),
      }), // Optional because we allow incomplete TikTok if Instagram is present
      refresh_token: z.string(),
      refresh_token_expiry_date: z.string(),
      tiktok_ID: z.string(),
    }),
  }),
});

const insertCampaignDrafts = async (req, res) => {
  const workbook = xlsx.readFile("proposals.csv");
  const errorResults = [];

  cors(req, res, async () => {
    const sheetPromises = workbook.SheetNames.map(async (sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      const rowPromises = data.map(async (row) => {
        const creatorId = row["Creator UID"];
        const name = row["Name"];

        console.log("Creator ID:", creatorId);

        if (!creatorId) {
          console.error("Missing data in row:", creatorId);
          return;
        }

        try {
          const snapshot = await firebase
            .database()
            .ref("users/" + creatorId)
            .once("value");

          if (snapshot.val()) {
            const user = snapshot.val();

            const parsedData = schema.safeParse(user);
            if (!parsedData.success) {
              console.log(
                "Invalid data for creator:",
                creatorId,
                parsedData.error.errors,
              );
              errorResults.push({
                Name: name,
                "Creator ID": creatorId,
                errors: JSON.stringify(parsedData.error.errors),
              });
            }
          }
        } catch (error) {
          console.error("Error analyzing user:", logObject, error);
        }
      });

      await Promise.all(rowPromises);
    });

    await Promise.all(sheetPromises);

    // Generate CSV with error results
    const errorWorkbook = xlsx.utils.book_new();
    const errorWorksheet = xlsx.utils.json_to_sheet(errorResults);
    xlsx.utils.book_append_sheet(errorWorkbook, errorWorksheet, "Errors");
    xlsx.writeFile(errorWorkbook, "error_results.csv");

    res.send("All users analyzed.");
  });
};

module.exports = {
  insertCampaignDrafts,
};
