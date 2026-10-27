import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateSuggestedRate, processUserInstagramRate } from "../lib/instagram-rates";
import type { InstagramSocialNode, UserRecord } from "../lib/types";

interface StubbedReply {
    body: unknown;
    ok?: boolean;
}

const stubFetch = (route: (url: string) => StubbedReply) => {
    const fetchStub = vi.fn(async (url: string) => {
        const { body, ok = true } = route(url);
        return { ok, status: ok ? 200 : 400, json: async () => body };
    });
    vi.stubGlobal("fetch", fetchStub);
    return fetchStub;
};

const makeFirebase = () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const ref = vi.fn(() => ({ update }));
    return { app: { database: () => ({ ref }) } as never, ref, update };
};

const userWith = (instagram: InstagramSocialNode, extra: Partial<UserRecord> = {}): UserRecord => ({
    creator_socials: { instagram },
    ...extra,
});

const facebookUser = userWith({ access_token: "token", instagram_business_account_id: "account" });
const oneReelWith = (views: number) => (url: string) => ({
    body: url.includes("/media?")
        ? { data: [{ id: "post", media_type: "VIDEO" }] }
        : { data: [{ values: [{ value: views }] }] },
});
const failingEndpoint = (endpoint: string, code: number) => (url: string) =>
    url.includes(endpoint)
        ? { body: { error: { code, error_subcode: 463 } }, ok: false }
        : { body: { data: [{ id: "post", media_type: "VIDEO" }] } };

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
});

describe("processUserInstagramRate success", () => {
    it("writes suggested_rate, median_plays, updated and last_error in one update", async () => {
        stubFetch(oneReelWith(2000));
        const { app, ref, update } = makeFirebase();

        const result = await processUserInstagramRate(app, "creator", facebookUser);

        expect(result).toEqual({ outcome: "processed", suggestedRate: 5000 });
        expect(ref).toHaveBeenCalledWith("users/creator/creator_socials/instagram");
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({
            suggested_rate: 5000,
            median_plays: 2000,
            updated: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
            last_error: null,
        });
    });

    it("writes zero rate and zero plays for a creator with no reels", async () => {
        stubFetch(() => ({ body: { data: [] } }));
        const { app, update } = makeFirebase();

        await processUserInstagramRate(app, "creator", facebookUser);

        expect(update).toHaveBeenCalledWith(expect.objectContaining({ suggested_rate: 0, median_plays: 0 }));
    });
});

describe("processUserInstagramRate token and rate-limit errors", () => {
    const cases = ["/media?", "/insights?"].flatMap((endpoint) =>
        [190, 102, 10, 200, 4, 17, 32].map((code) => [endpoint, code] as const),
    );

    it.each(cases)("%s with Meta code %i", async (endpoint, code) => {
        stubFetch(failingEndpoint(endpoint, code));
        const { app, update } = makeFirebase();

        const result = await processUserInstagramRate(app, "creator", facebookUser);

        if ([4, 17, 32].includes(code)) {
            expect(result).toEqual({ outcome: "skipped", reason: "rate_limited" });
            expect(update).not.toHaveBeenCalled();
            return;
        }
        const messageKey = code === 190 ? "ig_190_463" : `ig_${code}`;
        expect(result).toEqual({ outcome: "skipped", reason: "token_error" });
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({
            last_error: { code, subcode: 463, message_key: messageKey, at: expect.any(String) },
        });
    });

    it("propagates an unrecognised Meta error from /media without writing", async () => {
        stubFetch(failingEndpoint("/media?", 1));
        const { app, update } = makeFirebase();

        await expect(processUserInstagramRate(app, "creator", facebookUser)).rejects.toThrow(
            "Failed fetching Instagram media (400)",
        );
        expect(update).not.toHaveBeenCalled();
    });

    it("skips a media item whose insights fail with an unrecognised error and rates the rest", async () => {
        stubFetch((url) => {
            if (url.includes("/media?")) {
                return {
                    body: {
                        data: [
                            { id: "bad", media_type: "VIDEO" },
                            { id: "good", media_type: "VIDEO" },
                        ],
                    },
                };
            }
            return url.includes("/bad/")
                ? { body: { error: { code: 1 } }, ok: false }
                : { body: { data: [{ values: [{ value: 4000 }] }] } };
        });
        const { app, update } = makeFirebase();

        await processUserInstagramRate(app, "creator", facebookUser);

        expect(update).toHaveBeenCalledWith(expect.objectContaining({ suggested_rate: 10000, median_plays: 4000 }));
    });
});

