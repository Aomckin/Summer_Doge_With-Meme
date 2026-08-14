import { describe, expect, it } from "vitest";
import {
  applyImageLayerMode,
  calculateImageContentRect,
  calculateImageLayerFrame,
  createDefaultImageLayer,
  hitTestImageLayers,
  type MemeImageLayer,
  type MemeImageSource,
} from "./meme-image-layer";

const source: MemeImageSource = {
  id: "source", type: "local", image: {} as CanvasImageSource,
  naturalWidth: 800, naturalHeight: 400, filename: "wide.png",
};
const layer: MemeImageLayer = {
  id: "layer", sourceId: source.id, frameX: 50, frameY: 50,
  frameWidth: 50, frameHeight: 50, contentX: 60, contentY: 40, contentScale: .6, opacity: 1,
};

describe("Meme image layer geometry", () => {
  it("creates a centered default frame without stretching the source", () => {
    const created = createDefaultImageLayer("new", source, 1000, 500);
    expect(created).toEqual(expect.objectContaining({ frameX: 50, frameY: 50, frameWidth: 40, frameHeight: 40, contentX: 50, contentY: 50, contentScale: .4 }));
  });

  it("calculates frame and fill content rectangles in canvas pixels", () => {
    expect(calculateImageLayerFrame(layer, 1000, 600)).toEqual({ x: 250, y: 150, width: 500, height: 300 });
    expect(calculateImageContentRect(layer, source, 1000, 600)).toEqual({ x: 300, y: 90, width: 600, height: 300 });
  });

  it("changes content transform only for explicit fit or fill", () => {
    const fit = applyImageLayerMode(layer, source, 1000, 600, "fit");
    expect(fit).toEqual(expect.objectContaining({ frameX: 50, frameY: 50, frameWidth: 50, frameHeight: 50, contentX: 50, contentY: 50, contentScale: .5 }));
    expect(calculateImageContentRect(fit, source, 1000, 600)).toEqual({ x: 250, y: 175, width: 500, height: 250 });
    expect(applyImageLayerMode(fit, source, 1000, 600, "fill")).toEqual(expect.objectContaining({ contentX: 50, contentY: 50, contentScale: .6 }));
  });

  it("keeps absolute content position and scale when the frame moves or resizes", () => {
    const contentBefore = calculateImageContentRect(layer, source, 1000, 600);
    const resized = { ...layer, frameX: 60, frameY: 55, frameWidth: 30, frameHeight: 70 };
    expect(calculateImageContentRect(resized, source, 1000, 600)).toEqual(contentBefore);
    expect(resized).toEqual(expect.objectContaining({ contentX: layer.contentX, contentY: layer.contentY, contentScale: layer.contentScale }));
  });

  it("pans and zooms content without changing the frame", () => {
    const panned = { ...layer, contentX: 25, contentY: 70 };
    const zoomed = { ...panned, contentScale: 1.2 };
    expect(calculateImageLayerFrame(panned, 1000, 600)).toEqual(calculateImageLayerFrame(layer, 1000, 600));
    expect(calculateImageLayerFrame(zoomed, 1000, 600)).toEqual(calculateImageLayerFrame(layer, 1000, 600));
    expect(calculateImageContentRect(panned, source, 1000, 600)).not.toEqual(calculateImageContentRect(layer, source, 1000, 600));
    expect(calculateImageContentRect(zoomed, source, 1000, 600).width).toBe(1200);
  });

  it("hit-tests topmost layers", () => {
    expect(hitTestImageLayers([layer, { ...layer, id: "top" }], 500, 300, 1000, 600)).toBe("top");
    expect(hitTestImageLayers([layer], 10, 10, 1000, 600)).toBeNull();
  });
});
