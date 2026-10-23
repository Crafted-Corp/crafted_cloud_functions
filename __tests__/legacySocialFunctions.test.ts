import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RecordValue = { [key: string]: Json };
interface ResponseValue {
    ok: boolean;
    status: number;
    json(): Promise<RecordValue>;
}
interface RequestValue {
    query: { user_id?: string; campaign_id?: string };
}
interface ReplyValue {
    status(code: number): ReplyValue;
    json(value: RecordValue): void;
    send(value: string): void;
}
type Handler = (request: RequestValue, response: ReplyValue) => void | Promise<void>;
interface FunctionExports {
    [key: string]: Handler;
}
interface WriteValue {
    path: string;
    value: RecordValue;
}
interface SnapshotValue {
    val(): Json;
    key: string;
    forEach(callback: (snapshot: SnapshotValue) => void): void;
}
interface NodeValue {
    child(key: string): NodeValue;
    orderByKey(): NodeValue;
    limitToFirst(size: number): NodeValue;
    startAfter(key: string): NodeValue;
    once(event: string): Promise<SnapshotValue>;
    orderByChild(key: string): NodeValue;
    limitToLast(size: number): NodeValue;
    push(): NodeValue;
    set(value: Json): Promise<void>;
    update(value: RecordValue): Promise<void>;
}
interface Fixture {
    users: RecordValue;
    campaigns: RecordValue;
    reads: string[];
    requests: string[];
    writes: WriteValue[];
    sets: { path: string; value: Json }[];
    pages: number[];
    fetch(url: string): Promise<ResponseValue>;
    invoke(
        folder: string,
        target: string,
        uid?: string,
        env?: Record<string, string>,
    ): Promise<{ status: number; body: RecordValue }>;
}
const socialUser = (platform: string, social: RecordValue): RecordValue => ({
    creator_socials: { [platform]: social },
});
const response = (value: RecordValue, ok = true): ResponseValue => ({
    ok,
    status: ok ? 200 : 400,
    json: async (): Promise<RecordValue> => value,
});

const recordValue = (value: Json | undefined): RecordValue => {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
    return value;
};

