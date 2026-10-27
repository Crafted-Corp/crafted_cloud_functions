import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRecord } from "../lib/types";

const h = vi.hoisted(() => ({
    database: vi.fn(),
    captureException: vi.fn(),
}));

vi.mock("../lib/firebase", () => ({ default: { database: h.database } }));
vi.mock("../lib/sentry", () => ({ default: { captureException: h.captureException } }));

import { refreshTiktokRates } from "../function-handler";

interface ResMock {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    getHeader: ReturnType<typeof vi.fn>;
}

const invoke = (method: string, query: Record<string, unknown> = {}): Promise<ResMock> =>
    new Promise((resolve) => {
        const res: ResMock = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(() => {
                resolve(res);
                return res;
            }),
            setHeader: vi.fn(),
            getHeader: vi.fn(() => undefined),
        };
        refreshTiktokRates({ method, query, headers: {} } as never, res as never);
    });

const bodyOf = (res: ResMock): Record<string, unknown> => res.json.mock.calls[0][0];

interface Write {
    path: string;
    value: Record<string, unknown>;
}

const usersDatabase = (users: Record<string, UserRecord>) => {
    const limits: number[] = [];
    const startAfters: string[] = [];
    const writes: Write[] = [];
    const query = (after = "", size = Number.POSITIVE_INFINITY) => ({
        orderByKey: () => query(after, size),
        limitToFirst: (limit: number) => {
            limits.push(limit);
            return query(after, limit);
        },
        startAfter: (key: string) => {
            startAfters.push(key);
            return query(key, size);
        },
        child: (key: string) => ({ once: async () => ({ val: () => users[key] ?? null }) }),
        once: async () => {
            const page = Object.entries(users)
                .sort(([a], [b]) => a.localeCompare(b))
                .filter(([key]) => key > after)
                .slice(0, size);
            return { val: () => (page.length > 0 ? Object.fromEntries(page) : null) };
        },
    });
    h.database.mockReturnValue({
        ref: (path: string) =>
            path === "users"
                ? query()
                : {
                      update: async (value: Record<string, unknown>) => {
                          await new Promise<void>((done) => setTimeout(done, 1));
                          writes.push({ path, value });
                      },
                  },
    });
    return { limits, startAfters, writes };
};

const connectedUser: UserRecord = { creator_socials: { tiktok: { access_token: "token" } } };

const makeUsers = (count: number): Record<string, UserRecord> =>
    Object.fromEntries(Array.from({ length: count }, (_, n) => [`u${String(n).padStart(3, "0")}`, connectedUser]));

const stubTikTok = ({ delayMs = 0, failFirstCall = false } = {}) => {
    const state = { active: 0, peak: 0, failedOnce: false };
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            if (failFirstCall && !state.failedOnce) {
                state.failedOnce = true;
                throw new Error("Synthetic per-user network failure");
            }
            state.active += 1;
            state.peak = Math.max(state.peak, state.active);
            await new Promise<void>((done) => setTimeout(done, delayMs));
            state.active -= 1;
            const body = String(url).includes("user/info")
                ? { data: { user: { follower_count: 5 } } }
                : { data: { videos: [] } };
            return { ok: true, status: 200, json: async () => body };
        }),
    );
    return state;
};

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    logSpy.mockRestore();
    errorSpy.mockRestore();
});

describe("refreshTiktokRates request guards", () => {
    it("answers 405 to a non-POST request without touching Firebase", async () => {
        const res = await invoke("GET");

        expect(res.status).toHaveBeenCalledWith(405);
        expect(res.setHeader).toHaveBeenCalledWith("Allow", "POST");
        expect(h.database).not.toHaveBeenCalled();
    });

    it.each([
        [""],
        [["a", "b"]],
        [{ nested: "x" }],
    ])("rejects user_id %j instead of running the full scan", async (userId) => {
        const res = await invoke("POST", { user_id: userId });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(h.database).not.toHaveBeenCalled();
    });
});

describe("refreshTiktokRates ?user_id scope", () => {
    it("answers 404 when the user node is absent", async () => {
        usersDatabase({});

        const res = await invoke("POST", { user_id: "ghost" });

        expect(res.status).toHaveBeenCalledWith(404);
        expect(bodyOf(res)).toEqual({ message: "User not found" });
    });

    it("refreshes only the named creator and returns the counts", async () => {
        const { writes } = usersDatabase({ creator: connectedUser, other: connectedUser });
        stubTikTok();

        const res = await invoke("POST", { user_id: "creator" });

        expect(res.status).toHaveBeenCalledWith(200);
        expect(bodyOf(res)).toEqual({ processed: 1, skipped: 0, failed: 0 });
        expect(writes.map((write) => write.path)).toEqual(["users/creator/creator_socials/tiktok"]);
    });
});

describe("refreshTiktokRates full run", () => {
    it("pages every user, skips negotiated and disconnected creators, isolates a network failure and keeps five in flight", async () => {
        const users = makeUsers(103);
        users.z1 = { negotiated: true, ...connectedUser };
        users.z2 = { creator_socials: { tiktok: { access_token: "null" } } };
        const { limits, startAfters, writes } = usersDatabase(users);
        const state = stubTikTok({ delayMs: 1, failFirstCall: true });

        const res = await invoke("POST");

        expect(bodyOf(res)).toEqual({ processed: 102, skipped: 2, failed: 1 });
        expect(writes).toHaveLength(102);
        expect(state.peak).toBeLessThanOrEqual(5);
        expect(limits).toEqual([100, 100]);
        expect(startAfters).toEqual(["u099"]);
        expect(h.captureException).not.toHaveBeenCalled();
    });

    it("responds only after every write has landed", async () => {
        const { writes } = usersDatabase(makeUsers(12));
        stubTikTok({ delayMs: 1 });

        await invoke("POST");

        expect(writes).toHaveLength(12);
    });

    it("logs one summary line", async () => {
        usersDatabase(makeUsers(3));
        stubTikTok();

        await invoke("POST");

        expect(logSpy).toHaveBeenCalledWith(
            expect.stringMatching(/refresh-tiktok-rates finished: processed=3 skipped=0 failed=0 ms=\d+/),
        );
    });

    it("captures a Firebase failure and answers 500 without the raw error", async () => {
        h.database.mockReturnValue({
            ref: () => ({
                orderByKey: () => ({
                    limitToFirst: () => ({ once: async () => Promise.reject(new Error("firebase boom")) }),
                }),
            }),
        });

        const res = await invoke("POST");

        expect(h.captureException).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(bodyOf(res)).toEqual({ message: "Error updating suggested rates" });
    });
});
