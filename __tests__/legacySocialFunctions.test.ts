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
    query: { user_id?: string };
}
interface ReplyValue {
    status(code: number): ReplyValue;
    json(value: RecordValue): void;
}
type Handler = (request: RequestValue, response: ReplyValue) => void | Promise<void>;
interface FunctionExports {
    [key: string]: Handler;
}
interface WriteValue {
    path: string;
    value: RecordValue;
}
interface NodeValue {
    child(key: string): NodeValue;
    orderByKey(): NodeValue;
    limitToFirst(size: number): NodeValue;
    startAfter(key: string): NodeValue;
    once(event: string): Promise<{ val(): Json }>;
    update(value: RecordValue): Promise<void>;
}
interface Fixture {
    users: RecordValue;
    writes: WriteValue[];
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
        writes,
        pages,
        fetch: fetchResponse,
        async invoke(
            folder,
            target,
            uid,
            env = { TIKTOK_CLIENT_KEY: "test-key", TIKTOK_CLIENT_SECRET: "test-secret" },
        ) {
            const node = (path: string, after = "", limit = 100): NodeValue => ({
                child: (key): NodeValue => node(`${path}/${key}`),
                orderByKey: (): NodeValue => node(path, after, limit),
                limitToFirst: (size): NodeValue => {
                    pages.push(size);
                    return node(path, after, size);
                },
                startAfter: (key): NodeValue => node(path, key, limit),
                once: async (): Promise<{ val(): Json }> => ({
                    val: (): Json => {
                        if (path === "users")
                            return Object.fromEntries(
                                Object.entries(users)
                                    .sort(([a], [b]) => a.localeCompare(b))
                                    .filter(([key]) => key > after)
                                    .slice(0, limit),
                            );
                        return users[path.split("/")[1]] ?? null;
                    },
                }),
                update: async (value): Promise<void> => {
                    await new Promise<void>((done) => setTimeout(done, 1));
                    writes.push({ path, value: structuredClone(value) });
                },
            });
            const file = resolve(
                "functions",
                folder,
                folder === "refreshInstagramRates" ? "instagram.js" : "influencer.js",
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
                if (name === "./socialErrors") {
                    const helper = { exports: {} };
                    runInNewContext(readFileSync(resolve(dirname(file), "socialErrors.js"), "utf8"), {
                        module: helper,
                        Date,
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
                fetch: fixtureValue.fetch,
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
                    json(body): void {
                        done({ status, body: structuredClone(body) });
                    },
                };
                Promise.resolve(moduleValue.exports[target]({ query: uid ? { user_id: uid } : {} }, reply)).catch(
                    reject,
                );
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
    assert.equal(fx.writes[0].value.last_error, null);
    fx.fetch = async (): Promise<ResponseValue> => response({ data: [] });
    await fx.invoke("refreshInstagramRates", "refreshInstagramRates", "creator");
    assert.equal(fx.writes[1].value.suggested_rate, 0);
});