function fixture(users: RecordValue, fetchResponse: (url: string) => Promise<ResponseValue>): Fixture {
    const writes: WriteValue[] = [];
    const pages: number[] = [];
    const fixtureValue: Fixture = {
        users,
        campaigns: {},
        reads: [],
        requests: [],
        writes,
        sets: [],
        pages,
        fetch: fetchResponse,
        async invoke(
            folder,
            target,
            uid,
            env = { TIKTOK_CLIENT_KEY: "test-key", TIKTOK_CLIENT_SECRET: "test-secret" },
        ) {
            let pushIndex = 0;
            const lookup = (path: string): Json => {
                const [root, ...parts] = path.split("/");
                let value: Json =
                    root === "users" ? users : root === "influencer_campaigns" ? fixtureValue.campaigns : {};
                for (const part of parts) {
                    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
                    value = value[part] ?? null;
                }
                return value;
            };
            const snapshot = (value: Json, key = ""): SnapshotValue => ({
                val: (): Json => value,
                key,
                forEach(callback): void {
                    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
                        for (const [childKey, child] of Object.entries(value)) callback(snapshot(child, childKey));
                    }
                },
            });
            const node = (path: string, after = "", limit = 100): NodeValue => ({
                child: (key): NodeValue => node(`${path}/${key}`),
                orderByKey: (): NodeValue => node(path, after, limit),
                orderByChild: (): NodeValue => node(path, after, limit),
                limitToLast: (size): NodeValue => node(path, after, size),
                push: (): NodeValue => node(`${path}/-synthetic-${pushIndex++}`),
                set: async (value): Promise<void> => {
                    fixtureValue.sets.push({ path, value: structuredClone(value) });
                },
                limitToFirst: (size): NodeValue => {
                    pages.push(size);
                    return node(path, after, size);
                },
                startAfter: (key): NodeValue => node(path, key, limit),
                once: async (): Promise<SnapshotValue> => {
                    fixtureValue.reads.push(path);
                    const value = lookup(path);
                    if (path === "users" || path === "influencer_campaigns") {
                        return snapshot(
                            Object.fromEntries(
                                Object.entries(recordValue(value))
                                    .sort(([a], [b]) => a.localeCompare(b))
                                    .filter(([key]) => key > after)
                                    .slice(0, limit),
                            ),
                        );
                    }
                    return snapshot(value);
                },
                update: async (value): Promise<void> => {
                    await new Promise<void>((done) => setTimeout(done, 1));
                    writes.push({ path, value: structuredClone(value) });
                },
            });
            const file = resolve(
                "functions",
                folder,
                folder === "refreshTokens" || folder === "refreshTikTokRates"
                    ? "influencer.js"
                    : folder === "refreshAllCampaignAnalytics"
                      ? "campaign.js"
                      : "instagram.js",
            );
            const localRequire = (name: string): unknown => {
                if (name === "dotenv") return { config: (): void => {} };
                if (name === "cors")
                    return (): ((req: RequestValue, res: ReplyValue, callback: () => Promise<void>) => Promise<void>) =>
                        async (_req, _res, callback): Promise<void> =>
                            callback();
                if (name === "test-firebase")
                    return {
                        database: (): { ref(path: string): NodeValue } => ({ ref: (path): NodeValue => node(path) }),
                    };
                if (name === "moment")
                    return (): { format(): string } => ({ format: (): string => new Date().toISOString() });
                if (name === "axios")
                    return {
                        get: async (url: string): Promise<{ status: number; data: RecordValue }> => {
                            fixtureValue.requests.push(url);
                            const result = await fixtureValue.fetch(url);
                            const data = await result.json();
                            if (!result.ok)
                                throw Object.assign(new Error("Synthetic Axios failure"), {
                                    response: { data, status: result.status },
                                });
                            return { status: result.status, data };
                        },
                    };
                if (["./socialErrors", "./graphHost", "./utils"].includes(name)) {
                    const helper = { exports: {} };
                    runInNewContext(readFileSync(resolve(dirname(file), `${name}.js`), "utf8"), {
                        module: helper,
                        Date,
                        require: localRequire,
                        process: { env: { PRODEV: "test-firebase", ...env } },
                        console: { log: (): void => {}, warn: (): void => {}, error: (): void => {} },
                    });
                    return helper.exports;
                }
                throw new Error(`Unexpected require ${name}`);
            };
            const moduleValue: { exports: FunctionExports } = { exports: {} };
            runInNewContext(readFileSync(file, "utf8"), {
                require: localRequire,
                module: moduleValue,
                process: { env: { PRODEV: "test-firebase", ...env } },
                fetch: async (url: string): Promise<ResponseValue> => {
                    fixtureValue.requests.push(url);
                    return fixtureValue.fetch(url);
                },
                console: { log: (): void => {}, warn: (): void => {}, error: (): void => {} },
                Date,
                URLSearchParams,
            });
            return new Promise<{ status: number; body: RecordValue }>((done, reject) => {
                let status = 200;
                const reply: ReplyValue = {
                    status(code): ReplyValue {
                        status = code;
                        return reply;
                    },
                    send(value): void {
                        done({ status, body: { message: value } });
                    },
                    json(body): void {
                        done({ status, body: structuredClone(body) });
                    },
                };
                Promise.resolve(
                    moduleValue.exports[target](
                        {
                            query: uid
                                ? folder === "processInstagramComments" || folder === "refreshAllCampaignAnalytics"
                                    ? { campaign_id: uid }
                                    : { user_id: uid }
                                : {},
                        },
                        reply,
                    ),
                ).catch(reject);
            });
        },
    };
    return fixtureValue;
}

