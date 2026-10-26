import { describe, expect, it } from "vitest";
import { median, tiktokSuggestedRate } from "../lib/rates";

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

describe("tiktokSuggestedRate", () => {
    it("prices 2500 per thousand median views", () => {
        expect(tiktokSuggestedRate(2000)).toBe(5000);
        expect(tiktokSuggestedRate(1000)).toBe(2500);
    });

    it("keeps the fractional part instead of truncating", () => {
        expect(tiktokSuggestedRate(1001)).toBeCloseTo(2502.5, 6);
    });

    it("is 0 for no views", () => {
        expect(tiktokSuggestedRate(0)).toBe(0);
    });
});
