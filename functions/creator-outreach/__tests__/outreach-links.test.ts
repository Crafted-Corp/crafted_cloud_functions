interface SentMessage {
    to: string;
    html: string;
}

type SendResult = Array<[{ statusCode: number; headers: Record<string, string> }, unknown]>;

const h = vi.hoisted(() => ({
    send: vi.fn<(messages: unknown, isMultiple: boolean) => Promise<SendResult>>(),
}));

vi.mock("@sendgrid/mail", () => ({ default: { setApiKey: vi.fn(), send: h.send } }));
vi.mock("../lib/firebase", () => ({ default: {} }));

// Imported after the mocks so the real module load compiles the real templates.
import type { OutreachDatabase } from "../lib/email";
import { sendOutreachEmails } from "../lib/email";
import type { Environment } from "../lib/environment";
import { getCreatorTasksUrl, resolveEnvironment } from "../lib/environment";
import type { MatchedCreator } from "../lib/scanner";
import type { AmplifyOutreachRequest, OutreachRequest, StudioOutreachRequest } from "../lib/schemas";

const EXPECTED_TASKS_URL: Record<Environment, string> = {
    dev: "https://crafted-web-dev-client.herokuapp.com/creator/dashboard/tasks",
    staging: "https://crafted-web-staging-client-4fdf273c9eea.herokuapp.com/creator/dashboard/tasks",
    prod: "https://www.app.cookwithcrafted.com/creator/dashboard/tasks",
};

const PROD_APP_HOST = "app.cookwithcrafted.com";

// The marketing/social footer is deliberately environment-independent.
const FOOTER_LINKS = [
    "https://www.cookwithcrafted.com/",
    "https://www.facebook.com/cookwithcrafted",
    "https://twitter.com/cookwithcrafted?lang=en",
    "https://www.instagram.com/cookwithcrafted/?hl=en",
];

const environments: Environment[] = ["dev", "staging", "prod"];

const fakeFirebase = (): OutreachDatabase => {
    const database = () => ({
        ref: (path: string) => ({
            once: async () => {
                if (path.endsWith("/brand_name")) return { val: () => "BrandName" };
                if (path.endsWith("/email")) return { val: () => "brand@x.com" };
                if (path === "admin/pricing") return { val: () => ({ creator_amplify_video_price: 5000 }) };
                return { val: () => null };
            },
        }),
    });
    return { database };
};

const studioRequest: StudioOutreachRequest = {
    product: "studio",
    brand_id: "brand-1",
    message: "",
    task: { uid: "task-1", name: "Summer Brief", regions: [{ value: "USA" }], price: 10000 },
};

const amplifyRequest: AmplifyOutreachRequest = {
    product: "amplify",
    brand_id: "brand-1",
    message: "hi",
    campaign_id: "camp-1",
    campaign_name: "Camp",
    follower_count: [1000, 100000],
    platforms: ["tiktok"],
    states: ["USA"],
};

const creators: MatchedCreator[] = [
    {
        id: "creator-1",
        email: "creator@x.com",
        shipping_details: { fullname: "Cre Ator" },
        creator_socials: { tiktok: { performance: { suggestedRate: 5000 } } },
    },
];

const isSentMessages = (value: unknown): value is SentMessage[] =>
    Array.isArray(value) &&
    value.every(
        (item) =>
            typeof item === "object" &&
            item !== null &&
            "to" in item &&
            typeof item.to === "string" &&
            "html" in item &&
            typeof item.html === "string",
    );

const sendAndCapture = async (request: OutreachRequest): Promise<SentMessage> => {
    await sendOutreachEmails(fakeFirebase(), request, creators);
    expect(h.send).toHaveBeenCalledTimes(1);
    const [messages] = h.send.mock.calls[0];
    if (!isSentMessages(messages)) throw new Error("sgMail.send did not receive personalizations");
    expect(messages).toHaveLength(1);
    return messages[0];
};

const ctaHrefs = (html: string): string[] =>
    [...html.matchAll(/<a href="([^"]*)"[^>]*>Apply for Briefs<\/a>/g)].map((match) => match[1]);

beforeEach(() => {
    vi.clearAllMocks();
    h.send.mockResolvedValue([[{ statusCode: 202, headers: { "x-message-id": "m1" } }, {}]]);
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("creator tasks URL by environment", () => {
    it.each(environments)("maps %s to its frontend origin and preserves the tasks path", (environment) => {
        expect(getCreatorTasksUrl(environment)).toBe(EXPECTED_TASKS_URL[environment]);
    });
});

describe("resolveEnvironment", () => {
    it.each(environments)("accepts %s", (environment) => {
        expect(resolveEnvironment(environment)).toBe(environment);
    });

    it("defaults to dev when NODE_ENV is empty, matching the Firebase resolver", () => {
        expect(resolveEnvironment("")).toBe("dev");
    });

    it("rejects an unknown environment instead of falling back to prod", () => {
        expect(() => resolveEnvironment("qa")).toThrow('Unknown NODE_ENV "qa". Expected one of: dev, staging, prod');
    });
});

describe.each([
    ["amplify", amplifyRequest],
    ["studio", studioRequest],
] as const)("%s outreach email application CTA", (_product, request) => {
    it.each(environments)("links to the %s frontend tasks page", async (environment) => {
        vi.stubEnv("NODE_ENV", environment);

        const message = await sendAndCapture(request);

        const hrefs = ctaHrefs(message.html);
        expect(hrefs).toEqual([EXPECTED_TASKS_URL[environment]]);
        const cta = new URL(hrefs[0]);
        expect(cta.origin).toBe(new URL(EXPECTED_TASKS_URL[environment]).origin);
        expect(cta.pathname).toBe("/creator/dashboard/tasks");
    });

    it.each(["dev", "staging"] as const)("never points the %s email at production", async (environment) => {
        vi.stubEnv("NODE_ENV", environment);

        const { html } = await sendAndCapture(request);

        expect(html).not.toContain(PROD_APP_HOST);
    });

    it("keeps the marketing and social footer links identical in every environment", async () => {
        for (const environment of environments) {
            vi.stubEnv("NODE_ENV", environment);
            h.send.mockClear();

            const { html } = await sendAndCapture(request);

            for (const link of FOOTER_LINKS) {
                expect(html).toContain(`href="${link}"`);
            }
        }
    });

    it("fails the blast without sending when NODE_ENV is unknown", async () => {
        vi.stubEnv("NODE_ENV", "qa");

        await expect(sendOutreachEmails(fakeFirebase(), request, creators)).rejects.toThrow('Unknown NODE_ENV "qa"');
        expect(h.send).not.toHaveBeenCalled();
    });
});