void test("rotated tokens and expiries are one awaited update; errors preserve token fields", async (): Promise<void> => {
    const fx = fixture(
        { creator: socialUser("tiktok", { refresh_token: "old" }) },
        async (): Promise<ResponseValue> =>
            response({
                access_token: "new-access",
                refresh_token: "rotated",
                expires_in: 3600,
                refresh_expires_in: 7200,
            }),
    );
    assert.equal((await fx.invoke("refreshTokens", "refreshTiktokAccessTokens", "creator")).status, 200);
    assert.equal(fx.writes.length, 1);
    assert.equal(fx.writes[0].value.refresh_token, "rotated");
    assert.equal(fx.writes[0].value.last_error, null);
    assert.ok(Date.parse(String(fx.writes[0].value.access_token_expiry_date)) > Date.now());
    assert.ok(Date.parse(String(fx.writes[0].value.refresh_token_expiry_date)) > Date.now());
    for (const error of ["invalid_grant", 10010]) {
        fx.writes.length = 0;
        fx.fetch = async (): Promise<ResponseValue> =>
            response(typeof error === "string" ? { error } : { data: { error: { code: error } } }, false);
        await fx.invoke("refreshTokens", "refreshTiktokAccessTokens", "creator");
        assert.deepEqual(Object.keys(fx.writes[0].value), ["last_error"]);
        assert.equal(recordValue(fx.writes[0].value.last_error).message_key, `tt_${error}`);
    }
    fx.writes.length = 0;
    assert.equal((await fx.invoke("refreshTokens", "refreshTiktokAccessTokens", "creator", {})).status, 500);
    assert.equal(fx.writes.length, 0);
    assert.equal((await fx.invoke("refreshTokens", "refreshTiktokAccessTokens", "missing")).status, 404);
});

void test("newly connected TikTok creator gets zero for no history and original median formula with history", async (): Promise<void> => {
    const fx = fixture(
        { creator: socialUser("tiktok", { access_token: "token" }) },
        async (url): Promise<ResponseValue> =>
            response(
                url.includes("user/info")
                    ? { data: { user: { follower_count: 321 } }, error: { code: "ok" } }
                    : { data: { videos: [] }, error: { code: "ok" } },
            ),
    );
    assert.deepEqual((await fx.invoke("refreshTikTokRates", "refreshTiktokRatesForAllAccounts", "creator")).body, {
        processed: 1,
        skipped: 0,
        failed: 0,
    });
    assert.equal(recordValue(fx.writes[0].value.performance).suggestedRate, 0);
    assert.equal(recordValue(fx.writes[0].value.performance).followerCount, 321);
    assert.equal(fx.writes[0].value.last_error, null);
    assert.equal(typeof fx.writes[0].value.updated, "string");
    fx.fetch = async (url): Promise<ResponseValue> =>
        response(
            url.includes("user/info")
                ? { data: { user: { follower_count: 321 } } }
                : {
                      data: {
                          videos: [1000, 3000].map(
                              (view_count): RecordValue => ({
                                  view_count,
                                  like_count: 10,
                                  share_count: 2,
                                  comment_count: 4,
                                  share_url: "https://tiktok.com/@creator/video/1",
                              }),
                          ),
                      },
                  },
        );
    await fx.invoke("refreshTikTokRates", "refreshTiktokRatesForAllAccounts", "creator");
    assert.equal(recordValue(fx.writes[1].value.performance).suggestedRate, 5000);
    assert.equal(fx.writes[1].value.handle, "creator");
});

void test("TikTok errors in either response write only last_error and retain counts", async (): Promise<void> => {
    for (const error of [2190002, 2190003, 2190008, 10010]) {
        for (const failingEndpoint of ["user/info", "video/list"]) {
            const fx = fixture(
                { creator: socialUser("tiktok", { access_token: "token" }) },
                async (url): Promise<ResponseValue> =>
                    response(
                        url.includes(failingEndpoint)
                            ? { error: { code: error } }
                            : { data: { user: { follower_count: 10 } } },
                    ),
            );
            assert.equal(
                (await fx.invoke("refreshTikTokRates", "refreshTiktokRatesForAllAccounts", "creator")).body.failed,
                1,
            );
            assert.deepEqual(Object.keys(fx.writes[0].value), ["last_error"]);
            assert.equal(recordValue(fx.writes[0].value.last_error).message_key, `tt_${error}`);
        }
    }
});

