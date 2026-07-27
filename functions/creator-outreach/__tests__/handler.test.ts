const h = vi.hoisted(() => {
    const refSet = vi.fn();
    const refUpdate = vi.fn();
    const refOnce = vi.fn();
    const ref = vi.fn((path?: string) => (path === undefined ? { update: refUpdate } : { set: refSet, once: refOnce }));
    const database = vi.fn(() => ({ ref }));
    return {
        refSet,
        refUpdate,
        refOnce,
        ref,
        database,
        captureException: vi.fn(),
        scanCreators: vi.fn(),
        sendOutreachEmails: vi.fn(),
    };
});

vi.mock("../lib/firebase", () => ({ default: { database: h.database } }));
vi.mock("../lib/sentry", () => ({ default: { captureException: h.captureException } }));
vi.mock("../lib/scanner", () => ({ scanCreators: h.scanCreators }));
vi.mock("../lib/email", () => ({ sendOutreachEmails: h.sendOutreachEmails }));

import { creatorOutreach } from "../function-handler";

type ResMock = {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    getHeader: ReturnType<typeof vi.fn>;
};

const invoke = (body: unknown): Promise<ResMock> =>
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
        creatorOutreach({ body, method: "POST", headers: {} } as never, res as never);
    });

const studioBody = {
    product: "studio",
    brand_id: "brand-1",
    message: "hello",
    task: { uid: "task-1", name: "Brief", regions: [{ value: "CA" }], price: 15000 },
};

const amplifyBody = {
    product: "amplify",
    brand_id: "brand-1",
    message: "join",
    campaign_id: "camp-1",
    campaign_name: "Camp",
    follower_count: [1000, 100000],
    platforms: ["tiktok"],
    states: ["USA"],
};

const matched = [{ id: "c1", email: "c1@x.com" }];
const blastResults = { messages: "m1", sent: 1, failed: 0 };

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
});

describe("creatorOutreach", () => {
    it("returns 400 without scanning or emailing when the body is invalid", async () => {
        const res = await invoke({ product: "studio" });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ status: "400", statuscode: "-1", message: "Validation failed" }),
        );
        expect(h.scanCreators).not.toHaveBeenCalled();
        expect(h.sendOutreachEmails).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
    });

    it("returns 200 with the full response envelope on a valid studio body", async () => {
        h.scanCreators.mockResolvedValue(matched);
        h.sendOutreachEmails.mockResolvedValue(blastResults);

        const res = await invoke(studioBody);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            status: "200",
            statuscode: "1",
            message: "hello",
            length: 1,
            data: matched,
            blastResults,
        });
    });

    it("writes the studio invites to tasks/<uid>/invites", async () => {
        h.scanCreators.mockResolvedValue(matched);
        h.sendOutreachEmails.mockResolvedValue(blastResults);

        await invoke(studioBody);

        expect(h.ref).toHaveBeenCalledWith("tasks/task-1/invites");
        expect(h.refSet).toHaveBeenCalledWith(blastResults);
    });

    it("writes the amplify invites to BOTH the brand-scoped and top-level campaign paths", async () => {
        h.scanCreators.mockResolvedValue(matched);
        h.sendOutreachEmails.mockResolvedValue(blastResults);

        await invoke(amplifyBody);

        expect(h.ref).toHaveBeenCalledWith();
        expect(h.refUpdate).toHaveBeenCalledWith({
            "brands/brand-1/influencer_campaigns/camp-1/invites": blastResults,
            "influencer_campaigns/camp-1/invites": blastResults,
        });
    });

    it("captures the error and returns 500 when scanning throws", async () => {
        h.scanCreators.mockRejectedValue(new Error("scan boom"));

        const res = await invoke(studioBody);

        expect(h.captureException).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "500",
                message: "An unexpected error occurred during creator outreach.",
            }),
        );
    });

    it("logs the processing start line and the completion summary on the happy path", async () => {
        h.scanCreators.mockResolvedValue(matched);
        h.sendOutreachEmails.mockResolvedValue(blastResults);

        await invoke(studioBody);

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("creator-outreach: processing studio blast"));
        expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/completed studio blast.*matched=1 sent=1 failed=0/));
    });
});
