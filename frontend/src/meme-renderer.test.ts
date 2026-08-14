import { describe, expect, it, vi } from "vitest";
import { drawImageLayer, drawTextBox, measureTextBox, renderMemeCanvas, wrapTextBoxText, type MemeTextBox } from "./meme-renderer";
import type { MemeImageLayer, MemeImageSource } from "./meme-image-layer";

function context() {
  return {
    save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: [...text].length * 10 })),
    font: "", textAlign: "start", textBaseline: "alphabetic", lineJoin: "miter", fillStyle: "", strokeStyle: "", lineWidth: 0,
    globalAlpha: 1, shadowColor: "", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
  } as unknown as CanvasRenderingContext2D;
}

const box = (overrides: Partial<MemeTextBox> = {}): MemeTextBox => ({
  id: "one", text: "Hello", xPercent: 50, yPercent: 50, widthPercent: 50,
  fontSize: 40, fillColor: "white", strokeWidth: 4, strokeColor: "black",
  align: "center", fontPreset: "classic", fontWeight: "heavy", lineHeight: 1.15, letterSpacing: 0,
  backgroundEnabled: false, backgroundColor: "#000000", backgroundOpacity: .7, backgroundPadding: 12, backgroundRadius: 8,
  shadowEnabled: false, shadowColor: "#000000", shadowBlur: 4, shadowOffsetX: 2, shadowOffsetY: 2, ...overrides,
});

