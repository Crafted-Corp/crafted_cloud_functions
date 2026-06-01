require("dotenv").config();
const firebase = require(process.env.PRODEV);

const FACEBOOK_24 = "https://graph.facebook.com/v24.0";

async function processInstagramPost(
  post,
  creatorId,
  taskId,
  campaignId,
  shortLink,
  creatorName,
  brandId,
) {
  const idSnapshot = await firebase
    .database()
    .ref(
      `users/${creatorId}/creator_socials/instagram/instagram_business_account_id`,
    )
    .once("value");
  const tokenSnapshot = await firebase
    .database()
    .ref(`users/${creatorId}/creator_socials/instagram/access_token`)
    .once("value");

  const accessToken = tokenSnapshot.val();
  const instagramBusinessAccountId = idSnapshot.val();
  const mediaUrl = `${FACEBOOK_24}/${instagramBusinessAccountId}/media?access_token=${accessToken}`;
  const mediaResponse = await fetch(mediaUrl);
  const mediaData = await mediaResponse.json();
  
  if (!mediaResponse.ok) {
    console.error("Media response: ", mediaData);
    console.error("instagramBusinessAccountId: ", instagramBusinessAccountId);
    console.error("accessToken: ", accessToken);
    throw new Error(`Error fetching media data: ${JSON.stringify(mediaData)}`);
  }

  let mediaFound = false;

  const socialMediaLinkRegex = /\/reel\/([^/?]+)/;
  const socialMediaLinkMatch =
    post.social_media_link.match(socialMediaLinkRegex);
  const socialMediaLinkLastPart = socialMediaLinkMatch
    ? socialMediaLinkMatch[1]
    : null;

  for (const media of mediaData.data) {
    const mediaId = media.id;
    const mediaFetch = `${FACEBOOK_24}/${mediaId}?fields=id,media_type,permalink&access_token=${accessToken}`;
    const mediaFetchResponse = await fetch(mediaFetch);
    const mediaFetchData = await mediaFetchResponse.json();

    if (!mediaFetchResponse.ok) {
      console.error("Media details response: ", mediaFetchData);
      throw new Error(
        `Error fetching media details: ${JSON.stringify(mediaFetchData)}`,
      );
    }

    const permalink = mediaFetchData.permalink;

    console.log("mediaData: ", media);
    console.log("mediaFetchData: ", mediaFetchData);
    console.log("socialMediaLinkLastPart: ", socialMediaLinkLastPart);

    if (permalink.includes(socialMediaLinkLastPart)) {
      mediaFound = true;

      const postDetails = {
        platform: post.platform,
        link: post.social_media_link,
        short_link: shortLink || "",
        creator_id: creatorId,
        creator_name: creatorName,
        media_id: mediaId,
      };

      const newPostKey = firebase.database().ref("influencer_posts").push().key;

      try {
        await Promise.all([
          firebase
            .database()
            .ref(
              `influencer_campaigns/${campaignId}/tasks/${taskId}/posts/${newPostKey}`,
            )
            .set(postDetails),
          firebase
            .database()
            .ref(`influencer_tasks/${taskId}/posts/${newPostKey}`)
            .set(postDetails),
          firebase
            .database()
            .ref(
              `users/${creatorId}/influencer_tasks/${taskId}/posts/${newPostKey}`,
            )
            .set(postDetails),
          firebase
            .database()
            .ref(
              `brands/${brandId}/influencer_campaigns/${campaignId}/tasks/${taskId}/posts/${newPostKey}`,
            )
            .set(postDetails),
          firebase
            .database()
            .ref(`influencer_posts/${newPostKey}`)
            .set({ ...postDetails, campaignId, taskId, campaign: true }),
        ]);
      } catch (error) {
        console.error(error);
        throw new Error(
          "Failed to store post. Make sure you're using a correct Instagram link.",
        );
      }
      break;
    }
  }
  if (!mediaFound) {
    throw new Error("Matching mediaId not found for Instagram post.");
  }
}

async function processTikTokPost(
  post,
  campaignId,
  taskId,
  creatorId,
  brandId,
  shortLink,
  creatorName,
) {
  const postDetails = {
    platform: post.platform,
    link: post.social_media_link,
    short_link: shortLink || "",
    creator_id: creatorId,
    creator_name: creatorName,
  };

  const newPostKey = firebase.database().ref("influencer_posts").push().key;

  try {
    await Promise.all([
      firebase
        .database()
        .ref(
          `influencer_campaigns/${campaignId}/tasks/${taskId}/posts/${newPostKey}`,
        )
        .set(postDetails),
      firebase
        .database()
        .ref(`influencer_tasks/${taskId}/posts/${newPostKey}`)
        .set(postDetails),
      firebase
        .database()
        .ref(
          `users/${creatorId}/influencer_tasks/${taskId}/posts/${newPostKey}`,
        )
        .set(postDetails),
      firebase
        .database()
        .ref(
          `brands/${brandId}/influencer_campaigns/${campaignId}/tasks/${taskId}/posts/${newPostKey}`,
        )
        .set(postDetails),
      firebase
        .database()
        .ref(`influencer_posts/${newPostKey}`)
        .set({ ...postDetails, campaignId, taskId, campaign: true }),
    ]);
  } catch (error) {
    console.error(error);
    throw new Error(
      "Failed to store post. Make sure you're using a correct TikTok link.",
    );
  }
}

module.exports = {
  processInstagramPost,
  processTikTokPost,
};
