import { calculateBackgroundDrawRect, type MemeCanvasState } from "./meme-background";

export type TextBoxAlign = "left" | "center" | "right";
export type MemeColor = "white" | "black";
export type MemeFontPreset = "classic" | "chinese-bold" | "sans";

export interface MemeTextBox {
  id: string;
  text: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  fontSize: number;
  fillColor: MemeColor;
  strokeWidth: number;
  strokeColor: MemeColor;
  align: TextBoxAlign;
  fontPreset: MemeFontPreset;
}

export interface TextBoxBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface TextBoxMeasurement {
  lines: string[];
  lineHeight: number;
  bounds: TextBoxBounds;
  anchorX: number;
  centerY: number;
}

const FONT_PRESETS: Record<MemeFontPreset, { weight: number; family: string }> = {
  classic: { weight: 900, family: 'Impact, "Arial Black", sans-serif' },
  "chinese-bold": { weight: 700, family: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif' },
  sans: { weight: 700, family: 'Arial, "Microsoft YaHei", "PingFang SC", sans-serif' },
};

function splitToFit(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (!text) return [""];
  const chunks = text.match(/\s+|[^\s]+/gu) ?? [text];
  const lines: string[] = [];
  let line = "";

  const pushLongChunk = (chunk: string): string => {
    let remainder = "";
    for (const character of chunk) {
      const candidate = remainder + character;
      if (remainder && context.measureText(candidate).width > maxWidth) {
        lines.push(remainder.trimEnd());
        remainder = character;
      } else {
        remainder = candidate;
      }
    }
    return remainder;
  };

  for (const chunk of chunks) {
    const candidate = line + chunk;
    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else if (!/^\s+$/u.test(chunk) && context.measureText(chunk).width > maxWidth) {
      if (line.trim()) lines.push(line.trimEnd());
      line = pushLongChunk(chunk);
    } else {
      lines.push(line.trimEnd());
      line = chunk.trimStart();
    }
  }
  if (line || !lines.length) lines.push(line.trimEnd());
  return lines;
}

export function wrapTextBoxText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  return text.replace(/\r\n?/gu, "\n").split("\n").flatMap(line =>
    splitToFit(context, line, Math.max(1, maxWidth)),
  );
}

export function measureTextBox(
  context: CanvasRenderingContext2D,
  box: MemeTextBox,
  canvasWidth: number,
  canvasHeight: number,
): TextBoxMeasurement {
  const fontSize = Math.max(1, box.fontSize);
  const width = canvasWidth * Math.min(100, Math.max(10, box.widthPercent)) / 100;
  const lineHeight = fontSize * 1.15;
  const font = FONT_PRESETS[box.fontPreset];
  context.font = `${font.weight} ${fontSize}px ${font.family}`;
  const lines = wrapTextBoxText(context, box.text, width);
  const height = Math.max(lineHeight, lines.length * lineHeight);
  const halfHeight = height / 2;
  const desiredCenterY = canvasHeight * box.yPercent / 100;
  const centerY = Math.min(
    Math.max(desiredCenterY, halfHeight),
    Math.max(halfHeight, canvasHeight - halfHeight),
  );
  const desiredCenterX = canvasWidth * box.xPercent / 100;
  const halfWidth = width / 2;
  const centerX = Math.min(
    Math.max(desiredCenterX, halfWidth),
    Math.max(halfWidth, canvasWidth - halfWidth),
  );
  const left = centerX - halfWidth;
  const anchorX = box.align === "left" ? left : box.align === "right" ? left + width : centerX;
  return {
    lines,
    lineHeight,
    bounds: { left, top: centerY - halfHeight, right: left + width, bottom: centerY + halfHeight, width, height },
    anchorX,
    centerY,
  };
}

export function drawTextBox(
  context: CanvasRenderingContext2D,
  box: MemeTextBox,
  canvasWidth: number,
  canvasHeight: number,
): TextBoxMeasurement {
  context.save();
  const measurement = measureTextBox(context, box, canvasWidth, canvasHeight);
  context.textAlign = box.align;
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.fillStyle = box.fillColor === "black" ? "#000000" : "#ffffff";
  context.strokeStyle = box.strokeColor === "white" ? "#ffffff" : "#000000";
  context.lineWidth = Math.max(0, box.strokeWidth);
  const firstY = measurement.centerY - (measurement.lines.length - 1) * measurement.lineHeight / 2;
  if (box.text.trim()) {
    measurement.lines.forEach((line, index) => {
      const y = firstY + index * measurement.lineHeight;
      if (box.strokeWidth > 0) context.strokeText(line, measurement.anchorX, y);
      context.fillText(line, measurement.anchorX, y);
    });
  }
  context.restore();
  return measurement;
}

export function measureTextBoxes(
  context: CanvasRenderingContext2D,
  textBoxes: MemeTextBox[],
  canvasWidth: number,
  canvasHeight: number,
): Map<string, TextBoxMeasurement> {
  return new Map(textBoxes.map(box => [box.id, measureTextBox(context, box, canvasWidth, canvasHeight)]));
}

export function renderMemeCanvas(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  textBoxes: MemeTextBox[],
  sourceWidth: number,
  sourceHeight: number,
  canvasState?: MemeCanvasState,
): Map<string, TextBoxMeasurement> {
  const state = canvasState ?? {
    aspectPreset: "original" as const, outputWidth: sourceWidth, outputHeight: sourceHeight,
    backgroundScale: 1, backgroundOffsetX: 0, backgroundOffsetY: 0,
  };
  const { outputWidth: width, outputHeight: height } = state;
  if (width <= 0 || height <= 0) throw new Error("模板图片尺寸无效。");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法创建 Canvas 画布。");
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  const rect = calculateBackgroundDrawRect(sourceWidth, sourceHeight, state);
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  return new Map(textBoxes.map(box => [box.id, drawTextBox(context, box, width, height)]));
}
