import { describe, expect, it, vi } from "vitest";
import { collectComments, syncCampaign } from "../lib/comments";

const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const comment = (id: string): { id: string; text: string } => ({ id, text: `Comment ${id}` });
const post = { platform: "instagram", media_id: "media", creator_id: "creator" };
const campaign = { tasks: { task: { posts: { post } } } };
const fakeApp = () => {
    const set = vi.fn(async (): Promise<void> => undefined);
    const ref = vi.fn(() => ({
        once: async () => ({ val: () => ({ api_path: "instagram", instagram_user_id: "ig", access_token: "secret" }) }),
        set,
        child: () => ({ set }),
    }));
    return { app: { database: () => ({ ref }) }, ref, set };
};
describe("complete comments collection", () => {
    it.each([
        "instagram",
        "facebook",
        undefined,
    ])("routes %s tokens and preserves all pages and extra fields", async (path) => {
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                response({
                    data: [{ ...comment("a"), like_count: 2 }],
                    paging: { next: "https://attacker.test/?token=evil", cursors: { after: "cursor" } },
                }),
            )
            .mockResolvedValueOnce(response({ data: [comment("b")] }));
        const result = await collectComments("media", "secret", path, request);
        expect(result).toEqual([{ ...comment("a"), like_count: 2 }, comment("b")]);
        const url = String(request.mock.calls[1][0]);
        expect(url).toContain(path === "instagram" ? "graph.instagram.com" : "graph.facebook.com");
        expect(url).toContain("after=cursor");
        expect(url).not.toContain("secret");
        expect(url).not.toContain("attacker");
    });
    it("deduplicates IDs retaining stable order", async () => {
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                response({ data: [comment("a")], paging: { next: "next", cursors: { after: "one" } } }),
            )
            .mockResolvedValueOnce(response({ data: [comment("a"), comment("b")] }));
        expect((await collectComments("media", "secret", undefined, request)).map((c) => c.id)).toEqual(["a", "b"]);
    });
    it.each([
        { data: [comment("a")], paging: { next: "next" } },
        { data: [{}] },
        { data: null },
    ])("rejects incomplete or malformed pages", async (body) => {
        await expect(
            collectComments("media", "secret", undefined, vi.fn<typeof fetch>().mockResolvedValue(response(body))),
        ).rejects.toThrow();
    });
    it("rejects repeated cursors", async () => {
        const request = vi
            .fn<typeof fetch>()
            .mockImplementation(async () =>
                response({ data: [comment("a")], paging: { next: "next", cursors: { after: "same" } } }),
            );
        await expect(collectComments("media", "secret", undefined, request)).rejects.toThrow("pagination");
        expect(request).toHaveBeenCalledTimes(2);
    });
});
describe("failure preserving storage", () => {
    it("replaces only the per-post array after every page succeeds", async () => {
        const { app, ref, set } = fakeApp();
        const result = await syncCampaign(
            app as never,
            "campaign",
            campaign,
            vi.fn<typeof fetch>().mockResolvedValue(response({ data: [comment("a")] })),
        );
        expect(result.postsProcessed).toBe(1);
        expect(set).toHaveBeenCalledWith([comment("a")]);
        expect(ref).toHaveBeenCalledWith("influencer_campaigns/campaign/instagram_comments/post");
    });
    it("does not replace stored comments after page two fails", async () => {
        const { app, set } = fakeApp();
        const request = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                response({ data: [comment("a")], paging: { next: "next", cursors: { after: "cursor" } } }),
            )
            .mockResolvedValueOnce(response({ error: { code: 2, message: "secret" } }, 500));
        const result = await syncCampaign(app as never, "campaign", campaign, request);
        expect(result.failed).toBe(1);
        expect(set).not.toHaveBeenCalled();
    });
    it("records token190 without overwriting the comments", async () => {
        const { app, ref, set } = fakeApp();
        const result = await syncCampaign(
            app as never,
            "campaign",
            campaign,
            vi.fn<typeof fetch>().mockResolvedValue(response({ error: { code: 190, error_subcode: 463 } }, 400)),
        );
        expect(result.failed).toBe(1);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ code: 190, message_key: "ig_190_463" }));
        expect(ref).not.toHaveBeenCalledWith("influencer_campaigns/campaign/instagram_comments/post");
    });
    it("preserves data on transport errors", async () => {
        const { app, set } = fakeApp();
        const result = await syncCampaign(
            app as never,
            "campaign",
            campaign,
            vi.fn<typeof fetch>().mockRejectedValue(new Error("secret")),
        );
        expect(result.failed).toBe(1);
        expect(set).not.toHaveBeenCalled();
    });
    it("skips explicit TikTok even with a media ID", async () => {
        const { app, ref } = fakeApp();
        const result = await syncCampaign(app as never, "campaign", {
            tasks: { task: { posts: { post: { ...post, platform: "tiktok" } } } },
        });
        expect(result.skipped).toBe(1);
        expect(ref).not.toHaveBeenCalled();
    });
    it("allows empty successful results", async () => {
        const { app, set } = fakeApp();
        await syncCampaign(
            app as never,
            "campaign",
            campaign,
            vi.fn<typeof fetch>().mockResolvedValue(response({ data: [] })),
        );
        expect(set).toHaveBeenCalledWith([]);
    });
});
