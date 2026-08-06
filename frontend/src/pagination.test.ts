import { describe, expect, it } from "vitest";

import { buildPaginationTokens, clampPage } from "./pagination";

describe("clampPage", () => {
  it("clamps pages and treats an empty result as page one", () => {
    expect(clampPage(-4, 10)).toBe(1);
    expect(clampPage(14, 10)).toBe(10);
    expect(clampPage(3.9, 10)).toBe(3);
    expect(clampPage(9, 0)).toBe(1);
  });
});

describe("buildPaginationTokens", () => {
  it("shows every page for small totals", () => {
    expect(buildPaginationTokens(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps both ends and adds ellipses around the current window", () => {
    expect(buildPaginationTokens(53, 164)).toEqual([
      1, "ellipsis", 51, 52, 53, 54, 55, "ellipsis", 164,
    ]);
  });

  it("does not emit redundant ellipses near an edge", () => {
    expect(buildPaginationTokens(2, 12)).toEqual([1, 2, 3, 4, "ellipsis", 12]);
  });
});
