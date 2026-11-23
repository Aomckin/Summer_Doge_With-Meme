import { describe, expect, it } from "vitest";
import { applyImageLayout, calculateImageLayoutFrames } from "./meme-maker-layout";
import type { MemeImageLayer, MemeImageSource } from "./meme-image-layer";

describe("Meme image quick layouts", () => {
  it("calculates two-image horizontal and vertical splits", () => {
    expect(calculateImageLayoutFrames("split-columns", 2)).toEqual([
      { frameX: 25, frameY: 50, frameWidth: 50, frameHeight: 100 },
      { frameX: 75, frameY: 50, frameWidth: 50, frameHeight: 100 },
    ]);
    expect(calculateImageLayoutFrames("split-rows", 2)).toEqual([
      { frameX: 50, frameY: 25, frameWidth: 100, frameHeight: 50 },
      { frameX: 50, frameY: 75, frameWidth: 100, frameHeight: 50 },
    ]);
  });

  it("calculates three-image strips and asymmetric layouts", () => {
    expect(calculateImageLayoutFrames("three-columns", 3).map(frame => frame.frameX)).toEqual([100 / 6, 50, 500 / 6]);
    expect(calculateImageLayoutFrames("three-rows", 3).map(frame => frame.frameY)).toEqual([100 / 6, 50, 500 / 6]);
    expect(calculateImageLayoutFrames("two-top-one-bottom", 3)[2]).toEqual({ frameX: 50, frameY: 75, frameWidth: 100, frameHeight: 50 });
    expect(calculateImageLayoutFrames("one-top-two-bottom", 3)[0]).toEqual({ frameX: 50, frameY: 25, frameWidth: 100, frameHeight: 50 });
  });

  it("calculates a four-image grid and limits generic strips to six", () => {
    expect(calculateImageLayoutFrames("grid-2x2", 4)).toHaveLength(4);
    expect(calculateImageLayoutFrames("tile-columns", 9)).toHaveLength(6);
    expect(calculateImageLayoutFrames("tile-rows", 9)).toHaveLength(6);
  });

  it("updates frames and explicitly fills content while preserving opacity and order", () => {
    const layers: MemeImageLayer[] = [0, 1].map(index => ({
      id: `layer-${index}`, sourceId: `source-${index}`,
      frameX: 50, frameY: 50, frameWidth: 20, frameHeight: 20,
      contentX: 12, contentY: 34, contentScale: 0.1, opacity: 0.4 + index * 0.1,
    }));
    const sources = new Map<string, MemeImageSource>(layers.map((layer, index) => [layer.sourceId, {
      id: layer.sourceId, type: "local", image: {} as CanvasImageSource,
      naturalWidth: index ? 400 : 800, naturalHeight: 600, filename: `${index}.png`,
    }]));
    const result = applyImageLayout(layers, sources, "split-columns", 1000, 500);
    expect(result.map(layer => layer.id)).toEqual(["layer-0", "layer-1"]);
    expect(result[0]).toMatchObject({ frameX: 25, frameY: 50, frameWidth: 50, frameHeight: 100, contentX: 25, contentY: 50, opacity: 0.4 });
    expect(result[0].contentScale).toBeCloseTo(2 / 3);
    expect(result[1]).toMatchObject({ frameX: 75, contentX: 75, contentY: 50, opacity: 0.5 });
  });
});