void test("TikTok pages all users, skips negotiated/disconnected, isolates network failure and limits in-flight calls to five", async (): Promise<void> => {
    let active = 0;
    let peak = 0;
    let failedOnce = false;
    const users: RecordValue = Object.fromEntries(
        Array.from({ length: 103 }, (_, n): [string, Json] => [
            `u${String(n).padStart(3, "0")}`,
            socialUser("tiktok", { access_token: "token" }),
        ]),
    );
    users.z1 = { negotiated: true, ...socialUser("tiktok", { access_token: "token" }) };
    users.z2 = socialUser("tiktok", { access_token: "null" });
    const fx = fixture(users, async (url): Promise<ResponseValue> => {
        if (!failedOnce) {
            failedOnce = true;
            throw new Error("Synthetic per-user network failure");
        }
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((done) => setTimeout(done, 1));
        active--;
        return response(
            url.includes("user/info") ? { data: { user: { follower_count: 5 } } } : { data: { videos: [] } },
        );
    });
    const result = await fx.invoke("refreshTikTokRates", "refreshTiktokRatesForAllAccounts");
    assert.equal(result.body.processed, 102);
    assert.equal(result.body.skipped, 2);
    assert.equal(result.body.failed, 1);
    assert.equal(fx.writes.length, 102);
    assert.ok(peak <= 5);
    assert.equal(fx.pages.length, 2);
    assert.ok(fx.pages.every((size) => size === 100));
});

void test("Instagram maps media and insights token errors, leaves rate limits untouched, clears errors after success", async (): Promise<void> => {
    for (const endpoint of ["/media?", "/insights?"]) {
        for (const code of [190, 102, 10, 200, 4, 17, 32]) {
            const fx = fixture(
                {
                    creator: socialUser("instagram", {
                        access_token: "token",
                        instagram_business_account_id: "account",
                    }),
                },
                async (url): Promise<ResponseValue> =>
                    response(
                        url.includes(endpoint)
                            ? { error: { code, error_subcode: 463 } }
                            : { data: [{ id: "post", media_type: "VIDEO" }] },
                        !url.includes(endpoint),
                    ),
            );
            await fx.invoke("refreshInstagramRates", "refreshInstagramRates", "creator");
            if ([4, 17, 32].includes(code)) assert.equal(fx.writes.length, 0);
            else {
                assert.deepEqual(Object.keys(fx.writes[0].value), ["last_error"]);
                assert.equal(
                    recordValue(fx.writes[0].value.last_error).message_key,
                    code === 190 ? "ig_190_463" : `ig_${code}`,
                );
            }
        }
    }
    const fx = fixture(
        { creator: socialUser("instagram", { access_token: "token", instagram_business_account_id: "account" }) },
        async (url): Promise<ResponseValue> =>
            response(
                url.includes("/media?")
                    ? { data: [{ id: "post", media_type: "VIDEO" }] }
                    : { data: [{ values: [{ value: 2000 }] }] },
            ),
    );
    await fx.invoke("refreshInstagramRates", "refreshInstagramRates", "creator");
    assert.equal(fx.writes[0].value.suggested_rate, 5000);
    assert.equal(fx.writes[0].value.median_plays, 2000);
    assert.equal(fx.writes[0].value.last_error, null);
    fx.fetch = async (): Promise<ResponseValue> => response({ data: [] });
    await fx.invoke("refreshInstagramRates", "refreshInstagramRates", "creator");
    assert.equal(fx.writes[1].value.suggested_rate, 0);
    assert.equal(fx.writes[1].value.median_plays, 0);
});

void test("Graph host helpers are identical standalone copies and default to Facebook", (): void => {
    const folders = [
        "refreshTokens",
        "refreshInstagramRates",
        "updateInstagramDemographics",
        "processInstagramComments",
        "refreshAllCampaignAnalytics",
    ];
    const contents = folders.map((folder): string =>
        readFileSync(resolve("functions", folder, "graphHost.js"), "utf8"),
    );
    assert.ok(contents.every((content) => content === contents[0]));
    assert.ok(contents[0].split("\n").length <= 20);
    const moduleValue: { exports: { graphHostFor?: (node?: RecordValue | null) => string } } = { exports: {} };
    runInNewContext(contents[0], { module: moduleValue });
    const hostFor = moduleValue.exports.graphHostFor;
    assert.ok(hostFor);
    const defaults: (RecordValue | null | undefined)[] = [
        undefined,
        null,
        {},
        { api_path: "facebook" },
        { api_path: "unrecognized" },
    ];
    for (const value of defaults) {
        assert.equal(hostFor(value), "https://graph.facebook.com/v24.0");
    }
    assert.equal(hostFor({ api_path: "instagram" }), "https://graph.instagram.com/v24.0");
});

