import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const read = (relative: string): string => readFileSync(resolve(__dirname, relative), "utf8");

it("keeps lib/social-errors.ts identical to the refresh-instagram-rates copy", () => {
    expect(read("../lib/social-errors.ts")).toBe(read("../../refresh-instagram-rates/lib/social-errors.ts"));
});
