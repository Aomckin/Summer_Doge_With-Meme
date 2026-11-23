import {
  applyImageLayerMode,
  type MemeImageLayer,
  type MemeImageSource,
} from "./meme-image-layer";

export type MemeImageLayout =
  | "split-columns"
  | "split-rows"
  | "three-columns"
  | "three-rows"
  | "two-top-one-bottom"
  | "one-top-two-bottom"
  | "grid-2x2"
  | "tile-columns"
  | "tile-rows";

export interface MemeImageFrame {
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
}

const exactCounts: Partial<Record<MemeImageLayout, number>> = {
  "split-columns": 2,
  "split-rows": 2,
  "three-columns": 3,
  "three-rows": 3,
  "two-top-one-bottom": 3,
  "one-top-two-bottom": 3,
  "grid-2x2": 4,
};

function equalTiles(count: number, columns: boolean): MemeImageFrame[] {
  return Array.from({ length: count }, (_, index) => columns
    ? { frameX: (index + 0.5) * 100 / count, frameY: 50, frameWidth: 100 / count, frameHeight: 100 }
    : { frameX: 50, frameY: (index + 0.5) * 100 / count, frameWidth: 100, frameHeight: 100 / count });
}

export function layoutFrameCount(layout: MemeImageLayout, imageCount: number): number {
  const exact = exactCounts[layout];
  return exact ? Math.min(exact, imageCount) : Math.min(6, imageCount);
}

export function canApplyImageLayout(layout: MemeImageLayout, imageCount: number): boolean {
  const exact = exactCounts[layout];
  return exact ? imageCount >= exact : imageCount > 0;
}

export function calculateImageLayoutFrames(layout: MemeImageLayout, imageCount: number): MemeImageFrame[] {
  if (!canApplyImageLayout(layout, imageCount)) return [];
  switch (layout) {
    case "split-columns": return equalTiles(2, true);
    case "split-rows": return equalTiles(2, false);
    case "three-columns": return equalTiles(3, true);
    case "three-rows": return equalTiles(3, false);
    case "two-top-one-bottom": return [
      { frameX: 25, frameY: 25, frameWidth: 50, frameHeight: 50 },
      { frameX: 75, frameY: 25, frameWidth: 50, frameHeight: 50 },
      { frameX: 50, frameY: 75, frameWidth: 100, frameHeight: 50 },
    ];
    case "one-top-two-bottom": return [
      { frameX: 50, frameY: 25, frameWidth: 100, frameHeight: 50 },
      { frameX: 25, frameY: 75, frameWidth: 50, frameHeight: 50 },
      { frameX: 75, frameY: 75, frameWidth: 50, frameHeight: 50 },
    ];
    case "grid-2x2": return [
      { frameX: 25, frameY: 25, frameWidth: 50, frameHeight: 50 },
      { frameX: 75, frameY: 25, frameWidth: 50, frameHeight: 50 },
      { frameX: 25, frameY: 75, frameWidth: 50, frameHeight: 50 },
      { frameX: 75, frameY: 75, frameWidth: 50, frameHeight: 50 },
    ];
    case "tile-columns": return equalTiles(Math.min(6, imageCount), true);
    case "tile-rows": return equalTiles(Math.min(6, imageCount), false);
  }
}

export function applyImageLayout(
  layers: MemeImageLayer[],
  sources: ReadonlyMap<string, MemeImageSource>,
  layout: MemeImageLayout,
  canvasWidth: number,
  canvasHeight: number,
): MemeImageLayer[] {
  const frames = calculateImageLayoutFrames(layout, layers.length);
  return layers.map((layer, index) => {
    const frame = frames[index];
    const source = sources.get(layer.sourceId);
    if (!frame || !source) return { ...layer };
    return applyImageLayerMode({ ...layer, ...frame }, source, canvasWidth, canvasHeight, "fill");
  });
}
