require("dotenv").config();
const moment = require("moment");
const firebase = require(process.env.PRODEV);
const FB = require("facebook-node-sdk");
const { constrainedMemory } = require("process");
const appId = process.env.APP_ID;
const appSecret = process.env.APP_SECRET;
const fb = new FB({ appId, appSecret });
const cors = require("cors")({ origin: true });

const refreshTiktokRatesForAllAccounts = (req, res) => {
  cors(req, res, async () => {
    const usersRef = firebase.database().ref("users");
    usersRef
      .orderByChild("creator_socials/tiktok/performance/suggestedRate")
      .startAt(null)
      .once("value")
      .then((snapshot) => {
        snapshot.forEach((userSnapshot) => {
          const userId = userSnapshot.key;
          //console.log(userId);
          const tikTokInfo = userSnapshot
            .child("creator_socials/tiktok/performance/suggestedRate")
            .val();

          if (tikTokInfo) {
            try {
              getSuggestedRateTikTok(userId);
            } catch (error) {
              console.error(
                "Error fetching and calculating video data:",
                error,
              );
            }
          }
        });
        console.log("Suggested rates updated succesfully");
        res
          .status(200)
          .json({ message: "Suggested rates updated succesfully" });
      })
      .catch((error) => {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Error updating suggested rates" });
      });
  });
};

const getSuggestedRateTikTok = async (userId) => {
  try {
    const creator_id = userId;
    const snapshot = await firebase
      .database()
      .ref(`users/${creator_id}/creator_socials/tiktok/access_token`)
      .once("value");
    const accessToken = snapshot.val();

    const userInfoHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    // Fetch user info data to get the follower count
    const userInfoResponse = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=follower_count",
      { method: "GET", headers: userInfoHeaders },
    );
    const userData = await userInfoResponse.json();
    const followerCount = userData.data.user.follower_count || 0;

    const videoListHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const videoListBody = JSON.stringify({
      max_count: 20,
    });

    const videoListOptions = {
      method: "POST",
      headers: videoListHeaders,
      body: videoListBody,
    };

    // Fetch video list data
    const videoListResponse = await fetch(
      "https://open.tiktokapis.com/v2/video/list/?fields=like_count,share_count,view_count,comment_count,share_url",
      videoListOptions,
    );
    const videoListData = await videoListResponse.json();
    const videos = videoListData.data.videos;
    if (videos) {
      const firstVideo = videos[0];
      const shareUrl = firstVideo.share_url;
      const handle = shareUrl.split("@")[1].split("/")[0];

      // Store the username in Firebase
      await firebase
        .database()
        .ref(`users/${creator_id}/creator_socials/tiktok/handle`)
        .set(handle);
    }
    // Calculate total engagement metrics
    let totalLikeCount = 0;
    let totalShareCount = 0;
    let totalViewCount = 0;
    let totalCommentCount = 0;

    let likeArray = [];
    let shareArray = [];
    let viewArray = [];
    let commentArray = [];

    for (const video of videos) {
      likeArray.push(video.like_count);
      shareArray.push(video.share_count);
      viewArray.push(video.view_count);
      commentArray.push(video.comment_count);
    }

    const views_sorted_array = viewArray.sort((a, b) => a - b);
    function median(arr) {
      let mid = Math.floor(arr.length / 2);
      let sortedArr = arr.sort((a, b) => a - b);
      if (arr.length % 2 === 0) {
        return (sortedArr[mid - 1] + sortedArr[mid]) / 2;
      } else {
        return sortedArr[mid];
      }
    }
    const median_views = median(viewArray);
    const median_likes = median(likeArray);
    const median_shares = median(shareArray);
    const median_comments = median(commentArray);

    const videoCount = videos.length;

    /*Calculate average engagement metrics
        const avg10_likes = parseFloat((totalLikeCount / videoCount).toFixed(2));
        const avg10_shares  = parseFloat((totalShareCount / videoCount).toFixed(2));
        const avg10_views = parseFloat((totalViewCount / videoCount).toFixed(2));
        const avg10_comments = parseFloat((totalCommentCount / videoCount).toFixed(2));
        */
    // Calculate suggested rate formula
    let suggestedRate = (median_views / 1000) * 2500;
    console.log("suggested rate: " + suggestedRate);
    console.log("avg10_likes: " + median_likes);
    console.log("avg10_shares: " + median_shares);
    console.log("avg10_comments: " + median_comments);
    console.log("followerCount by 1000: " + followerCount / 1000);
    const updated = moment().format();

    // Store data in Firebase
    if (!suggestedRate) {
      console.error(
        `Failed to calculate a suggested rate for creator ${creator_id}`,
      );
      return null;
    }

    await firebase
      .database()
      .ref(`users/${creator_id}/creator_socials/tiktok/performance`)
      .set({
        median_likes,
        median_shares,
        followerCount,
        median_views,
        median_comments,
        suggestedRate,
        updated,
      });

    //res.status(200).json({ status: "200", statuscode: "1", result: { median_likes, median_shares, median_views, median_comments, followerCount, suggestedRate, updated } });
  } catch (error) {
    console.error("Error fetching and calculating video data:", error);
    // res.status(500).json({ status: "500", statuscode: "-1", result: error });
  }
};

module.exports = {
  refreshTiktokRatesForAllAccounts,
};
