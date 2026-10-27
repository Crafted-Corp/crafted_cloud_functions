import type { LastError } from "./social-errors";

export interface GraphErrorBody {
    code?: number;
    error_subcode?: number;
    message?: string;
}

export interface InstagramSocialNode {
    access_token?: string;
    instagram_business_account_id?: string;
    instagram_user_id?: string;
    api_path?: "facebook" | "instagram";
    suggested_rate?: number;
    median_plays?: number;
    updated?: string;
    last_error?: LastError | null;
}

export interface UserRecord {
    negotiated?: boolean;
    creator_socials?: { instagram?: InstagramSocialNode };
}

export interface SuggestedRate {
    suggestedRate: number;
    medianPlays: number;
}

export type SkipReason = "negotiated" | "missing_instagram_info" | "token_error" | "rate_limited";

export type UserRateResult =
    | { outcome: "processed"; suggestedRate: number }
    | { outcome: "skipped"; reason: SkipReason };

export type RateOutcome = UserRateResult | { outcome: "failed" };
