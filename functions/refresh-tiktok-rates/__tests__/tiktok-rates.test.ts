import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSuggestedRateTikTok } from "../lib/tiktok-rates";
import type { UserRecord } from "../lib/types";

interface StubbedReply {
    body: unknown;
    ok?: boolean;
}

const stubFetch = (route: (url: string) => StubbedReply) => {
    const fetchStub = vi.fn(async (url: string, _init?: RequestInit) => {
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

const connectedUser: UserRecord = { creator_socials: { tiktok: { access_token: "token" } } };

const videoWith = (viewCount: number, shareUrl = "https://tiktok.com/@creator/video/1") => ({
    view_count: viewCount,
    like_count: 10,
    share_count: 2,
    comment_count: 4,
    share_url: shareUrl,
});

const tiktokRoute =
    (videos: unknown[], followerCount = 321) =>
    (url: string): StubbedReply => ({
        body: url.includes("user/info")
            ? { data: { user: { follower_count: followerCount } }, error: { code: "ok" } }
            : { data: { videos }, error: { code: "ok" } },
    });

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
});

describe("getSuggestedRateTikTok success", () => {
    it("writes a zero rate and the follower count for a creator with no history", async () => {
        stubFetch(tiktokRoute([]));
        const { app, ref, update } = makeFirebase();

        const result = await getSuggestedRateTikTok(app, "creator", connectedUser);

        expect(result).toBe("processed");
        expect(ref).toHaveBeenCalledWith("users/creator/creator_socials/tiktok");
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({
            performance: {
                median_likes: 0,
                median_shares: 0,
                followerCount: 321,
                median_views: 0,
                median_comments: 0,
                suggestedRate: 0,
                updated: expect.any(String),
            },
            updated: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
            last_error: null,
        });
    });

    it("replaces the performance node with exactly the seven fields and records the handle", async () => {
        stubFetch(tiktokRoute([videoWith(1000), videoWith(3000)]));
        const { app, update } = makeFirebase();

        await getSuggestedRateTikTok(app, "creator", connectedUser);

        const written = update.mock.calls[0][0];
        expect(Object.keys(written.performance).sort()).toEqual(
            [
                "followerCount",
                "median_comments",
                "median_likes",
                "median_shares",
                "median_views",
                "suggestedRate",
                "updated",
            ].sort(),
        );
        expect(written.performance).toMatchObject({
            median_likes: 10,
            median_shares: 2,
            median_views: 2000,
            median_comments: 4,
            followerCount: 321,
            suggestedRate: 5000,
        });
        expect(written.performance.updated).toBe(written.updated);
        expect(written.handle).toBe("creator");
        expect(written.last_error).toBeNull();
    });

    it("leaves the handle out when the first video carries no share url", async () => {
        stubFetch(tiktokRoute([{ ...videoWith(1000), share_url: undefined }]));
        const { app, update } = makeFirebase();

        await getSuggestedRateTikTok(app, "creator", connectedUser);

        expect(update.mock.calls[0][0]).not.toHaveProperty("handle");
    });

    it("calls the exact user-info and video-list endpoints with the creator's token", async () => {
        const fetchStub = stubFetch(tiktokRoute([videoWith(1000)]));
        const { app } = makeFirebase();

        await getSuggestedRateTikTok(app, "creator", connectedUser);

        const headers = { Authorization: "Bearer token", "Content-Type": "application/json" };
        expect(fetchStub.mock.calls).toEqual([
            ["https://open.tiktokapis.com/v2/user/info/?fields=follower_count", { method: "GET", headers }],
            [
                "https://open.tiktokapis.com/v2/video/list/?fields=like_count,share_count,view_count,comment_count,share_url",
                { method: "POST", headers, body: JSON.stringify({ max_count: 20 }) },
            ],
        ]);
    });
});

describe("getSuggestedRateTikTok vendor errors", () => {
    const cases = [2190002, 2190003, 2190008, 10010].flatMap((code) =>
        ["user/info", "video/list"].map((endpoint) => [code, endpoint] as const),
    );

    it.each(cases)("code %i from %s writes only last_error and counts as failed", async (code, endpoint) => {
        stubFetch((url) => ({
            body: url.includes(endpoint) ? { error: { code } } : { data: { user: { follower_count: 10 } } },
        }));
        const { app, update } = makeFirebase();

        const result = await getSuggestedRateTikTok(app, "creator", connectedUser);

        expect(result).toBe("failed");
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({
            last_error: { code, message_key: `tt_${code}`, at: expect.any(String) },
        });
    });

    it("maps an invalid_grant code to tt_invalid_grant", async () => {
        stubFetch(() => ({ body: { error: { code: "invalid_grant" } }, ok: false }));
        const { app, update } = makeFirebase();

        await getSuggestedRateTikTok(app, "creator", connectedUser);

        expect(update).toHaveBeenCalledWith({
            last_error: { code: "invalid_grant", message_key: "tt_invalid_grant", at: expect.any(String) },
        });
    });

    it.each([
        ["an unrecognised error code", { body: { error: { code: 12345 } } }],
        ["a non-2xx response without a code", { body: {}, ok: false }],
    ])("fails without writing on %s", async (_label, reply) => {
        stubFetch(() => reply);
        const { app, update } = makeFirebase();

        expect(await getSuggestedRateTikTok(app, "creator", connectedUser)).toBe("failed");
        expect(update).not.toHaveBeenCalled();
    });

    it("fails without writing when the user or the video list is missing", async () => {
        const { app, update } = makeFirebase();

        stubFetch(() => ({ body: { data: {}, error: { code: "ok" } } }));
        expect(await getSuggestedRateTikTok(app, "creator", connectedUser)).toBe("failed");

        stubFetch((url) => ({
            body: url.includes("user/info")
                ? { data: { user: { follower_count: 1 } }, error: { code: "ok" } }
                : { data: {}, error: { code: "ok" } },
        }));
        expect(await getSuggestedRateTikTok(app, "creator", connectedUser)).toBe("failed");

        expect(update).not.toHaveBeenCalled();
    });

    it("counts a network failure as failed instead of throwing", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
        const { app, update } = makeFirebase();

        expect(await getSuggestedRateTikTok(app, "creator", connectedUser)).toBe("failed");
        expect(update).not.toHaveBeenCalled();
    });
});

describe("getSuggestedRateTikTok skips", () => {
    it.each([
        ["a negotiated creator", { negotiated: true, ...connectedUser }],
        ["no TikTok node", {}],
        ["no token", { creator_socials: { tiktok: {} } }],
        ["the literal token null", { creator_socials: { tiktok: { access_token: "null" } } }],
        ["a missing user", undefined],
    ] as [string, UserRecord | undefined][])("skips %s without calling TikTok", async (_label, user) => {
        const fetchStub = stubFetch(tiktokRoute([]));
        const { app, update } = makeFirebase();

        expect(await getSuggestedRateTikTok(app, "creator", user)).toBe("skipped");
        expect(fetchStub).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });
});
