import type { LastError } from "./social-errors";

export interface TikTokSocialNode {
    access_token?: string;
    handle?: string;
    performance?: PerformanceNode;
    updated?: string;
    last_error?: LastError | null;
}

export interface UserRecord {
    negotiated?: boolean;
    creator_socials?: { tiktok?: TikTokSocialNode };
}

export interface TikTokVideo {
    view_count: number;
    like_count: number;
    share_count: number;
    comment_count: number;
    share_url?: string;
}

export interface TikTokEnvelope<T> {
    data?: T;
    error?: { code?: number | string };
}

export interface TikTokUserInfo {
    user?: { follower_count?: number };
}

export interface TikTokVideoList {
    videos?: TikTokVideo[];
}

export interface PerformanceNode {
    median_likes: number;
    median_shares: number;
    followerCount: number;
    median_views: number;
    median_comments: number;
    suggestedRate: number;
    updated: string;
}

export type RateOutcome = "processed" | "skipped" | "failed";
