require("dotenv").config();
const firebase = require(process.env.PRODEV);
const moment = require("moment");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const cors = require("cors")({ origin: true });
const z = require("zod");

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

const updateDatabaseWithPerformanceData = async (
  performanceData,
  brandId,
  campaignId,
  taskId,
  postId,
  creatorId,
) => {
  const performanceRef = await firebase
    .database()
    .ref(
      `influencer_campaigns/${campaignId}/tasks/${taskId}/posts/${postId}/performance`,
    );
  const newPerformanceRef = performanceRef.push();
  newPerformanceRef.set(performanceData);

  const influencerTasksRef = await firebase
    .database()
    .ref(`influencer_tasks/${taskId}/posts/${postId}/performance`);
  const newInfluencerTasksRef = influencerTasksRef.push();
  newInfluencerTasksRef.set(performanceData);

  const userInfluencerTasksRef = await firebase
    .database()
    .ref(
      `users/${creatorId}/influencer_tasks/${taskId}/posts/${postId}/performance`,
    );
  const newUserInfluencerTasksRef = userInfluencerTasksRef.push();
  newUserInfluencerTasksRef.set(performanceData);

  const brandInfluencerCampaignsRef = await firebase
    .database()
    .ref(
      `brands/${brandId}/influencer_campaigns/${campaignId}/tasks/${taskId}/posts/${postId}/performance`,
    );
  const newBrandInfluencerCampaignsRef = brandInfluencerCampaignsRef.push();
  newBrandInfluencerCampaignsRef.set(performanceData);
};

const createPost = async (brandId, campaignId, taskId, creatorId, post) => {
  const newPostKey = firebase.database().ref("influencer_posts").push().key;

  try {
    await Promise.all([
      firebase
        .database()
        .ref(
          `influencer_campaigns/${campaignId}/tasks/${taskId}/posts/${newPostKey}`,
        )
        .set(post),
      firebase
        .database()
        .ref(`influencer_tasks/${taskId}/posts/${newPostKey}`)
        .set(post),
      firebase
        .database()
        .ref(
          `users/${creatorId}/influencer_tasks/${taskId}/posts/${newPostKey}`,
        )
        .set(post),
      firebase
        .database()
        .ref(
          `brands/${brandId}/influencer_campaigns/${campaignId}/tasks/${taskId}/posts/${newPostKey}`,
        )
        .set(post),
      firebase
        .database()
        .ref(`influencer_posts/${newPostKey}`)
        .set({
          ...post,
          campaign_id: campaignId,
          task_id: taskId,
          campaign: true,
        }),
    ]);

    return newPostKey;
  } catch (error) {
    console.error("Error creating post: ", error);
    throw error;
  }
};

const insertSinglePostLink = async (req, res) => {
  cors(req, res, async () => {
    try {
      const {
        creator_name,
        brand_id,
        campaign_id,
        task_id,
        creator_id,
        platform,
        link,
        performanceData,
      } = req.body;

      const date = moment().format();
      performanceData.date = date;

      const post = {
        creator_id,
        creator_name,
        platform,
        link,
        short_link: "",
        performance: {
          ...performanceData,
        },
      };

      const post_id = await createPost(
        brand_id,
        campaign_id,
        task_id,
        creator_id,
        post,
      );

      updateDatabaseWithPerformanceData(
        performanceData,
        brand_id,
        campaign_id,
        task_id,
        post_id,
        creator_id,
      );

      res.status(200).send("Post link inserted successfully");
    } catch (error) {
      console.error("Error inserting post link: ", error);
    }
  });
};

module.exports = {
  insertSinglePostLink,
};