void test("Instagram rates route media and insights with each creator's host and account id", async (): Promise<void> => {
    for (const path of [undefined, "facebook", "instagram"]) {
        const social: RecordValue = {
            access_token: "synthetic",
            instagram_business_account_id: "fb-account",
            instagram_user_id: "ig-account",
        };
        if (path) social.api_path = path;
        const fx = fixture(
            { creator: socialUser("instagram", social) },
            async (url): Promise<ResponseValue> =>
                response(
                    url.includes("/media?")
                        ? { data: [{ id: "post", media_type: "VIDEO" }] }
                        : { data: [{ values: [{ value: 2000 }] }] },
                ),
        );
        await fx.invoke("refreshInstagramRates", "refreshInstagramRates", "creator");
        const host = path === "instagram" ? "graph.instagram.com" : "graph.facebook.com";
        assert.equal(fx.requests.length, 2);
        assert.ok(fx.requests.every((url) => new URL(url).host === host));
        assert.equal(
            new URL(fx.requests[0]).pathname,
            path === "instagram" ? "/v24.0/ig-account/media" : "/v24.0/fb-account/media",
        );
        assert.equal(fx.writes[0].value.suggested_rate, 5000);
    }
});

const demographicResponse = (url: string): ResponseValue => {
    const breakdown = new URL(url).searchParams.get("breakdown");
    const dimension =
        breakdown === "city" ? "Austin, Texas" : breakdown === "country" ? "US" : breakdown === "age" ? "25-34" : "F";
    return response({
        data: [{ total_value: { breakdowns: [{ results: [{ dimension_values: [dimension], value: 7 }] }] } }],
    });
};

void test("Demographics scopes one creator, selects each host/id and atomically retains metric transformations", async (): Promise<void> => {
    for (const path of [undefined, "instagram"]) {
        const social: RecordValue = {
            access_token: "synthetic",
            instagram_business_account_id: "fb-account",
            instagram_user_id: "ig-account",
        };
        if (path) social.api_path = path;
        const fx = fixture(
            { creator: socialUser("instagram", social), other: socialUser("instagram", social) },
            async (url): Promise<ResponseValue> => demographicResponse(url),
        );
        assert.equal(
            (await fx.invoke("updateInstagramDemographics", "fetchAndUpdateInstagramDemographics", "creator")).status,
            200,
        );
        assert.deepEqual(fx.reads, ["users/creator"]);
        assert.equal(fx.writes.length, 1);
        assert.equal(fx.writes[0].path, "users/creator/creator_socials/instagram");
        assert.equal(fx.writes[0].value.last_error, null);
        assert.deepEqual(fx.writes[0].value["demographics/gender"], { f: 7 });
        assert.deepEqual(fx.writes[0].value["demographics/country"], { us: 7 });
        assert.deepEqual(fx.writes[0].value["demographics/age"], { "25_34": 7 });
        assert.deepEqual(fx.writes[0].value["demographics/states"], { texas: { total: 7, austin: 7 } });
        assert.equal(fx.requests.length, 4);
        assert.ok(
            fx.requests.every(
                (url) => new URL(url).host === (path === "instagram" ? "graph.instagram.com" : "graph.facebook.com"),
            ),
        );
        assert.ok(
            fx.requests.every(
                (url) =>
                    new URL(url).pathname ===
                    (path === "instagram" ? "/v24.0/ig-account/insights" : "/v24.0/fb-account/insights"),
            ),
        );
        assert.equal(
            (await fx.invoke("updateInstagramDemographics", "fetchAndUpdateInstagramDemographics", "missing")).status,
            404,
        );
    }
});

