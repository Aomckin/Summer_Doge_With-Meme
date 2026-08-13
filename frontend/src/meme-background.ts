export type MemeAspectPreset = "original" | "1:1" | "4:3" | "3:4" | "16:9";

export interface MemeCanvasState {
  aspectPreset: MemeAspectPreset;
  outputWidth: number;
  outputHeight: number;
  backgroundScale: number;
  backgroundOffsetX: number;
  backgroundOffsetY: number;
}

export interface BackgroundDrawRect { x: number; y: number; width: number; height: number }

const RATIOS: Record<Exclude<MemeAspectPreset, "original">, number> = {
  "1:1": 1,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "16:9": 16 / 9,
};

export function calculateOutputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  preset: MemeAspectPreset,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error("底图尺寸无效。");
  if (preset === "original") return { width: sourceWidth, height: sourceHeight };
  const ratio = RATIOS[preset];
  if (sourceWidth / sourceHeight >= ratio) {
    return { width: Math.max(1, Math.round(sourceHeight * ratio)), height: sourceHeight };
  }
  return { width: sourceWidth, height: Math.max(1, Math.round(sourceWidth / ratio)) };
}

export function calculateFitScale(sourceWidth: number, sourceHeight: number, outputWidth: number, outputHeight: number): number {
  return Math.min(outputWidth / sourceWidth, outputHeight / sourceHeight);
}

export function calculateFillScale(sourceWidth: number, sourceHeight: number, outputWidth: number, outputHeight: number): number {
  return Math.max(outputWidth / sourceWidth, outputHeight / sourceHeight);
}

export function calculateBackgroundDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  state: Pick<MemeCanvasState, "outputWidth" | "outputHeight" | "backgroundScale" | "backgroundOffsetX" | "backgroundOffsetY">,
): BackgroundDrawRect {
  const width = sourceWidth * state.backgroundScale;
  const height = sourceHeight * state.backgroundScale;
  return {
    x: (state.outputWidth - width) / 2 + state.outputWidth * state.backgroundOffsetX / 100,
    y: (state.outputHeight - height) / 2 + state.outputHeight * state.backgroundOffsetY / 100,
    width,
    height,
  };
}

export function resetBackgroundTransform(
  sourceWidth: number,
  sourceHeight: number,
  aspectPreset: MemeAspectPreset,
  mode: "fit" | "fill" = "fill",
): MemeCanvasState {
  const output = calculateOutputDimensions(sourceWidth, sourceHeight, aspectPreset);
  return {
    aspectPreset,
    outputWidth: output.width,
    outputHeight: output.height,
    backgroundScale: mode === "fit"
      ? calculateFitScale(sourceWidth, sourceHeight, output.width, output.height)
      : calculateFillScale(sourceWidth, sourceHeight, output.width, output.height),
    backgroundOffsetX: 0,
    backgroundOffsetY: 0,
  };
}
