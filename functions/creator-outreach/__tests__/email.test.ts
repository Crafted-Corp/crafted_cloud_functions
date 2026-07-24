import sgMail from "@sendgrid/mail";
import type * as admin from "firebase-admin";

vi.mock("@sendgrid/mail", () => ({
    default: { setApiKey: vi.fn(), send: vi.fn() },
}));
vi.mock("../lib/firebase", () => ({ default: {} }));

// Imported after the mocks so the real module load exercises the real
// path.resolve(__dirname, "../templates/*.hbs") reads — a failed import here
// is itself the template-path regression guard.
import { calculateAmplifySuggestedRate, extractResults, sendOutreachEmails } from "../lib/email";
import type { MatchedCreator } from "../lib/scanner";
import type { AmplifyOutreachRequest } from "../lib/schemas";

const fakeFirebase = () =>
    ({
        database: () => ({
            ref: (path: string) => ({
                once: async () => {
                    if (path.endsWith("/brand_name")) return { val: () => "BrandName" };
                    if (path.endsWith("/email")) return { val: () => "brand@x.com" };
                    if (path === "admin/pricing") return { val: () => ({ creator_amplify_video_price: 5000 }) };
                    return { val: () => null };
                },
            }),
        }),
    }) as unknown as admin.app.App;

beforeEach(() => {
    vi.clearAllMocks();
});

describe("extractResults", () => {
    it("counts 202s as sent, derives failed, and joins non-null message ids", () => {
        const result = [
            [{ statusCode: 202, headers: { "x-message-id": "m1" } }, {}],
            [{ statusCode: 202, headers: {} }, {}],
            [{ statusCode: 400, headers: { "x-message-id": "m3" } }, {}],
        ];

        const out = extractResults(result as never, 3);

        expect(out.sent).toBe(2);
        expect(out.failed).toBe(1);
        expect(out.messages).toBe("m1,m3");
    });
});

describe("calculateAmplifySuggestedRate", () => {
    it("truncates the summed per-platform dollar rates before adding the video price", () => {
        expect(calculateAmplifySuggestedRate(5099, 3099, 2000)).toBe(101);
    });

    it("treats missing platform rates as zero", () => {
        expect(calculateAmplifySuggestedRate(undefined, undefined, 1500)).toBe(15);
    });
});

describe("sendOutreachEmails (amplify skip rule)", () => {
    it("skips a creator that has no tiktok or instagram suggested rate", async () => {
        const sendMock = vi.mocked(sgMail.send);
        sendMock.mockResolvedValue([] as never);

        const data = {
            product: "amplify",
            brand_id: "brand-1",
            message: "hi",
            campaign_id: "camp-1",
            campaign_name: "Camp",
            follower_count: [1000, 100000],
            platforms: ["tiktok"],
            states: ["USA"],
        } as AmplifyOutreachRequest;

        const creators: MatchedCreator[] = [
            {
                id: "with-rate",
                email: "with@x.com",
                creator_socials: { tiktok: { performance: { suggestedRate: 5000 } } },
            },
            { id: "no-rate", email: "no@x.com", creator_socials: { instagram: {} } },
        ];

        await sendOutreachEmails(fakeFirebase(), data, creators);

        expect(sendMock).toHaveBeenCalledTimes(1);
        const [personalizations, isMultiple] = sendMock.mock.calls[0];
        expect(isMultiple).toBe(true);
        const recipients = personalizations as Array<{ to: string }>;
        expect(recipients).toHaveLength(1);
        expect(recipients[0].to).toBe("with@x.com");
    });
});
