import { calculateBackgroundDrawRect, type MemeCanvasState } from "./meme-background";
import {
  calculateImageContentRect,
  calculateImageLayerFrame,
  type MemeImageLayer,
  type MemeImageSource,
} from "./meme-image-layer";

export type TextBoxAlign = "left" | "center" | "right";
export type MemeFontPreset = "classic" | "chinese-bold" | "sans";
export type MemeFontWeight = "normal" | "bold" | "heavy";

export interface MemeTextBox {
  id: string;
  text: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  fontSize: number;
  fillColor: string;
  strokeWidth: number;
  strokeColor: string;
  align: TextBoxAlign;
  fontPreset: MemeFontPreset;
  fontWeight: MemeFontWeight;
  lineHeight: number;
  letterSpacing: number;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  backgroundPadding: number;
  backgroundRadius: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
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
  lineWidths: number[];
  contentBounds: TextBoxBounds;
}

const FONT_PRESETS: Record<MemeFontPreset, { weight: number; family: string }> = {
  classic: { weight: 900, family: 'Impact, "Arial Black", sans-serif' },
  "chinese-bold": { weight: 700, family: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif' },
  sans: { weight: 700, family: 'Arial, "Microsoft YaHei", "PingFang SC", sans-serif' },
};

function measuredWidth(context: CanvasRenderingContext2D, text: string, letterSpacing: number): number {
  return context.measureText(text).width + Math.max(0, [...text].length - 1) * letterSpacing;
}

function splitToFit(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  letterSpacing: number,
): string[] {
  if (!text) return [""];
  const chunks = text.match(/\s+|[^\s]+/gu) ?? [text];
  const lines: string[] = [];
  let line = "";

  const pushLongChunk = (chunk: string): string => {
    let remainder = "";
    for (const character of chunk) {
      const candidate = remainder + character;
      if (remainder && measuredWidth(context, candidate, letterSpacing) > maxWidth) {
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
    if (measuredWidth(context, candidate, letterSpacing) <= maxWidth) {
      line = candidate;
    } else if (!/^\s+$/u.test(chunk) && measuredWidth(context, chunk, letterSpacing) > maxWidth) {
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
  letterSpacing = 0,
): string[] {
  return text.replace(/\r\n?/gu, "\n").split("\n").flatMap(line =>
    splitToFit(context, line, Math.max(1, maxWidth), letterSpacing),
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
  const lineHeight = fontSize * Math.min(2, Math.max(0.8, box.lineHeight));
  const font = FONT_PRESETS[box.fontPreset];
  const weight = box.fontWeight === "normal" ? 400 : box.fontWeight === "bold" ? 700 : 900;
  context.font = `${weight || font.weight} ${fontSize}px ${font.family}`;
  const lines = wrapTextBoxText(context, box.text, width, box.letterSpacing);
  const lineWidths = lines.map(line => measuredWidth(context, line, box.letterSpacing));
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
  const contentWidth = Math.max(0, ...lineWidths);
  const contentLeft = box.align === "left" ? anchorX : box.align === "right" ? anchorX - contentWidth : anchorX - contentWidth / 2;
  return {
    lines,
    lineWidths,
    lineHeight,
    bounds: { left, top: centerY - halfHeight, right: left + width, bottom: centerY + halfHeight, width, height },
    anchorX,
    centerY,
    contentBounds: { left: contentLeft, top: centerY - halfHeight, right: contentLeft + contentWidth, bottom: centerY + halfHeight, width: contentWidth, height },
  };
}

function roundedRect(context: CanvasRenderingContext2D, left: number, top: number, width: number, height: number, radius: number): void {
  const r = Math.min(Math.max(0, radius), width / 2, height / 2);
  context.beginPath(); context.moveTo(left + r, top); context.lineTo(left + width - r, top);
  context.quadraticCurveTo(left + width, top, left + width, top + r); context.lineTo(left + width, top + height - r);
  context.quadraticCurveTo(left + width, top + height, left + width - r, top + height); context.lineTo(left + r, top + height);
  context.quadraticCurveTo(left, top + height, left, top + height - r); context.lineTo(left, top + r);
  context.quadraticCurveTo(left, top, left + r, top); context.closePath();
}

function drawSpacedLine(context: CanvasRenderingContext2D, line: string, width: number, anchorX: number, y: number, box: MemeTextBox): void {
  if (!box.letterSpacing) {
    if (box.strokeWidth > 0) context.strokeText(line, anchorX, y);
    context.fillText(line, anchorX, y); return;
  }
  let x = box.align === "left" ? anchorX : box.align === "right" ? anchorX - width : anchorX - width / 2;
  context.textAlign = "left";
  for (const character of line) {
    if (box.strokeWidth > 0) context.strokeText(character, x, y);
    context.fillText(character, x, y);
    x += context.measureText(character).width + box.letterSpacing;
  }
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
  if (box.backgroundEnabled && box.backgroundOpacity > 0 && box.text.trim()) {
    const padding = Math.max(0, box.backgroundPadding); const content = measurement.contentBounds;
    context.save(); context.globalAlpha = Math.min(1, Math.max(0, box.backgroundOpacity)); context.fillStyle = box.backgroundColor;
    roundedRect(context, content.left - padding, content.top - padding, content.width + padding * 2, content.height + padding * 2, box.backgroundRadius);
    context.fill(); context.restore();
  }
  context.fillStyle = box.fillColor;
  context.strokeStyle = box.strokeColor;
  context.lineWidth = Math.max(0, box.strokeWidth);
  context.shadowColor = box.shadowEnabled ? box.shadowColor : "transparent";
  context.shadowBlur = box.shadowEnabled ? Math.max(0, box.shadowBlur) : 0;
  context.shadowOffsetX = box.shadowEnabled ? box.shadowOffsetX : 0;
  context.shadowOffsetY = box.shadowEnabled ? box.shadowOffsetY : 0;
  const firstY = measurement.centerY - (measurement.lines.length - 1) * measurement.lineHeight / 2;
  if (box.text.trim()) {
    measurement.lines.forEach((line, index) => {
      const y = firstY + index * measurement.lineHeight;
      drawSpacedLine(context, line, measurement.lineWidths[index], measurement.anchorX, y, box);
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

export function drawImageLayer(
  context: CanvasRenderingContext2D,
  layer: MemeImageLayer,
  source: MemeImageSource,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const frame = calculateImageLayerFrame(layer, canvasWidth, canvasHeight);
  const content = calculateImageContentRect(layer, source, canvasWidth, canvasHeight);
  context.save();
  context.beginPath();
  context.rect(frame.x, frame.y, frame.width, frame.height);
  context.clip();
  context.globalAlpha = layer.opacity;
  context.drawImage(source.image, content.x, content.y, content.width, content.height);
  context.restore();
}

export function renderMemeCanvas(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  textBoxes: MemeTextBox[],
  sourceWidth: number,
  sourceHeight: number,
  canvasState?: MemeCanvasState,
  imageLayers: MemeImageLayer[] = [],
  imageSources: ReadonlyMap<string, MemeImageSource> = new Map(),
  backgroundVisible = true,
): Map<string, TextBoxMeasurement> {
  const state = canvasState ?? {
    aspectPreset: "original" as const, outputWidth: sourceWidth, outputHeight: sourceHeight,
    backgroundScale: 1, backgroundOffsetX: 0, backgroundOffsetY: 0, lockAspectRatio: true, canvasBackgroundColor: "#ffffff",
  };
  const { outputWidth: width, outputHeight: height } = state;
  if (width <= 0 || height <= 0) throw new Error("模板图片尺寸无效。");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法创建 Canvas 画布。");
  context.clearRect(0, 0, width, height);
  context.fillStyle = state.canvasBackgroundColor;
  context.fillRect(0, 0, width, height);
  if (backgroundVisible) {
    const rect = calculateBackgroundDrawRect(sourceWidth, sourceHeight, state);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  }
  for (const layer of imageLayers) {
    const source = imageSources.get(layer.sourceId);
    if (source) drawImageLayer(context, layer, source, width, height);
  }
  return new Map(textBoxes.map(box => [box.id, drawTextBox(context, box, width, height)]));
}
