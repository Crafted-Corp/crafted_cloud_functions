require("dotenv").config();
const cors = require("cors")({ origin: true });
const firebase = require(process.env.PRODEV);
const { tiktokMessageKey, metaMessageKey, lastErrorFor } = require("./socialErrors");

const { graphHostFor } = require("./graphHost");

const refreshUserToken = async (key, user) => {
  const refreshToken = user?.creator_socials?.tiktok?.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken || refreshToken === "null") return;
  try {
    const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
    const data = await response.json();
    const code = typeof data.error === "string" ? data.error : data.error_code ?? data.error?.code ?? data.data?.error?.code;
    const messageKey = tiktokMessageKey(code);
    const node = firebase.database().ref(`users/${key}/creator_socials/tiktok`);
    if (messageKey) {
      await node.update({ last_error: lastErrorFor(code, undefined, messageKey) });
      return;
    }
    if (!response.ok || !data.access_token || !data.refresh_token ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
        !Number.isFinite(data.refresh_expires_in) || data.refresh_expires_in <= 0) {
      console.warn(`[WARN] Invalid TikTok refresh response for user ${key}`);
      return;
    }
    const now = Date.now();
    await node.update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      access_token_expiry_date: new Date(now + data.expires_in * 1000).toISOString(),
      refresh_token_expiry_date: new Date(now + data.refresh_expires_in * 1000).toISOString(),
      updated_at: now,
      last_error: null,
    });
  } catch {
    console.error(`[ERROR] Failed refreshing TikTok token for user ${key}`);
  }
};

const refreshInstagramToken = async (key, user) => {
  const instagramInfo = user?.creator_socials?.instagram;
  if (instagramInfo?.api_path !== "instagram" || typeof instagramInfo.access_token !== "string" ||
      !instagramInfo.access_token || instagramInfo.access_token === "null" ||
      typeof instagramInfo.access_token_expires_at !== "string") return;
  const expiresAt = Date.parse(instagramInfo.access_token_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 30 * 24 * 60 * 60 * 1000) return;
  try {
    const query = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: instagramInfo.access_token });
    const response = await fetch(`${graphHostFor(instagramInfo)}/refresh_access_token?${query}`);
    const data = await response.json();
    const node = firebase.database().ref(`users/${key}/creator_socials/instagram`);
    if (Number(data.error?.code) === 190) {
      await node.update({ last_error: lastErrorFor(data.error.code, data.error.error_subcode, metaMessageKey(data.error)) });
      return;
    }
    if (!response.ok || data.error || typeof data.access_token !== "string" || !data.access_token ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      console.warn(`[WARN] Invalid Instagram refresh response for user ${key}`);
      return;
    }
    await node.update({
      access_token: data.access_token,
      access_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      last_error: null,
    });
  } catch {
    console.error(`[ERROR] Failed refreshing Instagram token for user ${key}`);
  }
};

const refreshUserTokens = async (key, user) => {
  await refreshUserToken(key, user);
  await refreshInstagramToken(key, user);
};

const refreshTiktokAccessTokens = async (req, res) => {
  cors(req, res, async () => {
    try {
      if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
        console.error("[ERROR] Missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET");
        return res.status(500).json({ status: "500", statuscode: "-1", result: "TikTok credentials are not configured" });
      }
      const usersRef = firebase.database().ref("users");
      const userId = req.query.user_id;
      if (userId) {
        const user = (await usersRef.child(userId).once("value")).val();
        if (!user) return res.status(404).json({ status: "404", statuscode: "-1", result: "User not found" });
        await refreshUserTokens(userId, user);
      } else {
        let lastKey = null;
        for (;;) {
          let query = usersRef.orderByKey().limitToFirst(100);
          if (lastKey) query = query.startAfter(lastKey);
          const users = (await query.once("value")).val();
          const keys = users ? Object.keys(users) : [];
          if (keys.length === 0) break;
          for (let i = 0; i < keys.length; i += 5) {
            await Promise.all(keys.slice(i, i + 5).map((key) => refreshUserTokens(key, users[key])));
          }
          lastKey = keys[keys.length - 1];
          if (keys.length < 100) break;
        }
      }
      return res.status(200).json({ status: "200", statuscode: "1", result: "Refresh completed" });
    } catch {
      console.error("[ERROR] Failed reading users for TikTok token refresh");
      return res.status(500).json({ status: "500", statuscode: "-1", result: "Refresh failed" });
    }
  });
};

module.exports = { refreshTiktokAccessTokens };