void test("Demographics records token errors only and preserves other users after failure", async (): Promise<void> => {
    for (const code of [190, 102, 10, 200, 4, 17, 32]) {
        const fx = fixture(
            {
                creator: socialUser("instagram", {
                    access_token: "synthetic",
                    instagram_business_account_id: "account",
                }),
            },
            async (): Promise<ResponseValue> => response({ error: { code, error_subcode: 460 } }, false),
        );
        await fx.invoke("updateInstagramDemographics", "fetchAndUpdateInstagramDemographics", "creator");
        if ([4, 17, 32].includes(code)) assert.equal(fx.writes.length, 0);
        else {
            assert.deepEqual(Object.keys(fx.writes[0].value), ["last_error"]);
            assert.equal(
                recordValue(fx.writes[0].value.last_error).message_key,
                code === 190 ? "ig_190_460" : `ig_${code}`,
            );
        }
    }
    let failed = false;
    const users = {
        a: socialUser("instagram", { access_token: "synthetic", instagram_business_account_id: "account" }),
        b: socialUser("instagram", { access_token: "synthetic", instagram_business_account_id: "account" }),
    };
    const fx = fixture(users, async (url): Promise<ResponseValue> => {
        if (!failed) {
            failed = true;
            throw new Error("Synthetic network error");
        }
        return demographicResponse(url);
    });
    await fx.invoke("updateInstagramDemographics", "fetchAndUpdateInstagramDemographics");
    assert.equal(fx.writes.length, 1);
    assert.equal(fx.writes[0].path, "users/b/creator_socials/instagram");
    assert.deepEqual(fx.pages, [100]);
});

const campaignWithPost = (creatorId: string, mediaId: string): RecordValue => ({
    brand_id: "brand",
    status: "active",
    tasks: { task: { posts: { post: { creator_id: creatorId, media_id: mediaId, platform: "instagram" } } } },
});

void test("Comments retain campaign scope and select the creator's Graph host", async (): Promise<void> => {
    for (const path of [undefined, "instagram"]) {
        const social: RecordValue = {
            access_token: "synthetic",
            instagram_business_account_id: "account",
            instagram_user_id: "ig-account",
        };
        if (path) social.api_path = path;
        const fx = fixture(
            { creator: socialUser("instagram", social) },
            async (): Promise<ResponseValue> => response({ data: [{ id: "comment", text: "synthetic" }] }),
        );
        fx.campaigns = {
            selected: campaignWithPost("creator", "selected-media"),
            excluded: campaignWithPost("creator", "excluded-media"),
        };
        assert.equal(
            (await fx.invoke("processInstagramComments", "processInstagramComments", "selected")).body.postsProcessed,
            1,
        );
        assert.equal(fx.requests.length, 1);
        assert.equal(new URL(fx.requests[0]).host, path === "instagram" ? "graph.instagram.com" : "graph.facebook.com");
        assert.equal(new URL(fx.requests[0]).pathname, "/v24.0/selected-media/comments");
        assert.equal(fx.sets[0].path, "influencer_campaigns/selected/instagram_comments/post");
        assert.equal((await fx.invoke("processInstagramComments", "processInstagramComments", "missing")).status, 404);
    }
});

void test("Campaign analytics cache each creator once per invocation across campaigns and refresh the cache next run", async (): Promise<void> => {
    const fx = fixture(
        { creator: socialUser("instagram", { api_path: "instagram", access_token: "synthetic" }) },
        async (): Promise<ResponseValue> =>
            response({ data: [1, 2, 3, 4].map((value): Json => ({ values: [{ value }] })) }),
    );
    fx.campaigns = { a: campaignWithPost("creator", "first-media"), b: campaignWithPost("creator", "second-media") };
    await fx.invoke("refreshAllCampaignAnalytics", "refreshAllCampaignAnalytics");
    assert.equal(fx.reads.filter((path) => path === "users/creator/creator_socials/instagram").length, 1);
    assert.equal(fx.requests.length, 2);
    assert.ok(fx.requests.every((url) => new URL(url).host === "graph.instagram.com"));
    fx.users.creator = socialUser("instagram", { access_token: "synthetic-fb" });
    fx.requests.length = 0;
    await fx.invoke("refreshAllCampaignAnalytics", "refreshAllCampaignAnalytics", "a");
    assert.equal(fx.reads.filter((path) => path === "users/creator/creator_socials/instagram").length, 2);
    assert.equal(fx.requests.length, 1);
    assert.equal(new URL(fx.requests[0]).host, "graph.facebook.com");
    assert.equal(
        (await fx.invoke("refreshAllCampaignAnalytics", "refreshAllCampaignAnalytics", "missing")).status,
        404,
    );
});

