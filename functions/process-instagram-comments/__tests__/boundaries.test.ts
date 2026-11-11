import { afterEach, describe, expect, it, vi } from "vitest";
import { syncAll, syncCampaign } from "../lib/comments";
import { resolveEnvironment, verifyCredentialProject } from "../lib/environment";

const h = vi.hoisted(() => ({ database: vi.fn(), capture: vi.fn(), flush: vi.fn() }));
vi.mock("../lib/firebase", () => ({ default: { database: h.database } }));
vi.mock("../lib/sentry", () => ({ default: { captureException: h.capture, flush: h.flush } }));

import { processInstagramComments } from "../function-handler";

const invoke = (method: string, query: Record<string, unknown> = {}): Promise<{ status: number; body: unknown }> =>
    new Promise((resolve) => {
        let status = 200;
        const res = {
            setHeader: vi.fn(),
            getHeader: vi.fn(),
            status: (code: number) => {
                status = code;
                return res;
            },
            json: (body: unknown) => {
                resolve({ status, body });
                return res;
            },
        };
        processInstagramComments({ method, query, headers: {} } as never, res as never);
    });
afterEach(() => vi.clearAllMocks());
describe("environment isolation", () => {
    it.each([undefined, "production", ""])("rejects environment %s", (env) =>
        expect(() => resolveEnvironment(env)).toThrow());
    it.each(["dev", "staging", "prod"])("pins credential project for %s", (env) => {
        const config = resolveEnvironment(env);
        expect(() => verifyCredentialProject(config, { project_id: config.projectId })).not.toThrow();
        expect(() => verifyCredentialProject(config, { project_id: "wrong" })).toThrow();
    });
});
describe("HTTP boundary", () => {
    it("returns exact405 without DB access", async () => {
        expect((await invoke("GET")).status).toBe(405);
        expect(h.database).not.toHaveBeenCalled();
    });
    it.each(["", "a/b", ["a", "b"], { bad: "query" }])("rejects invalid campaign ID", async (id) => {
        expect((await invoke("POST", { campaign_id: id })).status).toBe(400);
        expect(h.database).not.toHaveBeenCalled();
    });
    it("reads only the selected campaign and returns404 when absent", async () => {
        const ref = vi.fn(() => ({ once: async () => ({ val: () => null }) }));
        h.database.mockReturnValue({ ref });
        expect((await invoke("POST", { campaign_id: "campaign" })).status).toBe(404);
        expect(ref).toHaveBeenCalledExactlyOnceWith("influencer_campaigns/campaign");
    });
    it("captures only a sanitized storage error", async () => {
        h.database.mockImplementation(() => {
            throw new Error("synthetic-secret");
        });
        expect((await invoke("POST", { campaign_id: "campaign" })).status).toBe(500);
        expect(String(h.capture.mock.calls[0][0])).not.toContain("synthetic-secret");
    });
});
it("paginates campaign keys100 at a time", async () => {
    const limits: number[] = [];
    const cursors: string[] = [];
    const campaigns = Object.fromEntries(Array.from({ length: 101 }, (_, n) => [`c${String(n).padStart(3, "0")}`, {}]));
    const query = (after = "", limit = 100) => ({
        orderByKey: () => query(after, limit),
        limitToFirst: (n: number) => {
            limits.push(n);
            return query(after, n);
        },
        startAfter: (key: string) => {
            cursors.push(key);
            return query(key, limit);
        },
        once: async () => ({
            val: () =>
                Object.fromEntries(
                    Object.entries(campaigns)
                        .filter(([key]) => key > after)
                        .slice(0, limit),
                ),
        }),
    });
    const result = await syncAll({ database: () => ({ ref: () => query() }) } as never);
    expect(result.campaigns).toBe(101);
    expect(limits).toEqual([100, 100]);
    expect(cursors).toEqual(["c099"]);
});
it("continues to a healthy post after a failed fetch", async () => {
    const set = vi.fn();
    const ref = () => ({
        once: async () => ({ val: () => ({ access_token: "secret", instagram_business_account_id: "account" }) }),
        set,
    });
    const request = vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new Error("synthetic-secret"))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "comment", text: "Hello" }] })));
    const result = await syncCampaign(
        { database: () => ({ ref }) } as never,
        "campaign",
        {
            tasks: {
                task: {
                    posts: {
                        first: { platform: "instagram", media_id: "a", creator_id: "creator" },
                        second: { media_id: "b", creator_id: "creator", link: "https://www.instagram.com/reel/abc/" },
                    },
                },
            },
        },
        request,
    );
    expect(result.failed).toBe(1);
    expect(result.postsProcessed).toBe(1);
    expect(set).toHaveBeenCalledTimes(1);
});
