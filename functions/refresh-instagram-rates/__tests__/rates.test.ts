import { describe, expect, it } from "vitest";
import { instagramSuggestedRate, median } from "../lib/rates";

describe("median", () => {
    it("is 0 for no values", () => {
        expect(median([])).toBe(0);
    });

    it("picks the middle of an odd count after sorting numerically", () => {
        expect(median([10, 9, 100])).toBe(10);
    });

    it("averages the two middle values of an even count", () => {
        expect(median([4000, 1000, 2000, 3000])).toBe(2500);
    });

    it("does not reorder the caller's array", () => {
        const values = [3, 1, 2];
        median(values);
        expect(values).toEqual([3, 1, 2]);
    });
});

describe("instagramSuggestedRate", () => {
    it("prices 2500 per thousand median plays", () => {
        expect(instagramSuggestedRate(2000)).toBe(5000);
        expect(instagramSuggestedRate(1000)).toBe(2500);
    });

    it("truncates the fractional part instead of rounding", () => {
        expect(instagramSuggestedRate(1001)).toBe(2502);
        expect(instagramSuggestedRate(1999)).toBe(4997);
    });

    it("is 0 for no plays", () => {
        expect(instagramSuggestedRate(0)).toBe(0);
    });
});
