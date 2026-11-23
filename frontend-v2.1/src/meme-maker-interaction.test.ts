import { describe, expect, it } from "vitest";
import { beginImageInteraction, beginInteraction, clientToCanvasPoint, hitTestTextBoxes, IDLE_INTERACTION, updateImageInteraction, updateInteraction } from "./meme-maker-interaction";
import type { MemeTextBox, TextBoxMeasurement } from "./meme-renderer";

const box = (id: string, overrides: Partial<MemeTextBox> = {}): MemeTextBox => ({
  id, text: id, xPercent: 50, yPercent: 50, widthPercent: 40, fontSize: 40,
  fillColor: "white", strokeWidth: 3, strokeColor: "black", align: "center", fontPreset: "classic",
  fontWeight: "heavy", lineHeight: 1.15, letterSpacing: 0, backgroundEnabled: false, backgroundColor: "#000000",
  backgroundOpacity: .7, backgroundPadding: 12, backgroundRadius: 8, shadowEnabled: false, shadowColor: "#000000",
  shadowBlur: 4, shadowOffsetX: 2, shadowOffsetY: 2, ...overrides,
});

describe("image layer interaction", () => {
  const layer = { id: "image", sourceId: "source", frameX: 50, frameY: 50, frameWidth: 40, frameHeight: 30, contentX: 55, contentY: 45, contentScale: .6, opacity: 1 };

  it("moves frame and content together with center snap in object mode", () => {
    expect(updateImageInteraction(beginImageInteraction("moving", layer, { x: 0, y: 0 }), { x: 9, y: 10 }, 100, 100)).toEqual(expect.objectContaining({ frameX: 59, frameY: 60, contentX: 64, contentY: 55 }));
    expect(updateImageInteraction(beginImageInteraction("moving", { ...layer, frameX: 48 }, { x: 0, y: 0 }), { x: 1, y: 0 }, 100, 100)).toEqual(expect.objectContaining({ frameX: 50, contentX: 57 }));
  });

  it("pans only content in crop mode", () => {
    const panned = updateImageInteraction(beginImageInteraction("cropping", layer, { x: 0, y: 0 }), { x: 25, y: -10 }, 100, 100);
    expect(panned).toEqual(expect.objectContaining({ contentX: 80, contentY: 35 }));
    expect(panned).toEqual(expect.objectContaining({ frameX: 50, frameY: 50, frameWidth: 40, frameHeight: 30, contentScale: .6 }));
  });

  it("moves only the frame through the crop-mode frame handle", () => {
    const moved = updateImageInteraction(beginImageInteraction("moving-frame", layer, { x: 0, y: 0 }), { x: 10, y: -5 }, 100, 100);
    expect(moved).toEqual(expect.objectContaining({ frameX: 60, frameY: 45, contentX: 55, contentY: 45, contentScale: .6 }));
  });

  it("freely resizes only the frame from corners with a minimum size", () => {
    const resized = updateImageInteraction(beginImageInteraction("resizing", layer, { x: 0, y: 0 }, "se"), { x: 10, y: 20 }, 100, 100);
    expect(resized).toEqual(expect.objectContaining({ frameX: 55, frameY: 60, frameWidth: 50, frameHeight: 50, contentX: 55, contentY: 45, contentScale: .6 }));
    const minimum = updateImageInteraction(beginImageInteraction("resizing", layer, { x: 0, y: 0 }, "nw"), { x: 100, y: 100 }, 100, 100);
    expect(minimum?.frameWidth).toBe(5);
    expect(minimum?.frameHeight).toBe(5);
  });
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
