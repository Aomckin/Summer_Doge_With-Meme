export interface MemeImageLayer {
  id: string;
  sourceId: string;
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
  contentX: number;
  contentY: number;
  contentScale: number;
  opacity: number;
}

export interface MemeImageSource {
  id: string;
  type: "local" | "background" | "vault";
  image: CanvasImageSource;
  naturalWidth: number;
  naturalHeight: number;
  filename: string;
  dispose?(): void;
}

export interface ImageRect { x: number; y: number; width: number; height: number }
export type ImageContentTransform = Pick<MemeImageLayer, "contentX" | "contentY" | "contentScale">;
export type ImageLayerMode = "fit" | "fill";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function calculateImageLayerFit(
  layer: MemeImageLayer,
  source: MemeImageSource,
  canvasWidth: number,
  canvasHeight: number,
): ImageContentTransform {
  const frame = calculateImageLayerFrame(layer, canvasWidth, canvasHeight);
  const pixelScale = Math.min(frame.width / source.naturalWidth, frame.height / source.naturalHeight);
  return {
    contentX: layer.frameX,
    contentY: layer.frameY,
    contentScale: source.naturalWidth * pixelScale / canvasWidth,
  };
}

export function calculateImageLayerFill(
  layer: MemeImageLayer,
  source: MemeImageSource,
  canvasWidth: number,
  canvasHeight: number,
): ImageContentTransform {
  const frame = calculateImageLayerFrame(layer, canvasWidth, canvasHeight);
  const pixelScale = Math.max(frame.width / source.naturalWidth, frame.height / source.naturalHeight);
  return {
    contentX: layer.frameX,
    contentY: layer.frameY,
    contentScale: source.naturalWidth * pixelScale / canvasWidth,
  };
}

export function calculateImageContentRect(
  layer: MemeImageLayer,
  source: MemeImageSource,
  canvasWidth: number,
  canvasHeight: number,
): ImageRect {
  const width = clamp(layer.contentScale, 0.01, 5) * canvasWidth;
  const height = width * source.naturalHeight / source.naturalWidth;
  return {
    x: layer.contentX / 100 * canvasWidth - width / 2,
    y: layer.contentY / 100 * canvasHeight - height / 2,
    width,
    height,
  };
}

export function calculateImageLayerFrame(layer: MemeImageLayer, canvasWidth: number, canvasHeight: number): ImageRect {
  const width = layer.frameWidth / 100 * canvasWidth;
  const height = layer.frameHeight / 100 * canvasHeight;
  return {
    x: layer.frameX / 100 * canvasWidth - width / 2,
    y: layer.frameY / 100 * canvasHeight - height / 2,
    width,
    height,
  };
}

export function applyImageLayerMode(
  layer: MemeImageLayer,
  source: MemeImageSource,
  canvasWidth: number,
  canvasHeight: number,
  mode: ImageLayerMode,
): MemeImageLayer {
  const transform = mode === "fit"
    ? calculateImageLayerFit(layer, source, canvasWidth, canvasHeight)
    : calculateImageLayerFill(layer, source, canvasWidth, canvasHeight);
  return { ...layer, ...transform };
}

export function scaleImageLayerGeometry(layer: MemeImageLayer, requestedContentScale: number): MemeImageLayer {
  const currentScale = Math.max(0.01, layer.contentScale);
  const targetScale = clamp(requestedContentScale, 0.1, 5);
  const ratio = targetScale / currentScale;
  return {
    ...layer,
    frameWidth: layer.frameWidth * ratio,
    frameHeight: layer.frameHeight * ratio,
    contentX: layer.frameX + (layer.contentX - layer.frameX) * ratio,
    contentY: layer.frameY + (layer.contentY - layer.frameY) * ratio,
    contentScale: targetScale,
  };
}

export function createDefaultImageLayer(
  id: string,
  source: MemeImageSource,
  canvasWidth: number,
  canvasHeight: number,
  offsetPercent = 0,
): MemeImageLayer {
  const frameWidth = 40;
  const frameHeight = clamp(
    frameWidth * canvasWidth / Math.max(1, canvasHeight) * source.naturalHeight / source.naturalWidth,
    10,
    80,
  );
  const layer: MemeImageLayer = {
    id,
    sourceId: source.id,
    frameX: clamp(50 + offsetPercent, frameWidth / 2, 100 - frameWidth / 2),
    frameY: clamp(50 + offsetPercent, frameHeight / 2, 100 - frameHeight / 2),
    frameWidth,
    frameHeight,
    contentX: 50 + offsetPercent,
    contentY: 50 + offsetPercent,
    contentScale: frameWidth / 100,
    opacity: 1,
  };
  return applyImageLayerMode(layer, source, canvasWidth, canvasHeight, "fill");
}

export function hitTestImageLayers(
  layers: MemeImageLayer[],
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
): string | null {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const frame = calculateImageLayerFrame(layers[index], canvasWidth, canvasHeight);
    if (x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height) return layers[index].id;
  }
  return null;
}