describe("TextBox renderer", () => {
  it("renders one and multiple boxes in array order", () => {
    const ctx = context();
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
    const measurements = renderMemeCanvas(canvas, {} as CanvasImageSource, [box(), box({ id: "two", text: "World" })], 800, 600);
    expect([canvas.width, canvas.height]).toEqual([800, 600]);
    expect(ctx.fillText).toHaveBeenNthCalledWith(1, "Hello", 400, 300);
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, "World", 400, 300);
    expect([...measurements.keys()]).toEqual(["one", "two"]);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it("clips image layers, renders them in array order below text, and restores alpha", () => {
    const ctx = context();
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
    const source = { id: "source", type: "local", image: { image: true } as unknown as CanvasImageSource, naturalWidth: 400, naturalHeight: 200, filename: "one.png" } satisfies MemeImageSource;
    const layers: MemeImageLayer[] = [
      { id: "a", sourceId: source.id, frameX: 50, frameY: 50, frameWidth: 50, frameHeight: 50, contentX: 50, contentY: 50, contentScale: .5, opacity: .5 },
      { id: "b", sourceId: source.id, frameX: 25, frameY: 25, frameWidth: 20, frameHeight: 20, contentX: 25, contentY: 25, contentScale: .2, opacity: 1 },
    ];
    renderMemeCanvas(canvas, {} as CanvasImageSource, [box({ text: "Top" })], 800, 600, undefined, layers, new Map([[source.id, source]]));
    expect(ctx.clip).toHaveBeenCalledTimes(2);
    expect(ctx.drawImage).toHaveBeenCalledTimes(3);
    const drawOrder = vi.mocked(ctx.drawImage).mock.invocationCallOrder;
    const textOrder = vi.mocked(ctx.fillText).mock.invocationCallOrder;
    expect(Math.max(...drawOrder)).toBeLessThan(Math.min(...textOrder));
    expect(ctx.restore).toHaveBeenCalledTimes(3);
  });

  it("can hide the background without hiding image layers", () => {
    const ctx = context();
    const source = { id: "source", type: "local", image: {} as CanvasImageSource, naturalWidth: 100, naturalHeight: 100, filename: "one.png" } satisfies MemeImageSource;
    const layer = { id: "a", sourceId: source.id, frameX: 50, frameY: 50, frameWidth: 50, frameHeight: 50, contentX: 50, contentY: 50, contentScale: .5, opacity: 1 } satisfies MemeImageLayer;
    drawImageLayer(ctx, layer, source, 100, 100);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
    renderMemeCanvas(canvas, {} as CanvasImageSource, [], 100, 100, undefined, [layer], new Map([[source.id, source]]), false);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });

  it("uses the same transformed background rectangle as the output canvas", () => {
    const ctx = context();
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
    renderMemeCanvas(canvas, {} as CanvasImageSource, [], 800, 400, {
      aspectPreset: "1:1", outputWidth: 400, outputHeight: 400,
      backgroundScale: 1, backgroundOffsetX: 10, backgroundOffsetY: -5,
      lockAspectRatio: true, canvasBackgroundColor: "#ffffff",
    });
    expect([canvas.width, canvas.height]).toEqual([400, 400]);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), -160, -20, 800, 400);
  });

  it.each([
    ["left", 200], ["center", 400], ["right", 600],
  ] as const)("uses %s alignment inside the text box", (align, expectedX) => {
    const ctx = context();
    drawTextBox(ctx, box({ align }), 800, 600);
    expect(ctx.textAlign).toBe(align);
    expect(ctx.fillText).toHaveBeenCalledWith("Hello", expectedX, 300);
  });

  it("preserves manual newlines and wraps English and continuous Chinese", () => {
    const ctx = context();
    expect(wrapTextBoxText(ctx, "A\nB", 100)).toEqual(["A", "B"]);
    expect(wrapTextBoxText(ctx, "one two three", 70)).toEqual(["one two", "three"]);
    expect(wrapTextBoxText(ctx, "一二三四五六", 30)).toEqual(["一二三", "四五六"]);
  });

  it("changes wrapping when widthPercent changes", () => {
    const ctx = context();
    expect(measureTextBox(ctx, box({ text: "一二三四五六", widthPercent: 50 }), 100, 100).lines).toEqual(["一二三四五", "六"]);
    expect(measureTextBox(ctx, box({ text: "一二三四五六", widthPercent: 100 }), 100, 100).lines).toEqual(["一二三四五六"]);
  });

  it("uses independent x/y positions and returns bounds", () => {
    const measured = measureTextBox(context(), box({ xPercent: 30, yPercent: 40, widthPercent: 20 }), 1000, 500);
    expect(measured.bounds).toEqual(expect.objectContaining({ left: 200, right: 400, width: 200 }));
    expect(measured.centerY).toBe(200);
  });

  it("does not stroke at zero and clamps multiline bounds inside the canvas", () => {
    const ctx = context();
    const measured = drawTextBox(ctx, box({ text: "A\nB\nC", yPercent: 0, strokeWidth: 0 }), 800, 600);
    expect(ctx.strokeText).not.toHaveBeenCalled();
    expect(measured.bounds.top).toBeGreaterThanOrEqual(0);
    const bottom = measureTextBox(ctx, box({ text: "A\nB\nC", yPercent: 100 }), 800, 600);
    expect(bottom.bounds.bottom).toBeLessThanOrEqual(600);
  });

  it.each([
    ["#ffffff", "#000000", 4, "#ffffff", "#000000", true],
    ["#000000", "#ffffff", 4, "#000000", "#ffffff", true],
    ["#000000", "#ffffff", 0, "#000000", "#ffffff", false],
    ["#ffffff", "#000000", 0, "#ffffff", "#000000", false],
  ] as const)("renders %s fill with %s stroke at width %s", (fillColor, strokeColor, strokeWidth, fill, stroke, stroked) => {
    const ctx = context();
    drawTextBox(ctx, box({ fillColor, strokeColor, strokeWidth }), 800, 600);
    expect(ctx.fillStyle).toBe(fill);
    expect(ctx.strokeStyle).toBe(stroke);
    expect(ctx.strokeText).toHaveBeenCalledTimes(stroked ? 1 : 0);
  });

  it("renders mixed styles and layers in array order", () => {
    const ctx = context();
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
    renderMemeCanvas(canvas, {} as CanvasImageSource, [
      box({ id: "a", text: "A", fillColor: "white", strokeColor: "black" }),
      box({ id: "b", text: "B", fillColor: "black", strokeColor: "white" }),
    ], 800, 600);
    expect(ctx.fillText).toHaveBeenNthCalledWith(1, "A", 400, 300);
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, "B", 400, 300);
  });

  it("applies line height, letter spacing and font weight to measurement and drawing", () => {
    const ctx = context();
    const measured = drawTextBox(ctx, box({ text: "AB\nCD", lineHeight: 1.5, letterSpacing: 2, fontWeight: "normal" }), 800, 600);
    expect(measured.lineHeight).toBe(60);
    expect(measured.lineWidths).toEqual([22, 22]);
    expect(ctx.font).toContain("400 40px");
    expect(ctx.fillText).toHaveBeenCalledTimes(4);
  });

  it("wraps using letter spacing width", () => {
    const ctx = context();
    expect(wrapTextBoxText(ctx, "ABCD", 35, 2)).toEqual(["ABC", "D"]);
  });

  it("draws an opaque rounded background around multiline content with padding", () => {
    const ctx = context();
    drawTextBox(ctx, box({ text: "A\nBB", backgroundEnabled: true, backgroundColor: "#123456", backgroundOpacity: .5, backgroundPadding: 10, backgroundRadius: 6 }), 800, 600);
    expect(ctx.beginPath).toHaveBeenCalled(); expect(ctx.quadraticCurveTo).toHaveBeenCalled(); expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.globalAlpha).toBe(.5); expect(ctx.fillStyle).toBe("white");
  });

  it("applies enabled shadow and clears it when disabled", () => {
    const enabled = context(); drawTextBox(enabled, box({ shadowEnabled: true, shadowColor: "#ff0000", shadowBlur: 7, shadowOffsetX: 3, shadowOffsetY: -2 }), 800, 600);
    expect(enabled.shadowColor).toBe("#ff0000"); expect(enabled.shadowBlur).toBe(7); expect(enabled.shadowOffsetX).toBe(3); expect(enabled.shadowOffsetY).toBe(-2);
    const disabled = context(); drawTextBox(disabled, box({ shadowEnabled: false }), 800, 600); expect(disabled.shadowColor).toBe("transparent");
  });
});
