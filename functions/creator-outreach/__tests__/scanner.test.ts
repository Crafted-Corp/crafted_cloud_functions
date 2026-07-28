import { matchBatchAmplify, matchBatchStudio, parseFollowerCount, regionMatches } from "../lib/scanner";
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

    it('matches a US-country creator and excludes a CAN-country creator when states is ["USA"]', () => {
        const users = {
            us: {
                email: "us@x.com",
                shipping_details: { country: "USA" },
                creator_socials: { tiktok: { performance: { followerCount: 5000 } } },
            },
            ca: {
                email: "ca@x.com",
                shipping_details: { country: "CAN" },
                creator_socials: { tiktok: { performance: { followerCount: 5000 } } },
            },
        };

        const matched = matchBatchAmplify(users, amplifyData({ states: ["USA"] }));

        expect(matched.map((m) => m.id)).toEqual(["us"]);
    });

    it('matches Canadian-country creators (case-insensitive) and excludes a US creator when states is ["CAN"]', () => {
        const users = {
            canUpper: {
                email: "canupper@x.com",
                shipping_details: { country: "CAN" },
                creator_socials: { tiktok: { performance: { followerCount: 5000 } } },
            },
            canLower: {
                email: "canlower@x.com",
                shipping_details: { country: "can" },
                creator_socials: { tiktok: { performance: { followerCount: 5000 } } },
            },
            us: {
                email: "us@x.com",
                shipping_details: { country: "USA" },
                creator_socials: { tiktok: { performance: { followerCount: 5000 } } },
            },
        };

        const matched = matchBatchAmplify(users, amplifyData({ states: ["CAN"] }));

        expect(matched.map((m) => m.id).sort()).toEqual(["canLower", "canUpper"]);
    });

    it('matches on shipping_details.state for a specific region like ["NY"]', () => {
        const users = {
            ny: {
                email: "ny@x.com",
                shipping_details: { state: "NY" },
                creator_socials: { tiktok: { performance: { followerCount: 5000 } } },
            },
            ca: {
                email: "ca@x.com",
                shipping_details: { state: "CA" },
                creator_socials: { tiktok: { performance: { followerCount: 5000 } } },
            },
        };

        const matched = matchBatchAmplify(users, amplifyData({ states: ["NY"] }));

        expect(matched.map((m) => m.id)).toEqual(["ny"]);
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

describe("regionMatches", () => {
    it("matches USA/CAN by country and other regions by state, case-insensitively", () => {
        expect(regionMatches({ country: "usa" }, ["USA"])).toBe(true);
        expect(regionMatches({ country: "can" }, ["CAN"])).toBe(true);
        expect(regionMatches({ state: "ny" }, ["NY"])).toBe(true);
        expect(regionMatches({ country: "USA" }, ["CAN"])).toBe(false);
        expect(regionMatches({ state: "NY" }, ["CA"])).toBe(false);
    });

    it("returns a real boolean (not the falsy operand of the && chain)", () => {
        expect(regionMatches(undefined, ["USA"])).toBe(false);
        expect(regionMatches({}, ["NY"])).toBe(false);
    });

    it("does not throw when shipping fields are non-string falsy values (untyped Firebase data)", () => {
        const shipping = { state: 0, country: 0 } as unknown as Parameters<typeof regionMatches>[0];

        expect(() => regionMatches(shipping, ["NY", "USA"])).not.toThrow();
        expect(regionMatches(shipping, ["NY", "USA"])).toBe(false);
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