void test("Instagram refresh uses the 30-day window, skips Facebook/missing expiry and awaits atomic success", async (): Promise<void> => {
    const due: RecordValue = {
        api_path: "instagram",
        access_token: "synthetic",
        access_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
    };
    const fx = fixture(
        {
            due: socialUser("instagram", due),
            boundary: socialUser("instagram", {
                ...due,
                access_token_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
            }),
            later: socialUser("instagram", {
                ...due,
                access_token_expires_at: new Date(Date.now() + 31 * 86400000).toISOString(),
            }),
            facebook: socialUser("instagram", { ...due, api_path: "facebook" }),
            legacy: socialUser("instagram", { access_token: "synthetic" }),
            missingExpiry: socialUser("instagram", { api_path: "instagram", access_token: "synthetic" }),
            badExpiry: socialUser("instagram", { ...due, access_token_expires_at: "not-a-date" }),
            noToken: socialUser("instagram", { ...due, access_token: "null" }),
        },
        async (): Promise<ResponseValue> => response({ access_token: "synthetic-refreshed", expires_in: 60 * 86400 }),
    );
    assert.equal((await fx.invoke("refreshTokens", "refreshTiktokAccessTokens")).status, 200);
    assert.equal(fx.requests.length, 2);
    assert.equal(fx.writes.length, 2);
    for (const url of fx.requests) {
        assert.equal(new URL(url).host, "graph.instagram.com");
        assert.equal(new URL(url).pathname, "/v24.0/refresh_access_token");
        assert.equal(new URL(url).searchParams.get("grant_type"), "ig_refresh_token");
    }
    for (const write of fx.writes) {
        assert.equal(write.value.access_token, "synthetic-refreshed");
        assert.ok(Date.parse(String(write.value.access_token_expires_at)) > Date.now() + 59 * 86400000);
        assert.equal(write.value.last_error, null);
        assert.deepEqual(Object.keys(write.value).sort(), ["access_token", "access_token_expires_at", "last_error"]);
    }
});

void test("Instagram refresh 190 errors preserve tokens, transient errors do not write and TikTok failures remain isolated", async (): Promise<void> => {
    const user: RecordValue = {
        creator_socials: {
            instagram: {
                api_path: "instagram",
                access_token: "synthetic",
                access_token_expires_at: new Date().toISOString(),
            },
            tiktok: { refresh_token: "synthetic-tt" },
        },
    };
    for (const subcode of [460, 463, 467, 458, 459, 999]) {
        const fx = fixture(
            { creator: user },
            async (url): Promise<ResponseValue> =>
                response(
                    url.includes("tiktokapis")
                        ? { error: "invalid_grant" }
                        : { error: { code: 190, error_subcode: subcode } },
                    false,
                ),
        );
        await fx.invoke("refreshTokens", "refreshTiktokAccessTokens", "creator");
        assert.equal(fx.writes.length, 2);
        assert.equal(recordValue(fx.writes[0].value.last_error).message_key, "tt_invalid_grant");
        assert.deepEqual(Object.keys(fx.writes[1].value), ["last_error"]);
        assert.equal(
            recordValue(fx.writes[1].value.last_error).message_key,
            subcode === 999 ? "ig_190" : `ig_190_${subcode}`,
        );
    }
    const fx = fixture(
        { creator: socialUser("instagram", recordValue(recordValue(user.creator_socials).instagram)) },
        async (): Promise<ResponseValue> => response({ error: { code: 4 } }, false),
    );
    await fx.invoke("refreshTokens", "refreshTiktokAccessTokens", "creator");
    assert.equal(fx.writes.length, 0);
});
