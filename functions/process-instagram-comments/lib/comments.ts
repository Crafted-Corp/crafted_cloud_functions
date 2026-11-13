import type * as admin from "firebase-admin";
import { graphHostFor } from "./graph-host";
import { lastErrorFor, metaMessageKey } from "./social-errors";

export type RecordValue = Record<string, unknown>;
export interface Comment extends RecordValue {
    id: string;
    text?: string;
    timestamp?: string;
    username?: string;
}
export interface Counts {
    campaigns: number;
    postsProcessed: number;
    commentsCollected: number;
    skipped: number;
    failed: number;
}
export const record = (value: unknown): RecordValue | null =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : null;
export const validKey = (value: unknown): value is string =>
    typeof value === "string" &&
    value.trim() !== "" &&
    !/[.#$[\]/]/.test(value) &&
    [...value].every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127);
const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "" && value !== "null";
export class CommentFetchError extends Error {
    constructor(
        readonly category: string,
        readonly status?: number,
        readonly code?: number,
        readonly subcode?: number,
    ) {
        super(`Comment synchronization failed: ${category}`);
    }
}
export const collectComments = async (
    mediaId: string,
    token: string,
    apiPath?: string,
    request: typeof fetch = fetch,
): Promise<Comment[]> => {
    const comments = new Map<string, Comment>();
    const seen = new Set<string>();
    let after: string | undefined;
    for (;;) {
        const url = new URL(`${graphHostFor({ api_path: apiPath })}/${mediaId}/comments`);
        url.searchParams.set("fields", "id,text,username,timestamp");
        url.searchParams.set("limit", "100");
        if (after) url.searchParams.set("after", after);
        let response: Response;
        try {
            response = await request(url, {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(20000),
            });
        } catch {
            throw new CommentFetchError("transport");
        }
        let payload: unknown;
        try {
            payload = await response.json();
        } catch {
            throw new CommentFetchError("malformed", response.status);
        }
        const body = record(payload);
        const error = record(body?.error);
        if (!response.ok || error)
            throw new CommentFetchError(
                "provider",
                response.status,
                typeof error?.code === "number" ? error.code : undefined,
                typeof error?.error_subcode === "number" ? error.error_subcode : undefined,
            );
        if (!body || !Array.isArray(body.data)) throw new CommentFetchError("malformed", response.status);
        for (const raw of body.data) {
            const item = record(raw);
            if (
                !item ||
                !text(item.id) ||
                (item.text !== undefined && typeof item.text !== "string") ||
                (item.timestamp !== undefined && typeof item.timestamp !== "string") ||
                (item.username !== undefined && typeof item.username !== "string")
            )
                throw new CommentFetchError("malformed");
            comments.set(item.id, item as Comment);
        }
        const paging = body.paging === undefined ? null : record(body.paging);
        if (body.paging !== undefined && !paging) throw new CommentFetchError("pagination");
        if (!paging || paging.next === undefined) break;
        const cursor = record(paging.cursors)?.after;
        if (typeof paging.next !== "string" || !text(cursor) || seen.has(cursor) || body.data.length === 0)
            throw new CommentFetchError("pagination");
        seen.add(cursor);
        after = cursor;
    }
    return [...comments.values()];
};
export const syncCampaign = async (
    app: admin.app.App,
    campaignId: string,
    campaign: RecordValue,
    request: typeof fetch = fetch,
): Promise<Counts> => {
    const counts: Counts = { campaigns: 1, postsProcessed: 0, commentsCollected: 0, skipped: 0, failed: 0 };
    const tasks = campaign.tasks === undefined ? {} : record(campaign.tasks);
    if (!tasks) throw new CommentFetchError("campaign_shape");
    for (const rawTask of Object.values(tasks)) {
        const task = record(rawTask);
        const posts = task?.posts === undefined ? {} : record(task.posts);
        if (!task || !posts) {
            counts.failed++;
            continue;
        }
        for (const [postId, rawPost] of Object.entries(posts)) {
            const post = record(rawPost);
            if (!post || !validKey(postId)) {
                counts.failed++;
                continue;
            }
            const legacyInstagram =
                post.platform === undefined &&
                text(post.media_id) &&
                typeof post.link === "string" &&
                /^https:\/\/(www\.)?instagram\.com\//i.test(post.link);
            if (
                (post.platform !== "instagram" && !legacyInstagram) ||
                !validKey(post.media_id) ||
                !validKey(post.creator_id)
            ) {
                counts.skipped++;
                continue;
            }
            try {
                const socialRef = app.database().ref(`users/${post.creator_id}/creator_socials/instagram`);
                const social = record((await socialRef.once("value")).val());
                if (
                    !social ||
                    !text(social.access_token) ||
                    (social.api_path !== undefined &&
                        social.api_path !== "facebook" &&
                        social.api_path !== "instagram") ||
                    !text(
                        social.api_path === "instagram"
                            ? social.instagram_user_id
                            : social.instagram_business_account_id,
                    )
                ) {
                    counts.skipped++;
                    continue;
                }
                try {
                    const comments = await collectComments(
                        post.media_id,
                        social.access_token,
                        typeof social.api_path === "string" ? social.api_path : undefined,
                        request,
                    );
                    await app
                        .database()
                        .ref(`influencer_campaigns/${campaignId}/instagram_comments/${postId}`)
                        .set(comments);
                    counts.postsProcessed++;
                    counts.commentsCollected += comments.length;
                } catch (error) {
                    if (error instanceof CommentFetchError) {
                        const messageKey = metaMessageKey({ code: error.code, error_subcode: error.subcode });
                        if (messageKey && error.code !== undefined)
                            await socialRef
                                .child("last_error")
                                .set(lastErrorFor(error.code, error.subcode, messageKey));
                    }
                    throw error;
                }
            } catch (error) {
                counts.failed++;
                console.warn(
                    JSON.stringify({
                        operation: "comments_post_failed",
                        category: error instanceof CommentFetchError ? error.category : "storage",
                        code: error instanceof CommentFetchError ? error.code : undefined,
                    }),
                );
            }
        }
    }
    return counts;
};
export const syncAll = async (app: admin.app.App): Promise<Counts> => {
    const counts: Counts = { campaigns: 0, postsProcessed: 0, commentsCollected: 0, skipped: 0, failed: 0 };
    let after: string | undefined;
    for (;;) {
        let query = app.database().ref("influencer_campaigns").orderByKey().limitToFirst(100);
        if (after) query = query.startAfter(after);
        const value: unknown = (await query.once("value")).val();
        if (value === null) break;
        const campaigns = record(value);
        if (!campaigns) throw new CommentFetchError("campaign_shape");
        const entries = Object.entries(campaigns);
        if (!entries.length) break;
        for (const [id, raw] of entries) {
            try {
                const campaign = record(raw);
                if (!campaign) throw new CommentFetchError("campaign_shape");
                const outcome = await syncCampaign(app, id, campaign);
                for (const key of Object.keys(counts) as (keyof Counts)[]) counts[key] += outcome[key];
            } catch {
                counts.failed++;
            }
        }
        after = entries[entries.length - 1][0];
        if (entries.length < 100) break;
    }
    return counts;
};
