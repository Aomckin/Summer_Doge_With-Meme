import type { MemeTextBox, TextBoxMeasurement } from "./meme-renderer";
import type { MemeImageLayer } from "./meme-image-layer";

export interface CanvasPoint { x: number; y: number }

export type InteractionState =
  | { type: "idle" }
  | { type: "dragging" | "resizing-left" | "resizing-right"; textBoxId: string; start: CanvasPoint; original: MemeTextBox };

export const IDLE_INTERACTION: InteractionState = { type: "idle" };
export const CENTER_SNAP_THRESHOLD_PERCENT = 1.25;
export type ImageResizeHandle = "nw" | "ne" | "sw" | "se";
export type ImageInteractionState =
  | { type: "idle" }
  | { type: "moving"; imageLayerId: string; start: CanvasPoint; original: MemeImageLayer }
  | { type: "moving-frame"; imageLayerId: string; start: CanvasPoint; original: MemeImageLayer }
  | { type: "cropping"; imageLayerId: string; start: CanvasPoint; original: MemeImageLayer }
  | { type: "resizing"; imageLayerId: string; start: CanvasPoint; original: MemeImageLayer; handle: ImageResizeHandle };
export const IDLE_IMAGE_INTERACTION: ImageInteractionState = { type: "idle" };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function clientToCanvasPoint(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  canvasWidth: number,
  canvasHeight: number,
): CanvasPoint {
  return {
    x: (clientX - rect.left) * canvasWidth / Math.max(1, rect.width),
    y: (clientY - rect.top) * canvasHeight / Math.max(1, rect.height),
  };
}

export function hitTestTextBoxes(
  textBoxes: MemeTextBox[],
  measurements: Map<string, TextBoxMeasurement>,
  point: CanvasPoint,
): string | null {
  for (let index = textBoxes.length - 1; index >= 0; index -= 1) {
    const box = textBoxes[index];
    const bounds = measurements.get(box.id)?.bounds;
    if (bounds && point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom) {
      return box.id;
    }
  }
  return null;
}

export function beginInteraction(
  type: Exclude<InteractionState["type"], "idle">,
  box: MemeTextBox,
  start: CanvasPoint,
): InteractionState {
  return { type, textBoxId: box.id, start, original: { ...box } };
}

export function updateInteraction(
  state: InteractionState,
  point: CanvasPoint,
  canvasWidth: number,
  canvasHeight: number,
): MemeTextBox | null {
  if (state.type === "idle") return null;
  const deltaXPercent = (point.x - state.start.x) / canvasWidth * 100;
  const deltaYPercent = (point.y - state.start.y) / canvasHeight * 100;
  const original = state.original;
  if (state.type === "dragging") {
    const halfWidth = original.widthPercent / 2;
    const xPercent = clamp(original.xPercent + deltaXPercent, halfWidth, 100 - halfWidth);
    const yPercent = clamp(original.yPercent + deltaYPercent, 0, 100);
    return {
      ...original,
      xPercent: Math.abs(xPercent - 50) <= CENTER_SNAP_THRESHOLD_PERCENT ? 50 : xPercent,
      yPercent: Math.abs(yPercent - 50) <= CENTER_SNAP_THRESHOLD_PERCENT ? 50 : yPercent,
    };
  }

  const originalLeft = original.xPercent - original.widthPercent / 2;
  const originalRight = original.xPercent + original.widthPercent / 2;
  if (state.type === "resizing-left") {
    const left = clamp(originalLeft + deltaXPercent, 0, originalRight - 10);
    return { ...original, xPercent: (left + originalRight) / 2, widthPercent: originalRight - left };
  }
  const right = clamp(originalRight + deltaXPercent, originalLeft + 10, 100);
  return { ...original, xPercent: (originalLeft + right) / 2, widthPercent: right - originalLeft };
}

export function beginImageInteraction(
  type: "moving" | "moving-frame" | "cropping",
  layer: MemeImageLayer,
  start: CanvasPoint,
): ImageInteractionState;
export function beginImageInteraction(
  type: "resizing",
  layer: MemeImageLayer,
  start: CanvasPoint,
  handle: ImageResizeHandle,
): ImageInteractionState;
export function beginImageInteraction(
  type: "moving" | "moving-frame" | "cropping" | "resizing",
  layer: MemeImageLayer,
  start: CanvasPoint,
  handle?: ImageResizeHandle,
): ImageInteractionState {
  return type === "resizing"
    ? { type, imageLayerId: layer.id, start, original: { ...layer }, handle: handle ?? "se" }
    : { type, imageLayerId: layer.id, start, original: { ...layer } };
}

export function updateImageInteraction(
  state: ImageInteractionState,
  point: CanvasPoint,
  canvasWidth: number,
  canvasHeight: number,
): MemeImageLayer | null {
  if (state.type === "idle") return null;
  const deltaX = (point.x - state.start.x) / canvasWidth * 100;
  const deltaY = (point.y - state.start.y) / canvasHeight * 100;
  const original = state.original;
  if (state.type === "cropping") {
    return { ...original, contentX: clamp(original.contentX + deltaX, -500, 500), contentY: clamp(original.contentY + deltaY, -500, 500) };
  }
  if (state.type === "moving" || state.type === "moving-frame") {
    const unclampedX = clamp(original.frameX + deltaX, original.frameWidth / 2, 100 - original.frameWidth / 2);
    const unclampedY = clamp(original.frameY + deltaY, original.frameHeight / 2, 100 - original.frameHeight / 2);
    const frameX = Math.abs(unclampedX - 50) <= CENTER_SNAP_THRESHOLD_PERCENT ? 50 : unclampedX;
    const frameY = Math.abs(unclampedY - 50) <= CENTER_SNAP_THRESHOLD_PERCENT ? 50 : unclampedY;
    const moved = {
      ...original,
      frameX,
      frameY,
    };
    return state.type === "moving-frame" ? moved : {
      ...moved,
      contentX: original.contentX + frameX - original.frameX,
      contentY: original.contentY + frameY - original.frameY,
    };
  }
  const left = original.frameX - original.frameWidth / 2;
  const right = original.frameX + original.frameWidth / 2;
  const top = original.frameY - original.frameHeight / 2;
  const bottom = original.frameY + original.frameHeight / 2;
  const nextLeft = state.handle.includes("w") ? clamp(left + deltaX, 0, right - 5) : left;
  const nextRight = state.handle.includes("e") ? clamp(right + deltaX, left + 5, 100) : right;
  const nextTop = state.handle.includes("n") ? clamp(top + deltaY, 0, bottom - 5) : top;
  const nextBottom = state.handle.includes("s") ? clamp(bottom + deltaY, top + 5, 100) : bottom;
  return {
    ...original,
    frameX: (nextLeft + nextRight) / 2,
    frameY: (nextTop + nextBottom) / 2,
    frameWidth: nextRight - nextLeft,
    frameHeight: nextBottom - nextTop,
  };
}