describe("processUserInstagramRate skips", () => {
    it("skips a negotiated creator without calling Meta", async () => {
        const fetchStub = stubFetch(oneReelWith(2000));
        const { app, update } = makeFirebase();

        const result = await processUserInstagramRate(app, "creator", { ...facebookUser, negotiated: true });

        expect(result).toEqual({ outcome: "skipped", reason: "negotiated" });
        expect(fetchStub).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it.each([
        ["no node", undefined],
        ["no token", userWith({ instagram_business_account_id: "account" })],
        ["no facebook-path account id", userWith({ access_token: "token", instagram_user_id: "ig-account" })],
        [
            "no instagram-path account id",
            userWith({ access_token: "token", api_path: "instagram", instagram_business_account_id: "account" }),
        ],
    ])("skips a creator with %s", async (_label, user) => {
        const fetchStub = stubFetch(oneReelWith(2000));
        const { app, update } = makeFirebase();

        const result = await processUserInstagramRate(app, "creator", user);

        expect(result).toEqual({ outcome: "skipped", reason: "missing_instagram_info" });
        expect(fetchStub).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });
});

describe("Graph host and account id routing", () => {
    it.each([
        [undefined, "graph.facebook.com", "fb-account"],
        ["facebook", "graph.facebook.com", "fb-account"],
        ["instagram", "graph.instagram.com", "ig-account"],
    ] as const)("api_path %s uses %s and account %s", async (apiPath, host, accountId) => {
        const fetchStub = stubFetch(oneReelWith(2000));
        const { app, update } = makeFirebase();
        const user = userWith({
            access_token: "synthetic",
            instagram_business_account_id: "fb-account",
            instagram_user_id: "ig-account",
            ...(apiPath ? { api_path: apiPath } : {}),
        });

        await processUserInstagramRate(app, "creator", user);

        const urls = fetchStub.mock.calls.map(([url]) => new URL(url));
        expect(urls).toHaveLength(2);
        expect(urls.every((url) => url.host === host)).toBe(true);
        expect(urls[0].pathname).toBe(`/v24.0/${accountId}/media`);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ suggested_rate: 5000 }));
    });
});

describe("calculateSuggestedRate", () => {
    it("requests the exact media and insights endpoints", async () => {
        const fetchStub = stubFetch(oneReelWith(2000));

        await calculateSuggestedRate("synthetic", "fb-account", {});

        expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([
            "https://graph.facebook.com/v24.0/fb-account/media?fields=media_type&access_token=synthetic&limit=300",
            "https://graph.facebook.com/v24.0/post/insights?access_token=synthetic&metric=views",
        ]);
    });

    it("rates only the first 25 videos, five insight calls at a time", async () => {
        let active = 0;
        let peak = 0;
        const media = Array.from({ length: 40 }, (_, n) => ({
            id: `m${n}`,
            media_type: n % 4 === 3 ? "IMAGE" : "VIDEO",
        }));
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => {
                if (url.includes("/media?")) return { ok: true, status: 200, json: async () => ({ data: media }) };
                active += 1;
                peak = Math.max(peak, active);
                await new Promise<void>((done) => setTimeout(done, 1));
                active -= 1;
                return { ok: true, status: 200, json: async () => ({ data: [{ values: [{ value: 1000 }] }] }) };
            }),
        );

        const result = await calculateSuggestedRate("synthetic", "account", {});

        const insightCalls = (vi.mocked(fetch).mock.calls as [string][]).filter(([url]) => url.includes("/insights?"));
        expect(insightCalls).toHaveLength(25);
        expect(peak).toBeLessThanOrEqual(5);
        expect(result).toEqual({ suggestedRate: 2500, medianPlays: 1000 });
    });
});
