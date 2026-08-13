import { describe, expect, it } from "vitest";
import {
  calculateBackgroundDrawRect,
  calculateFillScale,
  calculateFitScale,
  calculateOutputDimensions,
  resetBackgroundTransform,
} from "./meme-background";

describe("Meme background geometry", () => {
  it("keeps natural dimensions for original and creates exact preset ratios without upscaling", () => {
    expect(calculateOutputDimensions(800, 600, "original")).toEqual({ width: 800, height: 600 });
    expect(calculateOutputDimensions(800, 600, "1:1")).toEqual({ width: 600, height: 600 });
    const wide = calculateOutputDimensions(800, 600, "16:9");
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 2);
    expect(wide.width).toBeLessThanOrEqual(800);
    expect(wide.height).toBeLessThanOrEqual(600);
  });

  it("calculates contain and cover scales", () => {
    expect(calculateFitScale(800, 400, 400, 400)).toBe(0.5);
    expect(calculateFillScale(800, 400, 400, 400)).toBe(1);
    const fit = calculateBackgroundDrawRect(800, 400, resetBackgroundTransform(800, 400, "1:1", "fit"));
    expect(fit).toEqual({ x: 0, y: 100, width: 400, height: 200 });
    const fill = calculateBackgroundDrawRect(800, 400, resetBackgroundTransform(800, 400, "1:1", "fill"));
    expect(fill).toEqual({ x: -200, y: 0, width: 800, height: 400 });
  });

  it("applies scale and output-percent offsets around canvas center", () => {
    const rect = calculateBackgroundDrawRect(100, 50, {
      outputWidth: 200, outputHeight: 100, backgroundScale: 2, backgroundOffsetX: 10, backgroundOffsetY: -5,
    });
    expect(rect).toEqual({ x: 20, y: -5, width: 200, height: 100 });
  });
});
