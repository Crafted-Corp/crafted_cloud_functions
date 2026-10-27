import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RateOutcome, UserRecord } from "../lib/types";

const h = vi.hoisted(() => ({
    database: vi.fn(),
    captureException: vi.fn(),
    processUser: vi.fn(),
}));

vi.mock("../lib/firebase", () => ({ default: { database: h.database } }));
vi.mock("../lib/sentry", () => ({ default: { captureException: h.captureException } }));
vi.mock("../lib/instagram-rates", () => ({ processUserInstagramRate: h.processUser }));

import { refreshInstagramRates } from "../function-handler";

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
        refreshInstagramRates({ method, query, headers: {} } as never, res as never);
    });

const bodyOf = (res: ResMock): Record<string, unknown> => res.json.mock.calls[0][0];

const usersDatabase = (users: Record<string, UserRecord>) => {
    const limits: number[] = [];
    const startAfters: string[] = [];
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
    h.database.mockReturnValue({ ref: () => query() });
    return { limits, startAfters };
};

const makeUsers = (count: number): Record<string, UserRecord> =>
    Object.fromEntries(Array.from({ length: count }, (_, n) => [`u${String(n).padStart(3, "0")}`, {}]));

const processed: RateOutcome = { outcome: "processed", suggestedRate: 5000 };

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.clearAllMocks();
    h.processUser.mockResolvedValue(processed);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
});

describe("refreshInstagramRates request guards", () => {
    it("answers 405 to a non-POST request without touching Firebase", async () => {
        const res = await invoke("GET");

        expect(res.status).toHaveBeenCalledWith(405);
        expect(res.setHeader).toHaveBeenCalledWith("Allow", "POST");
        expect(h.database).not.toHaveBeenCalled();
        expect(h.processUser).not.toHaveBeenCalled();
    });

    it.each([
        [""],
        [["a", "b"]],
        [{ nested: "x" }],
    ])("rejects user_id %j instead of running the full scan", async (userId) => {
        const res = await invoke("POST", { user_id: userId });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(h.database).not.toHaveBeenCalled();
        expect(h.processUser).not.toHaveBeenCalled();
    });
});

describe("refreshInstagramRates ?user_id scope", () => {
    it("answers 404 when the user node is absent", async () => {
        usersDatabase({});

        const res = await invoke("POST", { user_id: "ghost" });

        expect(res.status).toHaveBeenCalledWith(404);
        expect(bodyOf(res)).toEqual({ status: "404", statuscode: "-1", message: "User ghost not found." });
        expect(h.processUser).not.toHaveBeenCalled();
    });

    it("processes only the named creator and reports the rate", async () => {
        usersDatabase({ creator: {}, other: {} });

        const res = await invoke("POST", { user_id: "creator" });

        expect(h.processUser).toHaveBeenCalledTimes(1);
        expect(h.processUser).toHaveBeenCalledWith(expect.anything(), "creator", {});
        expect(res.status).toHaveBeenCalledWith(200);
        expect(bodyOf(res)).toEqual({
            status: "200",
            statuscode: "1",
            message: "Successfully updated Instagram rate for user creator",
            suggestedRate: 5000,
        });
    });

    it("reports a skip reason", async () => {
        usersDatabase({ creator: {} });
        h.processUser.mockResolvedValue({ outcome: "skipped", reason: "negotiated" });

        const res = await invoke("POST", { user_id: "creator" });

        expect(res.status).toHaveBeenCalledWith(200);
        expect(bodyOf(res).message).toBe("User creator skipped: negotiated");
    });

    it("answers 500 with a fixed message when the creator's refresh throws", async () => {
        usersDatabase({ creator: {} });
        h.processUser.mockRejectedValue(new Error("meta secret detail"));

        const res = await invoke("POST", { user_id: "creator" });

        expect(res.status).toHaveBeenCalledWith(500);
        expect(bodyOf(res)).toEqual({ status: "500", statuscode: "-1", message: "Failed to process user creator." });
    });
});

describe("refreshInstagramRates full run", () => {
    it("pages users 100 at a time with startAfter and stops at a short page", async () => {
        const { limits, startAfters } = usersDatabase(makeUsers(103));

        const res = await invoke("POST");

        expect(limits).toEqual([100, 100]);
        expect(startAfters).toEqual(["u099"]);
        expect(h.processUser).toHaveBeenCalledTimes(103);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("reads one more page when the last page is exactly full", async () => {
        const { limits } = usersDatabase(makeUsers(100));

        await invoke("POST");

        expect(limits).toEqual([100, 100]);
        expect(h.processUser).toHaveBeenCalledTimes(100);
    });

    it("responds only after every creator in every page has been awaited", async () => {
        usersDatabase(makeUsers(103));
        let finished = 0;
        h.processUser.mockImplementation(async () => {
            await new Promise<void>((done) => setTimeout(done, 1));
            finished += 1;
            return processed;
        });

        await invoke("POST");

        expect(finished).toBe(103);
    });

    it("keeps going when one creator's refresh throws and counts it as failed", async () => {
        usersDatabase(makeUsers(103));
        h.processUser.mockImplementation(async (_app: unknown, uid: string) => {
            if (uid === "u005") throw new Error("boom");
            return uid === "u006" ? { outcome: "skipped", reason: "negotiated" } : processed;
        });

        const res = await invoke("POST");

        expect(h.processUser).toHaveBeenCalledTimes(103);
        expect(h.captureException).not.toHaveBeenCalled();
        expect(bodyOf(res)).toEqual({
            status: "200",
            statuscode: "1",
            message: "Refreshed all Instagram accounts successfully",
            processed: 101,
            skipped: 1,
            failed: 1,
        });
    });

    it("logs one summary line", async () => {
        usersDatabase(makeUsers(3));

        await invoke("POST");

        expect(logSpy).toHaveBeenCalledWith(
            expect.stringMatching(/refresh-instagram-rates finished: processed=3 skipped=0 failed=0 ms=\d+/),
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
        expect(bodyOf(res)).toEqual({
            status: "500",
            statuscode: "-1",
            message: "Error refreshing Instagram accounts.",
        });
    });
});
