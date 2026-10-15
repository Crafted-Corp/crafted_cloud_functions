require("dotenv").config();
const firebase = require(process.env.PRODEV);
const cors = require("cors")({ origin: true });
const { tiktokMessageKey, lastErrorFor } = require("./socialErrors");

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = values.sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const getSuggestedRateTikTok = async (userId, user) => {
  const social = user?.creator_socials?.tiktok;
  const token = social?.access_token;
  if (user?.negotiated === true || typeof token !== "string" || !token || token === "null") return "skipped";
  try {
    const node = firebase.database().ref(`users/${userId}/creator_socials/tiktok`);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const readResponse = async (response) => {
      const data = await response.json();
      const code = data.error?.code;
      const messageKey = tiktokMessageKey(code);
      if (messageKey) {
        await node.update({ last_error: lastErrorFor(code, undefined, messageKey) });
        return null;
      }
      if (!response.ok || (code !== undefined && code !== "ok" && code !== 0)) {
        throw new Error("TikTok request failed");
      }
      return data;
    };
    const userData = await readResponse(await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=follower_count",
      { method: "GET", headers },
    ));
    if (!userData) return "failed";
    if (!userData.data?.user) throw new Error("TikTok user missing");
    const followerCount = userData.data.user.follower_count || 0;
    const videoData = await readResponse(await fetch(
      "https://open.tiktokapis.com/v2/video/list/?fields=like_count,share_count,view_count,comment_count,share_url",
      { method: "POST", headers, body: JSON.stringify({ max_count: 20 }) },
    ));
    if (!videoData) return "failed";
    const videos = videoData.data?.videos;
    if (!Array.isArray(videos)) throw new Error("TikTok video list missing");
    const median_views = median(videos.map((video) => video.view_count));
    const median_likes = median(videos.map((video) => video.like_count));
    const median_shares = median(videos.map((video) => video.share_count));
    const median_comments = median(videos.map((video) => video.comment_count));
    const suggestedRate = (median_views / 1000) * 2500;
    const updated = new Date().toISOString();
    const handle = videos[0]?.share_url?.match(/@([^/]+)/)?.[1];
    await node.update({
      performance: { median_likes, median_shares, followerCount, median_views, median_comments, suggestedRate, updated },
      updated,
      last_error: null,
      ...(handle ? { handle } : {}),
    });
    return "processed";
  } catch {
    console.error(`[ERROR] Failed processing TikTok rate for user ${userId}`);
    return "failed";
  }
};

const refreshTiktokRatesForAllAccounts = (req, res) => {
  cors(req, res, async () => {
    try {
      const usersRef = firebase.database().ref("users");
      const counts = { processed: 0, skipped: 0, failed: 0 };
      const processBatch = async (keys, users) => {
        for (let i = 0; i < keys.length; i += 5) {
          const results = await Promise.all(keys.slice(i, i + 5).map((key) => getSuggestedRateTikTok(key, users[key])));
          for (const result of results) counts[result] += 1;
        }
      };
      const userId = req.query.user_id;
      if (userId) {
        const user = (await usersRef.child(userId).once("value")).val();
        if (!user) return res.status(404).json({ message: "User not found" });
        await processBatch([userId], { [userId]: user });
      } else {
        let lastKey = null;
        for (;;) {
          let query = usersRef.orderByKey().limitToFirst(100);
          if (lastKey) query = query.startAfter(lastKey);
          const users = (await query.once("value")).val();
          const keys = users ? Object.keys(users) : [];
          if (keys.length === 0) break;
          await processBatch(keys, users);
          lastKey = keys[keys.length - 1];
          if (keys.length < 100) break;
        }
      }
      return res.status(200).json(counts);
    } catch {
      console.error("[ERROR] Failed reading users for TikTok rate refresh");
      return res.status(500).json({ message: "Error updating suggested rates" });
    }
  });
};

module.exports = { refreshTiktokRatesForAllAccounts };
