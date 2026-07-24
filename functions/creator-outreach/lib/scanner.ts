/**
 * Scanner module — batched user scan with product-specific matching.
 *
 * Both matchers run over the same paginated loop (100 users at a time) so the
 * full users collection is never read into memory at once.
 */

import type * as admin from "firebase-admin";
import type { AmplifyOutreachRequest, OutreachRequest } from "./schemas";

const BATCH_SIZE = 100;

interface ShippingDetails {
    state?: string;
    country?: string;
    fullname?: string;
}

interface TiktokSocial {
    performance?: {
        followerCount?: number | string;
        suggestedRate?: number;
    };
}

interface InstagramSocial {
    follower_count?: number | string;
    suggested_rate?: number;
}

interface CreatorSocials {
    tiktok?: TiktokSocial;
    instagram?: InstagramSocial;
    [platform: string]: unknown;
}

interface FirebaseUser {
    email?: string;
    paypail_email?: string;
    creator_tasks?: unknown;
    shipping_details?: ShippingDetails;
    creator_socials?: CreatorSocials;
}

export interface MatchedCreator {
    email?: string;
    id: string;
    shipping_details?: ShippingDetails;
    creator_socials?: CreatorSocials;
}

export const matchBatchStudio = (users: Record<string, FirebaseUser>, taskRegions: string[]): MatchedCreator[] => {
    const matched: MatchedCreator[] = [];

    Object.entries(users).forEach(([key, user]) => {
        if (!user || !user.creator_tasks) return;

        const userState =
            user.shipping_details && user.shipping_details.state && user.shipping_details.state.toUpperCase();
        const userCountry =
            user.shipping_details && user.shipping_details.country && user.shipping_details.country.toUpperCase();

        const isRegionMatch =
            (taskRegions.includes("USA") && userCountry === "USA") ||
            (taskRegions.includes("CAN") && userCountry === "CAN") ||
            (userState && taskRegions.includes(userState));

        if (isRegionMatch) {
            matched.push({
                // paypail_email is the real field name in Firebase (not a typo in code)
                email: user.email || user.paypail_email,
                id: key,
                shipping_details: user.shipping_details,
            });
        }
    });

    return matched;
};

export const parseFollowerCount = (value: number | string | undefined): number | undefined => {
    if (typeof value === "string") {
        return Number.parseInt(value.replace(/,/g, ""), 10);
    }
    return value;
};

export const matchBatchAmplify = (
    users: Record<string, FirebaseUser>,
    data: AmplifyOutreachRequest,
): MatchedCreator[] => {
    const matched: MatchedCreator[] = [];
    const [minFollowerCount, maxFollowerCount] = data.follower_count;
    const { platforms, states } = data;

    Object.entries(users).forEach(([key, user]) => {
        const instagramFollowerCount = user?.creator_socials?.instagram?.follower_count;
        const tiktokFollowerCount = user?.creator_socials?.tiktok?.performance?.followerCount;

        // At least one follower count must exist
        if (tiktokFollowerCount === undefined && instagramFollowerCount === undefined) {
            return;
        }

        const parsedTiktok = parseFollowerCount(tiktokFollowerCount);
        const parsedInstagram = parseFollowerCount(instagramFollowerCount);
        const followerCount = (parsedTiktok || 0) + (parsedInstagram || 0);

        if (Number.isNaN(followerCount) || followerCount === 0) return;

        // State match: "USA" matches all users; otherwise must match exactly
        const influencerState = user?.shipping_details?.state;
        const isStateMatch =
            (states.length === 1 && states[0] === "USA") ||
            // influencerState may be undefined; Array.includes handles that (returns false) —
            // the cast only satisfies the string[] element type without changing behavior.
            states.includes(influencerState as string);

        // Follower count within range
        const isFollowerMatch = followerCount >= minFollowerCount && followerCount <= maxFollowerCount;

        // At least one platform present in creator_socials
        const isPlatformMatch = platforms.some((p) => Boolean(user?.creator_socials?.[p]));

        if (isStateMatch && isFollowerMatch && isPlatformMatch) {
            matched.push({
                creator_socials: user.creator_socials,
                email: user.email,
                id: key,
                shipping_details: user.shipping_details,
            });
        }
    });

    return matched;
};

export const scanCreators = async (firebase: admin.app.App, data: OutreachRequest): Promise<MatchedCreator[]> => {
    const usersRef = firebase.database().ref("users");
    let lastKey: string | null = null;
    let moreUsers = true;
    let matchingCreators: MatchedCreator[] = [];

    // The [] fallback is inert for amplify — matchBatchStudio only runs on the studio branch below.
    const taskRegions = data.product === "studio" ? data.task.regions.map((region) => region.value) : [];

    while (moreUsers) {
        let query = usersRef.orderByKey().limitToFirst(BATCH_SIZE);
        if (lastKey) {
            query = query.startAfter(lastKey);
        }

        const snapshot = await query.once("value");
        const users = snapshot.val();

        if (!users) break;

        const keys = Object.keys(users);
        if (keys.length === 0) break;

        lastKey = keys[keys.length - 1];
        if (keys.length < BATCH_SIZE) moreUsers = false;

        const batch =
            data.product === "studio" ? matchBatchStudio(users, taskRegions) : matchBatchAmplify(users, data);

        matchingCreators = matchingCreators.concat(batch);
    }

    return matchingCreators;
};
