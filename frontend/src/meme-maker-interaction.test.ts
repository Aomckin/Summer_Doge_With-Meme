import { describe, expect, it } from "vitest";
import { beginInteraction, clientToCanvasPoint, hitTestTextBoxes, IDLE_INTERACTION, updateInteraction } from "./meme-maker-interaction";
import type { MemeTextBox, TextBoxMeasurement } from "./meme-renderer";

const box = (id: string, overrides: Partial<MemeTextBox> = {}): MemeTextBox => ({
  id, text: id, xPercent: 50, yPercent: 50, widthPercent: 40, fontSize: 40,
  fillColor: "white", strokeWidth: 3, strokeColor: "black", align: "center", fontPreset: "classic",
  fontWeight: "heavy", lineHeight: 1.15, letterSpacing: 0, backgroundEnabled: false, backgroundColor: "#000000",
  backgroundOpacity: .7, backgroundPadding: 12, backgroundRadius: 8, shadowEnabled: false, shadowColor: "#000000",
  shadowBlur: 4, shadowOffsetX: 2, shadowOffsetY: 2, ...overrides,
});
const measurement = (left: number, top: number, right: number, bottom: number): TextBoxMeasurement => ({
  lines: ["x"], lineHeight: 20, anchorX: 0, centerY: 0,
  bounds: { left, top, right, bottom, width: right - left, height: bottom - top }, lineWidths: [right - left],
  contentBounds: { left, top, right, bottom, width: right - left, height: bottom - top },
});

describe("Meme Maker interaction", () => {
  it("maps client coordinates to original canvas coordinates", () => {
    expect(clientToCanvasPoint(60, 45, { left: 10, top: 20, width: 100, height: 50 }, 800, 600)).toEqual({ x: 400, y: 300 });
  });

  it("hit-tests from the last visual layer and returns null for blank space", () => {
    const boxes = [box("back"), box("front")];
    const measurements = new Map([["back", measurement(0, 0, 100, 100)], ["front", measurement(20, 20, 80, 80)]]);
    expect(hitTestTextBoxes(boxes, measurements, { x: 50, y: 50 })).toBe("front");
    expect(hitTestTextBoxes(boxes, measurements, { x: 120, y: 120 })).toBeNull();
  });

  it("drags x/y and clamps the box center to the canvas", () => {
    const state = beginInteraction("dragging", box("one"), { x: 400, y: 300 });
    expect(updateInteraction(state, { x: 480, y: 360 }, 800, 600)).toEqual(expect.objectContaining({ xPercent: 60, yPercent: 60 }));
    expect(updateInteraction(state, { x: -1000, y: -1000 }, 800, 600)).toEqual(expect.objectContaining({ xPercent: 20, yPercent: 0 }));
  });

  it("resizes left and right handles with intuitive edge anchoring", () => {
    const original = box("one");
    const left = updateInteraction(beginInteraction("resizing-left", original, { x: 0, y: 0 }), { x: 80, y: 0 }, 800, 600)!;
    expect(left).toEqual(expect.objectContaining({ xPercent: 55, widthPercent: 30 }));
    const right = updateInteraction(beginInteraction("resizing-right", original, { x: 0, y: 0 }), { x: -80, y: 0 }, 800, 600)!;
    expect(right).toEqual(expect.objectContaining({ xPercent: 45, widthPercent: 30 }));
  });

  it("returns null after interaction returns to idle", () => {
    expect(updateInteraction(IDLE_INTERACTION, { x: 1, y: 1 }, 100, 100)).toBeNull();
  });

  it("snaps dragging to canvas centers only inside the threshold", () => {
    const original = box("one", { xPercent: 45, yPercent: 45 });
    const state = beginInteraction("dragging", original, { x: 0, y: 0 });
    expect(updateInteraction(state, { x: 32, y: 24 }, 800, 600)).toEqual(expect.objectContaining({ xPercent: 50, yPercent: 50 }));
    expect(updateInteraction(state, { x: 16, y: 12 }, 800, 600)).toEqual(expect.objectContaining({ xPercent: 47, yPercent: 47 }));
  });
});
