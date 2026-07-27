import { outreachRequestSchema } from "../lib/schemas";

const validStudioBody = {
    product: "studio",
    brand_id: "brand-1",
    message: "hello",
    task: {
        uid: "task-1",
        name: "Spring brief",
        regions: [{ value: "CA" }],
        price: 15000,
    },
};

const validAmplifyBody = {
    product: "amplify",
    brand_id: "brand-1",
    message: "join us",
    campaign_id: "camp-1",
    campaign_name: "Spring campaign",
    follower_count: [1000, 50000],
    platforms: ["tiktok", "instagram"],
    states: ["USA"],
};

describe("outreachRequestSchema", () => {
    it("accepts a valid studio body", () => {
        const result = outreachRequestSchema.safeParse(validStudioBody);

        expect(result.success).toBe(true);
    });

    it("accepts a valid amplify body", () => {
        const result = outreachRequestSchema.safeParse(validAmplifyBody);

        expect(result.success).toBe(true);
    });

    it("retains unknown top-level keys via passthrough for a studio body", () => {
        const result = outreachRequestSchema.safeParse({ ...validStudioBody, extra_flag: "keep-me" });

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ extra_flag: "keep-me" });
    });

    it("retains unknown top-level keys via passthrough for an amplify body", () => {
        const result = outreachRequestSchema.safeParse({ ...validAmplifyBody, source: "dashboard" });

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ source: "dashboard" });
    });

    it("rejects a body missing the product discriminator", () => {
        const result = outreachRequestSchema.safeParse({
            brand_id: "brand-1",
            message: "hello",
            task: validStudioBody.task,
        });

        expect(result.success).toBe(false);
    });

    it("rejects a studio body with an empty regions array", () => {
        const result = outreachRequestSchema.safeParse({
            ...validStudioBody,
            task: { ...validStudioBody.task, regions: [] },
        });

        expect(result.success).toBe(false);
    });

    it("rejects an amplify body with an unknown platform enum value", () => {
        const result = outreachRequestSchema.safeParse({
            ...validAmplifyBody,
            platforms: ["youtube"],
        });

        expect(result.success).toBe(false);
    });
});
