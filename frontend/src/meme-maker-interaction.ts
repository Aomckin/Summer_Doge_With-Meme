import type { MemeTextBox, TextBoxMeasurement } from "./meme-renderer";

export interface CanvasPoint { x: number; y: number }

export type InteractionState =
  | { type: "idle" }
  | { type: "dragging" | "resizing-left" | "resizing-right"; textBoxId: string; start: CanvasPoint; original: MemeTextBox };

export const IDLE_INTERACTION: InteractionState = { type: "idle" };
export const CENTER_SNAP_THRESHOLD_PERCENT = 1.25;

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
