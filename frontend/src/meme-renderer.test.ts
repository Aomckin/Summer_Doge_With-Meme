import { describe, expect, it, vi } from "vitest";
import { drawTextBox, measureTextBox, renderMemeCanvas, wrapTextBoxText, type MemeTextBox } from "./meme-renderer";

function context() {
  return {
    save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: [...text].length * 10 })),
    font: "", textAlign: "start", textBaseline: "alphabetic", lineJoin: "miter", fillStyle: "", strokeStyle: "", lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
}

const box = (overrides: Partial<MemeTextBox> = {}): MemeTextBox => ({
  id: "one", text: "Hello", xPercent: 50, yPercent: 50, widthPercent: 50,
  fontSize: 40, fillColor: "white", strokeWidth: 4, strokeColor: "black",
  align: "center", fontPreset: "classic", ...overrides,
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

  it("uses the same transformed background rectangle as the output canvas", () => {
    const ctx = context();
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
    renderMemeCanvas(canvas, {} as CanvasImageSource, [], 800, 400, {
      aspectPreset: "1:1", outputWidth: 400, outputHeight: 400,
      backgroundScale: 1, backgroundOffsetX: 10, backgroundOffsetY: -5,
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
    ["white", "black", 4, "#ffffff", "#000000", true],
    ["black", "white", 4, "#000000", "#ffffff", true],
    ["black", "white", 0, "#000000", "#ffffff", false],
    ["white", "black", 0, "#ffffff", "#000000", false],
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
});
