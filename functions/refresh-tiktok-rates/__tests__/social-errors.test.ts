import { describe, expect, it } from "vitest";
import { lastErrorFor, tiktokMessageKey } from "../lib/social-errors";

describe("tiktokMessageKey", () => {
    it.each([2190002, 2190003, 2190008, 10010])("maps code %i", (code) => {
        expect(tiktokMessageKey(code)).toBe(`tt_${code}`);
    });

    it("maps a numeric code sent as a string", () => {
        expect(tiktokMessageKey("10010")).toBe("tt_10010");
    });

    it("maps invalid_grant", () => {
        expect(tiktokMessageKey("invalid_grant")).toBe("tt_invalid_grant");
    });

    it.each([["ok"], [0], [undefined], [2190001]])("does not record %s as a connection error", (code) => {
        expect(tiktokMessageKey(code)).toBeNull();
    });
});

describe("lastErrorFor", () => {
    it("includes the subcode only when present", () => {
        expect(lastErrorFor(10010, undefined, "tt_10010")).toEqual({
            code: 10010,
            message_key: "tt_10010",
            at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        });
        expect(lastErrorFor(190, 463, "ig_190_463")).toHaveProperty("subcode", 463);
    });
});
