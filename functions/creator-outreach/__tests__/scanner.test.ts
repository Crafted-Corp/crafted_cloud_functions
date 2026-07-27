import { matchBatchAmplify, matchBatchStudio, parseFollowerCount } from "../lib/scanner";
import type { AmplifyOutreachRequest } from "../lib/schemas";

const amplifyData = (overrides: Partial<AmplifyOutreachRequest> = {}): AmplifyOutreachRequest =>
    ({
        product: "amplify",
        brand_id: "brand-1",
        message: "",
        campaign_id: "camp-1",
        campaign_name: "Camp",
        follower_count: [1000, 100000],
        platforms: ["tiktok", "instagram"],
        states: ["CA"],
        ...overrides,
    }) as AmplifyOutreachRequest;

describe("matchBatchStudio", () => {
    it("matches a user whose uppercased shipping state is in the task regions", () => {
        const users = {
            u1: { creator_tasks: { t1: true }, email: "u1@x.com", shipping_details: { state: "ca" } },
        };

        const matched = matchBatchStudio(users, ["CA"]);

        expect(matched).toHaveLength(1);
        expect(matched[0]).toMatchObject({ id: "u1", email: "u1@x.com" });
    });

    it("matches a user by country when regions include USA or CAN", () => {
        const users = {
            usa: { creator_tasks: { t1: true }, email: "usa@x.com", shipping_details: { country: "usa" } },
            can: { creator_tasks: { t1: true }, email: "can@x.com", shipping_details: { country: "can" } },
        };

        const matched = matchBatchStudio(users, ["USA", "CAN"]);

        expect(matched.map((m) => m.id).sort()).toEqual(["can", "usa"]);
    });

    it("skips users without creator_tasks even when the region matches", () => {
        const users = {
            u1: { email: "u1@x.com", shipping_details: { state: "CA" } },
        };

        const matched = matchBatchStudio(users, ["CA"]);

        expect(matched).toHaveLength(0);
    });

    it("falls back to paypail_email when email is absent", () => {
        const users = {
            u1: { creator_tasks: { t1: true }, paypail_email: "payout@x.com", shipping_details: { state: "CA" } },
        };

        const matched = matchBatchStudio(users, ["CA"]);

        expect(matched[0].email).toBe("payout@x.com");
    });
});

describe("matchBatchAmplify", () => {
    it("matches on combined follower count within range, platform present, and state", () => {
        const users = {
            u1: {
                email: "u1@x.com",
                shipping_details: { state: "CA" },
                creator_socials: {
                    tiktok: { performance: { followerCount: 8000 } },
                    instagram: { follower_count: 4000 },
                },
            },
        };

        const matched = matchBatchAmplify(users, amplifyData({ follower_count: [1000, 100000], states: ["CA"] }));

        expect(matched).toHaveLength(1);
        expect(matched[0].id).toBe("u1");
    });

    it('treats states === ["USA"] as matching every user regardless of their state', () => {
        const users = {
            anywhere: {
                email: "a@x.com",
                shipping_details: { state: "TX" },
                creator_socials: { tiktok: { performance: { followerCount: 5000 } } },
            },
        };

        const matched = matchBatchAmplify(users, amplifyData({ states: ["USA"] }));

        expect(matched).toHaveLength(1);
    });

    it("skips a user with neither instagram nor tiktok follower count", () => {
        const users = {
            u1: {
                email: "u1@x.com",
                shipping_details: { state: "CA" },
                creator_socials: { tiktok: { performance: {} } },
            },
        };

        const matched = matchBatchAmplify(users, amplifyData());

        expect(matched).toHaveLength(0);
    });

    it("sums tiktok and instagram follower counts for the range check", () => {
        const users = {
            below: {
                email: "below@x.com",
                shipping_details: { state: "CA" },
                creator_socials: {
                    tiktok: { performance: { followerCount: 400 } },
                    instagram: { follower_count: 400 },
                },
            },
            within: {
                email: "within@x.com",
                shipping_details: { state: "CA" },
                creator_socials: {
                    tiktok: { performance: { followerCount: 400 } },
                    instagram: { follower_count: 700 },
                },
            },
        };

        const matched = matchBatchAmplify(users, amplifyData({ follower_count: [1000, 100000], states: ["CA"] }));

        expect(matched.map((m) => m.id)).toEqual(["within"]);
    });
});

describe("parseFollowerCount", () => {
    it("parses a comma-formatted string into a number", () => {
        expect(parseFollowerCount("12,345")).toBe(12345);
    });

    it("passes a number through unchanged", () => {
        expect(parseFollowerCount(6789)).toBe(6789);
    });

    it("returns undefined for an undefined input", () => {
        expect(parseFollowerCount(undefined)).toBeUndefined();
    });
});
