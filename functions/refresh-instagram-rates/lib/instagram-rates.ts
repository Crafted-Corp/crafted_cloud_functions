import type * as admin from "firebase-admin";
import { graphHostFor } from "./graph-host";
import { instagramSuggestedRate, median } from "./rates";
import { lastErrorFor, metaMessageKey } from "./social-errors";
import type { GraphErrorBody, InstagramSocialNode, SuggestedRate, UserRateResult, UserRecord } from "./types";

const BATCH_SIZE_MEDIA = 5;
const MAX_REELS = 25;
const RATE_LIMIT_CODES = [4, 17, 32];

interface MediaListResponse {
    data?: { id: string; media_type?: string }[];
    error?: GraphErrorBody;
}

interface InsightsResponse {
    data?: { values: { value: number }[] }[];
    error?: GraphErrorBody;
}

export class GraphRequestError extends Error {
    constructor(
        message: string,
        readonly graphError: GraphErrorBody | undefined,
    ) {
        super(message);
    }
}

const isRateLimited = (graphError: GraphErrorBody | undefined): boolean =>
    RATE_LIMIT_CODES.includes(Number(graphError?.code));

const fetchGraph = async <T extends { error?: GraphErrorBody }>(
    url: string,
    what: "media" | "insights",
): Promise<T> => {
    const response = await fetch(url);
    const body = (await response.json()) as T;
    if (body.error || !response.ok) {
        throw new GraphRequestError(`Failed fetching Instagram ${what} (${response.status})`, body.error);
    }
    return body;
};

const accountIdFor = (node: InstagramSocialNode | undefined): string | undefined =>
    node?.api_path === "instagram" ? node.instagram_user_id : node?.instagram_business_account_id;

const fetchPlayCount = async (
    host: string,
    mediaId: string,
    accountId: string,
    accessToken: string,
): Promise<number | null> => {
    try {
        const insights = await fetchGraph<InsightsResponse>(
            `${host}/${mediaId}/insights?access_token=${accessToken}&metric=views`,
            "insights",
        );
        if (insights.data && insights.data.length > 0) {
            return insights.data[0].values[0].value;
        }
        return null;
    } catch (error) {
        if (
            error instanceof GraphRequestError &&
            (metaMessageKey(error.graphError) || isRateLimited(error.graphError))
        ) {
            throw error;
        }
        console.error(
            `[ERROR] Failed to fetch insights for mediaId ${mediaId} of business_account_id ${accountId}:`,
            error,
        );
        return null;
    }
};

export const calculateSuggestedRate = async (
    accessToken: string,
    accountId: string,
    node: InstagramSocialNode,
): Promise<SuggestedRate> => {
    const host = graphHostFor(node);
    console.log(`[INFO] Fetching media for business_account_id ${accountId}`);
    const media = await fetchGraph<MediaListResponse>(
        `${host}/${accountId}/media?fields=media_type&access_token=${accessToken}&limit=300`,
        "media",
    );
    if (!Array.isArray(media.data)) {
        throw new Error("Instagram media list missing");
    }

    const mediaIds = media.data
        .filter((item) => item.media_type === "VIDEO")
        .slice(0, MAX_REELS)
        .map((item) => item.id);

    const playCounts: number[] = [];
    for (let i = 0; i < mediaIds.length; i += BATCH_SIZE_MEDIA) {
        const batch = mediaIds.slice(i, i + BATCH_SIZE_MEDIA);
        const plays = await Promise.all(batch.map((id) => fetchPlayCount(host, id, accountId, accessToken)));
        for (const play of plays) {
            if (play !== null) playCounts.push(play);
        }
    }

    const medianPlays = median(playCounts);
    const suggestedRate = instagramSuggestedRate(medianPlays);
    console.log(`[INFO] Calculated suggested rate: ${suggestedRate}`);
    return { suggestedRate, medianPlays };
};

export const processUserInstagramRate = async (
    firebase: admin.app.App,
    creatorId: string,
    user: UserRecord | undefined,
): Promise<UserRateResult> => {
    if (user?.negotiated === true) {
        console.log(`[INFO] Skipping user ${creatorId} due to negotiated=true`);
        return { outcome: "skipped", reason: "negotiated" };
    }

    const instagramInfo = user?.creator_socials?.instagram;
    const accountId = accountIdFor(instagramInfo);
    if (!instagramInfo || !accountId || !instagramInfo.access_token) {
        console.warn(`[WARN] Missing Instagram info for user ${creatorId}, skipping`);
        return { outcome: "skipped", reason: "missing_instagram_info" };
    }

    const node = firebase.database().ref(`users/${creatorId}/creator_socials/instagram`);
    console.log(`[INFO] Calculating suggested rate for user ${creatorId}`);
    let rate: SuggestedRate;
    try {
        rate = await calculateSuggestedRate(instagramInfo.access_token, accountId, instagramInfo);
    } catch (error) {
        const graphError = error instanceof GraphRequestError ? error.graphError : undefined;
        const messageKey = metaMessageKey(graphError);
        if (graphError?.code !== undefined && messageKey) {
            await node.update({ last_error: lastErrorFor(graphError.code, graphError.error_subcode, messageKey) });
            return { outcome: "skipped", reason: "token_error" };
        }
        if (isRateLimited(graphError)) {
            console.warn(`[WARN] rate limited for user ${creatorId}`);
            return { outcome: "skipped", reason: "rate_limited" };
        }
        throw error;
    }
    if (!Number.isFinite(rate.suggestedRate)) {
        throw new Error(`Failed to calculate suggested rate for creator ${creatorId}`);
    }

    await node.update({
        suggested_rate: rate.suggestedRate,
        median_plays: rate.medianPlays,
        updated: new Date().toISOString(),
        last_error: null,
    });
    console.log(`[INFO] Updated suggested rate for user ${creatorId}`);
    return { outcome: "processed", suggestedRate: rate.suggestedRate };
};
