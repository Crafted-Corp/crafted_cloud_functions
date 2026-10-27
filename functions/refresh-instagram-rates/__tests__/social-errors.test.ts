import { describe, expect, it } from "vitest";
import { graphHostFor } from "../lib/graph-host";
import { lastErrorFor, metaMessageKey } from "../lib/social-errors";

describe("metaMessageKey", () => {
    it.each([460, 463, 467, 458, 459])("keeps the 190 subcode %i in the key", (subcode) => {
        expect(metaMessageKey({ code: 190, error_subcode: subcode })).toBe(`ig_190_${subcode}`);
    });

    it("falls back to ig_190 for an unlisted or missing subcode", () => {
        expect(metaMessageKey({ code: 190, error_subcode: 999 })).toBe("ig_190");
        expect(metaMessageKey({ code: 190 })).toBe("ig_190");
    });

    it.each([102, 10, 200])("maps code %i", (code) => {
        expect(metaMessageKey({ code })).toBe(`ig_${code}`);
    });

    it.each([4, 17, 32, 1])("does not record code %i as a connection error", (code) => {
        expect(metaMessageKey({ code })).toBeNull();
    });

    it("is null without an error", () => {
        expect(metaMessageKey(undefined)).toBeNull();
    });
});

describe("lastErrorFor", () => {
    it("includes the subcode only when present", () => {
        expect(lastErrorFor(190, 463, "ig_190_463")).toEqual({
            code: 190,
            subcode: 463,
            message_key: "ig_190_463",
            at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        });
        expect(lastErrorFor(102, undefined, "ig_102")).not.toHaveProperty("subcode");
    });
});

describe("graphHostFor", () => {
    it.each([
        undefined,
        null,
        {},
        { api_path: "facebook" },
        { api_path: "unrecognized" },
    ])("defaults to Facebook for %j", (node) => {
        expect(graphHostFor(node)).toBe("https://graph.facebook.com/v24.0");
    });

    it("routes the instagram path to Instagram", () => {
        expect(graphHostFor({ api_path: "instagram" })).toBe("https://graph.instagram.com/v24.0");
    });
});
