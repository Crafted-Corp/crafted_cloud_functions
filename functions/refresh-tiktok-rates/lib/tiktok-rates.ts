import type * as admin from "firebase-admin";
import { median, tiktokSuggestedRate } from "./rates";
import { lastErrorFor, tiktokMessageKey } from "./social-errors";
import type {
    PerformanceNode,
    RateOutcome,
    TikTokEnvelope,
    TikTokUserInfo,
    TikTokVideoList,
    UserRecord,
} from "./types";

const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/?fields=follower_count";
const VIDEO_LIST_URL =
    "https://open.tiktokapis.com/v2/video/list/?fields=like_count,share_count,view_count,comment_count,share_url";

const readResponse = async <T>(
    response: Response,
    node: admin.database.Reference,
): Promise<TikTokEnvelope<T> | null> => {
    const data = (await response.json()) as TikTokEnvelope<T>;
    const code = data.error?.code;
    const messageKey = tiktokMessageKey(code);
    if (code !== undefined && messageKey) {
        await node.update({ last_error: lastErrorFor(code, undefined, messageKey) });
        return null;
    }
    if (!response.ok || (code !== undefined && code !== "ok" && code !== 0)) {
        throw new Error("TikTok request failed");
    }
    return data;
};

export const getSuggestedRateTikTok = async (
    firebase: admin.app.App,
    userId: string,
    user: UserRecord | undefined,
): Promise<RateOutcome> => {
    const token = user?.creator_socials?.tiktok?.access_token;
    if (user?.negotiated === true || typeof token !== "string" || !token || token === "null") return "skipped";
    try {
        const node = firebase.database().ref(`users/${userId}/creator_socials/tiktok`);
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        const userData = await readResponse<TikTokUserInfo>(
            await fetch(USER_INFO_URL, { method: "GET", headers }),
            node,
        );
        if (!userData) return "failed";
        if (!userData.data?.user) throw new Error("TikTok user missing");
        const followerCount = userData.data.user.follower_count || 0;
        const videoData = await readResponse<TikTokVideoList>(
            await fetch(VIDEO_LIST_URL, { method: "POST", headers, body: JSON.stringify({ max_count: 20 }) }),
            node,
        );
        if (!videoData) return "failed";
        const videos = videoData.data?.videos;
        if (!Array.isArray(videos)) throw new Error("TikTok video list missing");

        const median_views = median(videos.map((video) => video.view_count));
        const updated = new Date().toISOString();
        const handle = videos[0]?.share_url?.match(/@([^/]+)/)?.[1];
        const performance: PerformanceNode = {
            median_likes: median(videos.map((video) => video.like_count)),
            median_shares: median(videos.map((video) => video.share_count)),
            followerCount,
            median_views,
            median_comments: median(videos.map((video) => video.comment_count)),
            suggestedRate: tiktokSuggestedRate(median_views),
            updated,
        };
        await node.update({ performance, updated, last_error: null, ...(handle ? { handle } : {}) });
        return "processed";
    } catch {
        console.error(`[ERROR] Failed processing TikTok rate for user ${userId}`);
        return "failed";
    }
};
