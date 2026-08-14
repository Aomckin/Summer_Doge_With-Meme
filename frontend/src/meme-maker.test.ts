// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { MemeMakerController, type MemeMakerApi } from "./meme-maker";
import type { MemeResponse, TemplateResponse } from "./types";

const staticTemplate: TemplateResponse = {
  id: 1, name: "Doge", description: null,
  reference_image_url: "/media/template-images/doge.png",
  reference_thumbnail_url: null, reference_mime_type: "image/png",
  reference_width: 800, reference_height: 600,
  created_at: "2026-01-01", updated_at: "2026-01-01",
};

const unavailable: TemplateResponse[] = [
  { ...staticTemplate, id: 2, name: "No image", reference_image_url: null, reference_mime_type: null },
  { ...staticTemplate, id: 3, name: "Animated", reference_mime_type: "image/gif" },
];

function meme(id = 8): MemeResponse {
  return {
    id, title: "made", description: null, source: "meme-maker",
    original_filename: "doge-meme.png", stored_filename: "stored.png",
    image_url: "/media/images/stored.png", thumbnail_url: null,
    mime_type: "image/png", file_size: 10, width: 800, height: 600,
    file_hash: "hash", created_at: "2026-01-01", updated_at: "2026-01-01",
    tags: [], template: staticTemplate, images: [], image_count: 1,
  };
}

function setup(overrides: Partial<MemeMakerApi> = {}) {
  document.body.innerHTML = '<button data-trigger type="button">open</button>';
  const context = {
    save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    font: "", textAlign: "start", textBaseline: "alphabetic", lineJoin: "miter", fillStyle: "", strokeStyle: "", lineWidth: 0,
    globalAlpha: 1, shadowColor: "", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["png"], { type: "image/png" })));
  const api: MemeMakerApi = {
    listTemplates: vi.fn().mockResolvedValue([staticTemplate, ...unavailable]),
    listMemes: vi.fn().mockResolvedValue([]),
    uploadMeme: vi.fn().mockResolvedValue(meme()),
    ...overrides,
  };
  const loaded = {
    source: {} as CanvasImageSource, width: 800, height: 600, dispose: vi.fn(),
  };
  const loadImage = vi.fn().mockResolvedValue(loaded);
  const controller = new MemeMakerController(
    document.querySelector("[data-trigger]")!, api,
    { loadImage, scheduleFrame: callback => { queueMicrotask(() => callback(0)); return 1; }, cancelFrame: vi.fn() },
  );
  document.querySelector<HTMLButtonElement>("[data-trigger]")!.click();
  const dialog = document.querySelector<HTMLDialogElement>("[data-meme-maker-dialog]")!;
  return { controller, api, loadImage, loaded, dialog, context };
}

async function choose(dialog: HTMLDialogElement, id = "1") {
  await vi.waitFor(() => expect(dialog.querySelectorAll('select[name="template_id"] option').length).toBe(4));
  const select = dialog.querySelector<HTMLSelectElement>('[name="template_id"]')!;
  select.value = id;
  select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(dialog.querySelector("canvas")?.hidden).toBe(false));
}

function type(dialog: HTMLDialogElement, name: string, value: string) {
  const input = dialog.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function changeControl(dialog: HTMLDialogElement, name: string, value: string) {
  const input = dialog.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  input.focus(); input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
}

function localFile(dialog: HTMLDialogElement, file: File) {
  const input = dialog.querySelector<HTMLInputElement>('[name="local_image"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function imageFiles(dialog: HTMLDialogElement, files: File[]) {
  const input = dialog.querySelector<HTMLInputElement>('[name="image_layers"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function backgroundType(dialog: HTMLDialogElement, value: "template" | "local") {
  const input = dialog.querySelector<HTMLInputElement>(`[name="background_type"][value="${value}"]`)!;
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function key(dialog: HTMLDialogElement, value: string, options: KeyboardEventInit = {}) {
  dialog.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

describe("Meme Maker controller", () => {
  it("opens, loads templates, disables missing/GIF options and loads a static template", async () => {
    const { dialog, loadImage, context } = setup();
    expect(dialog.open).toBe(true);
    await choose(dialog);
    const options = [...dialog.querySelectorAll<HTMLOptionElement>('select[name="template_id"] option')];
    expect(options[2].disabled).toBe(true);
    expect(options[3].disabled).toBe(true);
    expect(options[3].textContent).toContain("GIF 模板暂不支持制作");
    expect(loadImage).toHaveBeenCalledWith(staticTemplate.reference_image_url);
    expect(context.drawImage).toHaveBeenCalled();
    expect(dialog.querySelector("[data-resolution]")?.textContent).toBe("800 × 600 PNG");
  });

  it("imports multiple static image layers, rejects GIF independently, and disposes session sources on close", async () => {
    const { dialog, loaded } = setup(); await choose(dialog);
    imageFiles(dialog, [new File(["png"], "one.png", { type: "image/png" }), new File(["gif"], "bad.gif", { type: "image/gif" }), new File(["jpg"], "two.jpg", { type: "image/jpeg" })]);
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(2));
    expect(dialog.querySelector("[data-maker-notice]")?.textContent).toContain("GIF 图片层暂不支持");
    expect(dialog.querySelector("[data-selected-image-layer]")).not.toBeNull();
    dialog.querySelector<HTMLButtonElement>("[data-close-maker]")!.click();
    expect(loaded.dispose).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("adds a Vault image through the picker and restores it with undo and redo", async () => {
    const vaultMeme = { ...meme(21), title: "Vault 素材", source: "vault" };
    const listMemes = vi.fn().mockResolvedValue([vaultMeme]);
    const { dialog, api, loadImage } = setup({ listMemes });
    await choose(dialog);
    dialog.querySelector<HTMLButtonElement>('[data-open-vault-picker="add"]')!.click();
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-vault-meme-id]")).toHaveLength(1));
    expect(listMemes).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, limit: 12 }));
    dialog.querySelector<HTMLButtonElement>('[data-vault-meme-id="21"]')!.click();
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1));
    expect(loadImage).toHaveBeenLastCalledWith(vaultMeme.image_url);
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(0);
    dialog.querySelector<HTMLButtonElement>("[data-redo]")!.click();
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1);
    expect(api.uploadMeme).not.toHaveBeenCalled();
  });

  it("opens directly with a Viewer/Vault image as an undoable image layer", async () => {
    const { controller, dialog, loadImage } = setup();
    controller.close();
    await controller.openWithVaultImage({
      url: "/media/images/viewer.png", filename: "viewer.png", title: "Viewer 图",
      mimeType: "image/png", width: 800, height: 600,
    });
    expect(dialog.open).toBe(true);
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1);
    expect(dialog.querySelector<HTMLInputElement>('[name="background_visible"]')?.checked).toBe(false);
    expect(loadImage).toHaveBeenCalledWith("/media/images/viewer.png");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(0);
  });

  it("applies quick layout as one undoable step and explicitly refills content", async () => {
    const { dialog } = setup(); await choose(dialog);
    imageFiles(dialog, [1, 2, 3, 4].map(index => new File(["png"], `${index}.png`, { type: "image/png" })));
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(4));
    changeControl(dialog, "image_crop_x", "10");
    const oldWidth = dialog.querySelector<HTMLInputElement>('[name="image_width"]')!.value;
    dialog.querySelector<HTMLButtonElement>('[data-image-layout="grid-2x2"]')!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="image_x"]')?.value).toBe("75");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_y"]')?.value).toBe("75");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_width"]')?.value).toBe("50");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_crop_x"]')?.value).toBe("75");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="image_width"]')?.value).toBe(oldWidth);
    expect(dialog.querySelector<HTMLInputElement>('[name="image_crop_x"]')?.value).toBe("10");
    dialog.querySelector<HTMLButtonElement>("[data-redo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="image_width"]')?.value).toBe("50");
  });

  it("replaces an image source with Fill while preserving frame, order and opacity", async () => {
    const { dialog } = setup(); await choose(dialog);
    imageFiles(dialog, [new File(["png"], "old.png", { type: "image/png" })]);
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1));
    changeControl(dialog, "image_x", "35"); changeControl(dialog, "image_y", "40");
    changeControl(dialog, "image_width", "60"); changeControl(dialog, "image_height", "30");
    changeControl(dialog, "image_crop_x", "5"); changeControl(dialog, "image_crop_y", "7");
    changeControl(dialog, "image_opacity", "42");
    const replace = dialog.querySelector<HTMLInputElement>('[name="replace_image_layer"]')!;
    Object.defineProperty(replace, "files", { configurable: true, value: [new File(["png"], "new.png", { type: "image/png" })] });
    replace.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(dialog.querySelector("[data-maker-notice]")?.textContent).toContain("来源已替换"));
    expect(dialog.querySelector<HTMLInputElement>('[name="image_x"]')?.value).toBe("35");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_y"]')?.value).toBe("40");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_width"]')?.value).toBe("60");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_height"]')?.value).toBe("30");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_crop_x"]')?.value).toBe("35");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_crop_y"]')?.value).toBe("40");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_opacity"]')?.value).toBe("42");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="image_crop_x"]')?.value).toBe("5");
  });

  it("clears image layers, clears text boxes and resets Forge as separate undoable actions", async () => {
    const { dialog } = setup(); await choose(dialog);
    imageFiles(dialog, [new File(["png"], "one.png", { type: "image/png" })]);
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1));
    type(dialog, "box_text", "保留测试");
    dialog.querySelector<HTMLButtonElement>("[data-clear-image-layers]")!.click();
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(0);
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(1);
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1);
    dialog.querySelector<HTMLButtonElement>("[data-clear-text-boxes]")!.click();
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(0);
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1);
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(1);
    changeControl(dialog, "background_x", "20");
    dialog.querySelector<HTMLButtonElement>("[data-reset-forge]")!.click();
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(0);
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(0);
    expect(dialog.querySelector<HTMLInputElement>('[name="background_x"]')?.value).toBe("0");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1);
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(1);
    expect(dialog.querySelector<HTMLInputElement>('[name="background_x"]')?.value).toBe("20");
  });

  it("caps one batch at 30 image layers with unique layer identities", async () => {
    const { dialog } = setup(); await choose(dialog);
    imageFiles(dialog, Array.from({ length: 31 }, (_, index) => new File(["png"], `${index}.png`, { type: "image/png" })));
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(30));
    const ids = [...dialog.querySelectorAll<HTMLElement>("[data-image-layer-id]")].map(item => item.dataset.imageLayerId);
    expect(new Set(ids).size).toBe(30);
    expect(dialog.querySelector<HTMLInputElement>('[name="image_layers"]')?.disabled).toBe(true);
    expect(dialog.querySelector("[data-maker-notice]")?.textContent).toContain("上限");
  });

  it("creates a background layer, edits crop and opacity, clones/reorders/deletes, and restores through history", async () => {
    const { dialog, context } = setup(); await choose(dialog);
    dialog.querySelector<HTMLButtonElement>("[data-background-to-layer]")!.click();
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1));
    type(dialog, "image_width", "55"); type(dialog, "image_height", "35"); type(dialog, "image_scale", "180"); type(dialog, "image_crop_x", "12"); type(dialog, "image_opacity", "45");
    await vi.waitFor(() => expect(context.clip).toHaveBeenCalled());
    expect(dialog.querySelector<HTMLInputElement>('[name="image_width_number"]')?.value).toBe("247.5");
    dialog.querySelector<HTMLButtonElement>("[data-image-fit]")!.click();
    expect(Number(dialog.querySelector<HTMLInputElement>('[name="image_scale"]')?.value)).toBeLessThanOrEqual(500);
    dialog.querySelector<HTMLButtonElement>("[data-clone-image-layer]")!.click();
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(2);
    dialog.querySelector<HTMLButtonElement>("[data-image-layer-down]")!.click();
    dialog.querySelectorAll<HTMLButtonElement>("[data-delete-image-layer]")[0].click();
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1);
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(2);
    dialog.querySelector<HTMLButtonElement>("[data-redo]")!.click(); expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1);
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click(); expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(2);
    const visible = dialog.querySelector<HTMLInputElement>('[name="background_visible"]')!; visible.checked = false; visible.dispatchEvent(new Event("change", { bubbles: true }));
    vi.mocked(context.drawImage).mockClear(); type(dialog, "box_text", "Always above"); await vi.waitFor(() => expect(context.drawImage).toHaveBeenCalledTimes(2));
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click(); expect(visible.checked).toBe(true);
  });

  it("keeps frame edits and content pan independent while geometric scale preserves the current crop", async () => {
    const { dialog } = setup(); await choose(dialog);
    dialog.querySelector<HTMLButtonElement>("[data-background-to-layer]")!.click();
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1));
    const cropMode = dialog.querySelector<HTMLInputElement>('[name="image_crop_mode"]')!;
    cropMode.checked = true; cropMode.dispatchEvent(new Event("change", { bubbles: true }));

    changeControl(dialog, "image_x", "60");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_crop_x"]')?.value).toBe("50");
    changeControl(dialog, "image_width", "55");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_scale"]')?.value).toBe("40");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_crop_x"]')?.value).toBe("50");
    changeControl(dialog, "image_crop_x", "70");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_x"]')?.value).toBe("60");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_width"]')?.value).toBe("55");
    changeControl(dialog, "image_scale", "50");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_x"]')?.value).toBe("60");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_width"]')?.value).toBe("68.8");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_height"]')?.value).toBe("50");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_crop_x"]')?.value).toBe("72.5");

    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="image_scale"]')?.value).toBe("40");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_crop_x"]')?.value).toBe("70");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="image_crop_x"]')?.value).toBe("50");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="image_width"]')?.value).toBe("40");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="image_x"]')?.value).toBe("50");
  });

  it("keeps the image layer scale range fixed at 500 percent without canvas-boundary clamping", async () => {
    const { dialog } = setup(); await choose(dialog);
    dialog.querySelector<HTMLButtonElement>("[data-background-to-layer]")!.click();
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1));
    const scale = dialog.querySelector<HTMLInputElement>('[name="image_scale"]')!;
    expect(scale.max).toBe("500");
    changeControl(dialog, "image_scale", "500");
    expect(scale.value).toBe("500");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_width_number"]')?.value).toBe("500");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_height_number"]')?.value).toBe("500");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_x"]')?.value).toBe("50");
    expect(dialog.querySelector<HTMLInputElement>('[name="image_y"]')?.value).toBe("50");
  });

  it("uses the identical independent frame and content transform for preview and export", async () => {
    const { dialog, context } = setup(); await choose(dialog);
    dialog.querySelector<HTMLButtonElement>("[data-background-to-layer]")!.click();
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1));
    const cropMode = dialog.querySelector<HTMLInputElement>('[name="image_crop_mode"]')!;
    cropMode.checked = true; cropMode.dispatchEvent(new Event("change", { bubbles: true }));
    changeControl(dialog, "image_x", "65"); changeControl(dialog, "image_y", "40");
    changeControl(dialog, "image_width", "35"); changeControl(dialog, "image_height", "60");
    changeControl(dialog, "image_crop_x", "30"); changeControl(dialog, "image_crop_y", "70"); changeControl(dialog, "image_scale", "85");
    await vi.waitFor(() => expect(context.clip).toHaveBeenCalled());
    const previewDraw = vi.mocked(context.drawImage).mock.calls.at(-1)?.slice(1);
    const previewClip = vi.mocked(context.rect).mock.calls.at(-1);
    vi.mocked(context.drawImage).mockClear(); vi.mocked(context.rect).mockClear();
    dialog.querySelector<HTMLButtonElement>("[data-export-maker]")!.click();
    await vi.waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    expect(vi.mocked(context.drawImage).mock.calls.at(-1)?.slice(1)).toEqual(previewDraw);
    expect(vi.mocked(context.rect).mock.calls.at(-1)).toEqual(previewClip);
  });

  it("accepts clipboard and canvas-drop images while leaving text-only paste alone", async () => {
    const { dialog } = setup(); await choose(dialog);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [new File(["png"], "clip.png", { type: "image/png" })] } });
    dialog.dispatchEvent(paste);
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(1));
    const textPaste = new Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(textPaste, "clipboardData", { value: { files: [] } });
    dialog.querySelector<HTMLTextAreaElement>('[name="box_text"]')!.dispatchEvent(textPaste); expect(textPaste.defaultPrevented).toBe(false);
    const overlay = dialog.querySelector<HTMLElement>("[data-maker-overlay]")!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(drop, { dataTransfer: { value: { files: [new File(["webp"], "drop.webp", { type: "image/webp" })] } }, clientX: { value: 400 }, clientY: { value: 300 } });
    overlay.dispatchEvent(drop);
    await vi.waitFor(() => expect(dialog.querySelectorAll("[data-image-layer-id]")).toHaveLength(2));
    expect(drop.defaultPrevented).toBe(true);
  });

  it("updates selected text box properties and schedules preview without API calls", async () => {
    const { dialog, api, context } = setup();
    await choose(dialog);
    type(dialog, "box_text", "Top");
    type(dialog, "box_font_size", "90");
    type(dialog, "box_x", "30");
    type(dialog, "box_y", "75");
    type(dialog, "box_width", "45");
    type(dialog, "box_stroke", "6");
    type(dialog, "box_align", "right");
    await vi.waitFor(() => expect(dialog.querySelector('[data-output="box_font_size"]')?.textContent).toBe("90px"));
    expect(dialog.querySelector('[data-output="box_y"]')?.textContent).toBe("75%");
    expect(dialog.querySelector('[data-text-box-id]')?.textContent).toContain("Top");
    expect(context.fillText).toHaveBeenCalled();
    expect(api.uploadMeme).not.toHaveBeenCalled();
  });

  it("adds, selects and deletes text boxes without keeping top/bottom state", async () => {
    const { dialog } = setup();
    await choose(dialog);
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(1);
    dialog.querySelector<HTMLButtonElement>("[data-add-text-box]")!.click();
    dialog.querySelector<HTMLButtonElement>("[data-add-text-box]")!.click();
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(3);
    const first = dialog.querySelectorAll<HTMLButtonElement>("[data-text-box-id]")[0];
    first.click();
    type(dialog, "box_text", "First selected");
    expect(dialog.querySelectorAll<HTMLButtonElement>("[data-text-box-id]")[0].textContent).toContain("First selected");
    dialog.querySelector<HTMLButtonElement>("[data-delete-text-box]")!.click();
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(2);
    expect(dialog.querySelector('[name="top_text"]')).toBeNull();
  });

  it("selects by canvas, drags a text box, resizes both handles and clears selection on blank space", async () => {
    const { dialog } = setup();
    await choose(dialog);
    type(dialog, "box_text", "Move me");
    await vi.waitFor(() => expect(dialog.querySelector("[data-selected-box]")).not.toBeNull());
    const canvas = dialog.querySelector<HTMLCanvasElement>("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    const overlay = dialog.querySelector<HTMLElement>("[data-maker-overlay]")!;
    const fire = (type: string, x: number, y: number, target: Element = overlay) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    fire("pointerdown", 400, 90, dialog.querySelector("[data-selected-box]")!);
    fire("pointermove", 480, 150);
    fire("pointerup", 480, 150);
    expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe("60");
    expect(dialog.querySelector<HTMLInputElement>('[name="box_y"]')?.value).toBe("25");
    fire("pointerdown", 200, 150, dialog.querySelector('[data-resize-handle="left"]')!);
    fire("pointermove", 280, 150); fire("pointerup", 280, 150);
    expect(Number(dialog.querySelector<HTMLInputElement>('[name="box_width"]')?.value)).toBeLessThan(70);
    fire("pointerdown", 700, 150, dialog.querySelector('[data-resize-handle="right"]')!);
    fire("pointermove", 760, 150); fire("pointerup", 760, 150);
    expect(dialog.querySelector("[data-selected-box]")).not.toBeNull();
    fire("pointerdown", 10, 590);
    expect(dialog.querySelector("[data-selected-box]")).toBeNull();
  });

  it("lays out three boxes with different positions, widths, sizes and alignments", async () => {
    const { dialog, context } = setup();
    await choose(dialog);
    const configurations = [
      ["左上", "25", "20", "30", "32", "left"],
      ["中间", "50", "50", "60", "48", "center"],
      ["右下", "80", "82", "35", "28", "right"],
    ];
    for (let index = 0; index < configurations.length; index += 1) {
      if (index) dialog.querySelector<HTMLButtonElement>("[data-add-text-box]")!.click();
      const [textValue, x, y, width, font, align] = configurations[index];
      type(dialog, "box_text", textValue);
      type(dialog, "box_x", x);
      type(dialog, "box_y", y);
      type(dialog, "box_width", width);
      type(dialog, "box_font_size", font);
      type(dialog, "box_align", align);
    }
    await vi.waitFor(() => expect(context.fillText).toHaveBeenCalledWith("左上", expect.any(Number), expect.any(Number)));
    expect(context.fillText).toHaveBeenCalledWith("中间", expect.any(Number), expect.any(Number));
    expect(context.fillText).toHaveBeenCalledWith("右下", expect.any(Number), expect.any(Number));
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(3);
  });

  it("clones style with a new id and offset, then respects the 20-box limit", async () => {
    const { dialog } = setup();
    await choose(dialog);
    type(dialog, "box_text", "Clone me");
    type(dialog, "box_fill_color", "black");
    type(dialog, "box_stroke_color", "white");
    type(dialog, "box_width", "40");
    const originalId = dialog.querySelector<HTMLElement>("[data-text-box-id]")!.dataset.textBoxId;
    dialog.querySelector<HTMLButtonElement>("[data-clone-text-box]")!.click();
    const boxes = dialog.querySelectorAll<HTMLElement>("[data-text-box-id]");
    expect(boxes).toHaveLength(2);
    expect(boxes[1].dataset.textBoxId).not.toBe(originalId);
    expect(dialog.querySelector<HTMLTextAreaElement>('[name="box_text"]')?.value).toBe("Clone me");
    expect(dialog.querySelector<HTMLInputElement>('[name="box_fill_color"]')?.value).toBe("#000000");
    expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe("53");
    for (let index = 2; index < 20; index += 1) dialog.querySelector<HTMLButtonElement>("[data-add-text-box]")!.click();
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(20);
    expect(dialog.querySelector<HTMLButtonElement>("[data-clone-text-box]")?.disabled).toBe(true);
  });

  it("moves the selected box one layer at a time and disables boundary actions", async () => {
    const { dialog, context } = setup();
    await choose(dialog);
    type(dialog, "box_text", "A");
    dialog.querySelector<HTMLButtonElement>("[data-add-text-box]")!.click(); type(dialog, "box_text", "B");
    dialog.querySelector<HTMLButtonElement>("[data-add-text-box]")!.click(); type(dialog, "box_text", "C");
    dialog.querySelectorAll<HTMLButtonElement>("[data-text-box-id]")[1].click();
    dialog.querySelector<HTMLButtonElement>("[data-layer-up]")!.click();
    await vi.waitFor(() => expect(vi.mocked(context.fillText).mock.calls.slice(-3).map(call => call[0])).toEqual(["A", "C", "B"]));
    expect(dialog.querySelector<HTMLButtonElement>("[data-layer-up]")?.disabled).toBe(true);
    dialog.querySelector<HTMLButtonElement>("[data-layer-down]")!.click();
    expect(dialog.querySelector<HTMLButtonElement>("[data-layer-up]")?.disabled).toBe(false);
  });

  it("nudges with arrows, moves faster with Shift, clamps, and ignores form focus or no selection", async () => {
    const { dialog } = setup();
    await choose(dialog);
    const key = (target: Element, value: string, shiftKey = false) => target.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }));
    key(dialog, "ArrowRight"); key(dialog, "ArrowDown", true);
    expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe("50.5");
    expect(dialog.querySelector<HTMLInputElement>('[name="box_y"]')?.value).toBe("17");
    const textarea = dialog.querySelector<HTMLTextAreaElement>('[name="box_text"]')!;
    key(textarea, "ArrowLeft");
    expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe("50.5");
    type(dialog, "box_x", "35");
    for (let index = 0; index < 100; index += 1) key(dialog, "ArrowLeft", true);
    expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe("35");
    dialog.querySelector<HTMLElement>("[data-maker-overlay]")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 600 }));
    const before = dialog.querySelector<HTMLInputElement>('[name="box_y"]')?.value;
    key(dialog, "ArrowUp");
    expect(dialog.querySelector<HTMLInputElement>('[name="box_y"]')?.value).toBe(before);
  });

  it.each([
    ["image/png", "local.png"], ["image/jpeg", "local.jpg"], ["image/webp", "local.webp"],
  ])("loads a local %s background at natural size and preserves text boxes", async (mime, name) => {
    const { dialog, loadImage } = setup();
    await choose(dialog);
    type(dialog, "box_text", "Keep me");
    backgroundType(dialog, "local");
    localFile(dialog, new File(["image"], name, { type: mime }));
    await vi.waitFor(() => expect(dialog.querySelector("[data-resolution]")?.textContent).toBe("800 × 600 PNG"));
    expect(loadImage).toHaveBeenLastCalledWith("blob:test");
    expect(dialog.querySelector<HTMLTextAreaElement>('[name="box_text"]')?.value).toBe("Keep me");
  });

  it("rejects GIF and non-image local backgrounds", async () => {
    const { dialog, loadImage } = setup();
    backgroundType(dialog, "local");
    localFile(dialog, new File(["gif"], "bad.gif", { type: "image/gif" }));
    expect(dialog.querySelector("[data-maker-notice]")?.textContent).toContain("GIF 底图暂不支持");
    localFile(dialog, new File(["txt"], "bad.txt", { type: "text/plain" }));
    expect(dialog.querySelector("[data-maker-notice]")?.textContent).toContain("PNG、JPEG 或 WEBP");
    expect(loadImage).not.toHaveBeenCalled();
  });

  it("switches local/template backgrounds, preserves boxes and revokes local URLs", async () => {
    const { dialog } = setup();
    await choose(dialog);
    type(dialog, "box_text", "Persistent");
    backgroundType(dialog, "local");
    localFile(dialog, new File(["image"], "local.png", { type: "image/png" }));
    await vi.waitFor(() => expect(dialog.querySelector("[data-resolution]")?.textContent).toBe("800 × 600 PNG"));
    backgroundType(dialog, "template");
    await vi.waitFor(() => expect(dialog.querySelector("[data-maker-notice]")?.textContent).toContain("模板已加载"));
    expect(dialog.querySelector<HTMLTextAreaElement>('[name="box_text"]')?.value).toBe("Persistent");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("saves local backgrounds without a template and keeps source metadata", async () => {
    const { dialog, api } = setup();
    backgroundType(dialog, "local");
    localFile(dialog, new File(["image"], "my photo.jpg", { type: "image/jpeg" }));
    await vi.waitFor(() => expect(dialog.querySelector("[data-resolution]")?.textContent).toBe("800 × 600 PNG"));
    type(dialog, "box_text", "Local"); type(dialog, "title", "Local Meme");
    dialog.querySelector<HTMLButtonElement>("[data-save-maker]")!.click();
    await vi.waitFor(() => expect(api.uploadMeme).toHaveBeenCalledWith(expect.objectContaining({ template_id: null, source: "meme-maker" })));
  });

  it("undoes and redoes a style edit, then invalidates redo after a new edit", async () => {
    const { dialog } = setup(); await choose(dialog);
    const font = dialog.querySelector<HTMLInputElement>('[name="box_font_size"]')!;
    font.focus(); type(dialog, "box_font_size", "90"); font.dispatchEvent(new Event("change", { bubbles: true })); font.blur();
    expect(dialog.querySelector<HTMLButtonElement>("[data-undo]")?.disabled).toBe(false);
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(font.value).toBe("72");
    dialog.querySelector<HTMLButtonElement>("[data-redo]")!.click();
    expect(font.value).toBe("90");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    dialog.querySelector<HTMLButtonElement>("[data-add-text-box]")!.click();
    expect(dialog.querySelector<HTMLButtonElement>("[data-redo]")?.disabled).toBe(true);
  });

  it("groups multiple drag moves and resize moves into one history step", async () => {
    const { dialog } = setup(); await choose(dialog); type(dialog, "box_text", "Move");
    const canvas = dialog.querySelector<HTMLCanvasElement>("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    const overlay = dialog.querySelector<HTMLElement>("[data-maker-overlay]")!;
    const fire = (name: string, x: number, y: number, target: Element = overlay) => target.dispatchEvent(new MouseEvent(name, { bubbles: true, clientX: x, clientY: y }));
    fire("pointerdown", 400, 90, dialog.querySelector("[data-selected-box]")!);
    fire("pointermove", 430, 120); fire("pointermove", 470, 150); fire("pointerup", 470, 150);
    const movedX = dialog.querySelector<HTMLInputElement>('[name="box_x"]')!.value;
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe("50");
    dialog.querySelector<HTMLButtonElement>("[data-redo]")!.click(); expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe(movedX);
    const oldWidth = dialog.querySelector<HTMLInputElement>('[name="box_width"]')!.value;
    fire("pointerdown", 680, 150, dialog.querySelector('[data-resize-handle="right"]')!);
    fire("pointermove", 700, 150); fire("pointermove", 720, 150); fire("pointerup", 720, 150);
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="box_width"]')?.value).toBe(oldWidth);
  });

  it("supports history shortcuts, clone, delete, escape and focus guards", async () => {
    const { dialog } = setup(); await choose(dialog); type(dialog, "box_text", "Shortcut");
    key(dialog, "d", { ctrlKey: true }); expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(2);
    key(dialog, "Delete"); expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(1);
    key(dialog, "z", { ctrlKey: true }); expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(2);
    key(dialog, "y", { ctrlKey: true }); expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(1);
    key(dialog, "z", { ctrlKey: true }); key(dialog, "z", { ctrlKey: true, shiftKey: true });
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(1);
    key(dialog, "Escape"); expect(dialog.querySelector("[data-selected-box]")).toBeNull();
    const textarea = dialog.querySelector<HTMLTextAreaElement>('[name="box_text"]')!;
    textarea.focus(); textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(dialog.querySelectorAll("[data-text-box-id]")).toHaveLength(1);
  });

  it("shows center snap guides during drag and removes them on pointerup", async () => {
    const { dialog } = setup(); await choose(dialog); type(dialog, "box_text", "Snap"); type(dialog, "box_x", "45"); type(dialog, "box_y", "45");
    await Promise.resolve();
    const canvas = dialog.querySelector<HTMLCanvasElement>("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    const overlay = dialog.querySelector<HTMLElement>("[data-maker-overlay]")!;
    dialog.querySelector("[data-selected-box]")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 360, clientY: 270 }));
    overlay.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 392, clientY: 294 }));
    await vi.waitFor(() => expect(dialog.querySelector("[data-snap-guide-x]")).not.toBeNull());
    expect(dialog.querySelector("[data-snap-guide-y]")).not.toBeNull();
    overlay.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 392, clientY: 294 }));
    expect(dialog.querySelector("[data-snap-guide-x]")).toBeNull(); expect(dialog.querySelector("[data-snap-guide-y]")).toBeNull();
  });

  it("synchronizes sliders and numeric inputs, supports decimals, clamps and undoes numeric edits", async () => {
    const { dialog } = setup(); await choose(dialog);
    type(dialog, "box_x", "42.5"); expect(dialog.querySelector<HTMLInputElement>('[name="box_x_number"]')?.value).toBe("42.5");
    const xNumber = dialog.querySelector<HTMLInputElement>('[name="box_x_number"]')!;
    xNumber.focus(); type(dialog, "box_x_number", "50.1"); xNumber.dispatchEvent(new Event("change", { bubbles: true })); xNumber.blur();
    expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe("50.1");
    const widthNumber = dialog.querySelector<HTMLInputElement>('[name="box_width_number"]')!;
    widthNumber.focus(); type(dialog, "box_width_number", "99999"); widthNumber.blur(); expect(widthNumber.value).toBe("100");
    const fontNumber = dialog.querySelector<HTMLInputElement>('[name="box_font_size_number"]')!;
    fontNumber.focus(); type(dialog, "box_font_size_number", "-999"); fontNumber.blur(); expect(fontNumber.value).toBe("12");
    xNumber.focus(); xNumber.value = ""; xNumber.dispatchEvent(new Event("input", { bubbles: true })); xNumber.blur(); expect(xNumber.value).not.toBe("");
    key(dialog, "z", { ctrlKey: true }); expect(fontNumber.value).not.toBe("12");
  });

  it("switches output ratios with fill-center, preserves text boxes and supports ratio undo", async () => {
    const { dialog } = setup(); await choose(dialog); type(dialog, "box_text", "Keep me"); type(dialog, "box_x", "42.5");
    dialog.querySelector<HTMLButtonElement>('[data-aspect-preset="1:1"]')!.click();
    expect(dialog.querySelector("[data-resolution]")?.textContent).toBe("600 × 600 PNG");
    expect(dialog.querySelector<HTMLTextAreaElement>('[name="box_text"]')?.value).toBe("Keep me");
    expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe("42.5");
    expect(dialog.querySelector<HTMLInputElement>('[name="background_x"]')?.value).toBe("0");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    await vi.waitFor(() => expect(dialog.querySelector("[data-resolution]")?.textContent).toBe("800 × 600 PNG"));
    dialog.querySelector<HTMLButtonElement>("[data-redo]")!.click();
    await vi.waitFor(() => expect(dialog.querySelector("[data-resolution]")?.textContent).toBe("600 × 600 PNG"));
  });

  it("fits, fills and resets the background as individual undoable actions", async () => {
    const { dialog } = setup(); await choose(dialog);
    dialog.querySelector<HTMLButtonElement>('[data-aspect-preset="1:1"]')!.click();
    dialog.querySelector<HTMLButtonElement>("[data-background-fit]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="background_scale"]')?.value).toBe("75");
    dialog.querySelector<HTMLButtonElement>("[data-background-fill]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="background_scale"]')?.value).toBe("100");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="background_scale"]')?.value).toBe("75");
    type(dialog, "background_x", "20");
    dialog.querySelector<HTMLButtonElement>("[data-background-reset]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="background_x"]')?.value).toBe("0");
  });

  it("synchronizes background controls, clamps numeric input and undoes a scale edit", async () => {
    const { dialog } = setup(); await choose(dialog);
    type(dialog, "background_scale", "180.5");
    expect(dialog.querySelector<HTMLInputElement>('[name="background_scale_number"]')?.value).toBe("180.5");
    const scale = dialog.querySelector<HTMLInputElement>('[name="background_scale_number"]')!;
    scale.focus(); type(dialog, "background_scale_number", "220.5"); scale.dispatchEvent(new Event("change", { bubbles: true })); scale.blur();
    expect(dialog.querySelector<HTMLInputElement>('[name="background_scale"]')?.value).toBe("220.5");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="background_scale"]')?.value).toBe("180.5");
    const x = dialog.querySelector<HTMLInputElement>('[name="background_x_number"]')!;
    x.focus(); type(dialog, "background_x_number", "999"); x.blur(); expect(x.value).toBe("200");
    x.focus(); x.value = ""; x.dispatchEvent(new Event("input", { bubbles: true })); x.blur(); expect(x.value).not.toBe("");
  });

  it("drags the background only on blank canvas and groups multiple moves into one history step", async () => {
    const { dialog } = setup(); await choose(dialog); type(dialog, "box_text", "Text stays");
    const canvas = dialog.querySelector<HTMLCanvasElement>("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    const overlay = dialog.querySelector<HTMLElement>("[data-maker-overlay]")!;
    const fire = (name: string, x: number, y: number, target: Element = overlay) => target.dispatchEvent(new MouseEvent(name, { bubbles: true, clientX: x, clientY: y }));
    const textX = dialog.querySelector<HTMLInputElement>('[name="box_x"]')!.value;
    fire("pointerdown", 10, 590); fire("pointermove", 50, 560); fire("pointermove", 90, 530);
    expect(overlay.classList.contains("is-dragging-background")).toBe(true);
    fire("pointerup", 90, 530);
    expect(dialog.querySelector<HTMLInputElement>('[name="background_x"]')?.value).toBe("10");
    expect(dialog.querySelector<HTMLInputElement>('[name="background_y"]')?.value).toBe("-10");
    expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe(textX);
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="background_x"]')?.value).toBe("0");
    expect(dialog.querySelector<HTMLInputElement>('[name="background_y"]')?.value).toBe("0");
  });

  it("does not move the background while dragging or resizing a text box", async () => {
    const { dialog } = setup(); await choose(dialog); type(dialog, "box_text", "Text");
    const canvas = dialog.querySelector<HTMLCanvasElement>("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    const overlay = dialog.querySelector<HTMLElement>("[data-maker-overlay]")!;
    const fire = (name: string, x: number, y: number, target: Element = overlay) => target.dispatchEvent(new MouseEvent(name, { bubbles: true, clientX: x, clientY: y }));
    fire("pointerdown", 400, 90, dialog.querySelector("[data-selected-box]")!); fire("pointermove", 430, 120); fire("pointerup", 430, 120);
    fire("pointerdown", 680, 120, dialog.querySelector('[data-resize-handle="right"]')!); fire("pointermove", 700, 120); fire("pointerup", 700, 120);
    expect(dialog.querySelector<HTMLInputElement>('[name="background_x"]')?.value).toBe("0");
    expect(dialog.querySelector<HTMLInputElement>('[name="background_y"]')?.value).toBe("0");
  });

  it("ignores a stale template image load after a fast switch", async () => {
    let resolveFirst!: (value: ReturnType<typeof loaded>) => void;
    const loaded = (width: number) => ({ source: {} as CanvasImageSource, width, height: 600, dispose: vi.fn() });
    const first = new Promise<ReturnType<typeof loaded>>(resolve => { resolveFirst = resolve; });
    const second = loaded(900);
    const { dialog, loadImage } = setup({ listTemplates: vi.fn().mockResolvedValue([staticTemplate, { ...staticTemplate, id: 4, name: "Second" }]) });
    loadImage.mockReset().mockReturnValueOnce(first).mockResolvedValueOnce(second);
    await vi.waitFor(() => expect(dialog.querySelectorAll('select[name="template_id"] option').length).toBe(3));
    const select = dialog.querySelector<HTMLSelectElement>('[name="template_id"]')!;
    select.value = "1"; select.dispatchEvent(new Event("change"));
    select.value = "4"; select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(dialog.querySelector("[data-resolution]")?.textContent).toBe("900 × 600 PNG"));
    const stale = loaded(700); resolveFirst(stale);
    await Promise.resolve();
    expect(dialog.querySelector("[data-resolution]")?.textContent).toBe("900 × 600 PNG");
    expect(stale.dispose).toHaveBeenCalled();
  });

  it("exports image/png with a safe PNG filename and rejects empty captions", async () => {
    const { dialog } = setup();
    await choose(dialog);
    dialog.querySelector<HTMLButtonElement>("[data-export-maker]")!.click();
    expect(dialog.querySelector("[data-maker-notice]")?.textContent).toContain("至少输入一段文字");
    type(dialog, "box_text", "Top");
    dialog.querySelector<HTMLButtonElement>("[data-export-maker]")!.click();
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it("reports export failure", async () => {
    const { dialog } = setup();
    await choose(dialog);
    type(dialog, "box_text", "Top");
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(null));
    dialog.querySelector<HTMLButtonElement>("[data-export-maker]")!.click();
    await vi.waitFor(() => expect(dialog.querySelector("[data-maker-notice]")?.textContent).toContain("图片导出失败"));
  });

  it("saves through existing upload with maker metadata and preserves state on duplicate", async () => {
    const onSaved = vi.fn();
    const { dialog, api } = setup();
    await choose(dialog);
    type(dialog, "box_text", "Top");
    type(dialog, "title", "My Meme");
    dialog.querySelector<HTMLButtonElement>("[data-save-maker]")!.click();
    await vi.waitFor(() => expect(api.uploadMeme).toHaveBeenCalled());
    expect(api.uploadMeme).toHaveBeenCalledWith(expect.objectContaining({
      title: "My Meme", template_id: 1, source: "meme-maker", tags: [],
      file: expect.objectContaining({ type: "image/png" }),
    }));
    expect(dialog.querySelector("[data-maker-notice]")?.textContent).toContain("Meme #8");

    vi.mocked(api.uploadMeme).mockRejectedValueOnce(new ApiError(409, "该图片已存在"));
    dialog.querySelector<HTMLButtonElement>("[data-save-maker]")!.click();
    await vi.waitFor(() => expect(dialog.querySelector("[data-maker-notice]")?.textContent).toBe("该图片已存在"));
    expect(dialog.querySelector<HTMLTextAreaElement>('[name="box_text"]')?.value).toBe("Top");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("uses the identical transformed background for preview, export and template save", async () => {
    const { dialog, api, context } = setup(); await choose(dialog); type(dialog, "box_text", "Crop"); type(dialog, "title", "Crop Meme");
    dialog.querySelector<HTMLButtonElement>('[data-aspect-preset="1:1"]')!.click();
    type(dialog, "background_scale", "150"); type(dialog, "background_x", "12.5"); type(dialog, "background_y", "-7.5");
    await vi.waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    vi.mocked(context.drawImage).mockClear();
    dialog.querySelector<HTMLButtonElement>("[data-export-maker]")!.click();
    await vi.waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const exportRect = vi.mocked(context.drawImage).mock.calls.at(-1)?.slice(1);
    expect(exportRect).toEqual([-225, -195, 1200, 900]);
    vi.mocked(context.drawImage).mockClear();
    dialog.querySelector<HTMLButtonElement>("[data-save-maker]")!.click();
    await vi.waitFor(() => expect(api.uploadMeme).toHaveBeenCalled());
    expect(vi.mocked(context.drawImage).mock.calls.at(-1)?.slice(1)).toEqual(exportRect);
    expect(api.uploadMeme).toHaveBeenCalledWith(expect.objectContaining({ template_id: 1, source: "meme-maker" }));
  });

  it("copies and pastes only style fields, resets style, and supports undo", async () => {
    const { dialog } = setup(); await choose(dialog); type(dialog, "box_text", "Source"); type(dialog, "box_x", "35"); type(dialog, "box_width", "45");
    type(dialog, "box_fill_color", "#ff0000"); type(dialog, "box_line_height", "1.5"); type(dialog, "box_letter_spacing", "3");
    const background = dialog.querySelector<HTMLInputElement>('[name="box_background_enabled"]')!; background.checked = true; background.dispatchEvent(new Event("change", { bubbles: true }));
    const paste = dialog.querySelector<HTMLButtonElement>("[data-paste-text-style]")!; expect(paste.disabled).toBe(true);
    dialog.querySelector<HTMLButtonElement>("[data-copy-text-style]")!.click(); expect(paste.disabled).toBe(false);
    dialog.querySelector<HTMLButtonElement>("[data-add-text-box]")!.click(); type(dialog, "box_text", "Target"); type(dialog, "box_x", "70"); type(dialog, "box_width", "60");
    paste.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="box_fill_color"]')?.value).toBe("#ff0000");
    expect(dialog.querySelector<HTMLInputElement>('[name="box_line_height"]')?.value).toBe("1.5");
    expect(dialog.querySelector<HTMLTextAreaElement>('[name="box_text"]')?.value).toBe("Target");
    expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe("70"); expect(dialog.querySelector<HTMLInputElement>('[name="box_width"]')?.value).toBe("60");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click(); expect(dialog.querySelector<HTMLInputElement>('[name="box_fill_color"]')?.value).toBe("#ffffff");
    dialog.querySelector<HTMLButtonElement>("[data-redo]")!.click(); dialog.querySelector<HTMLButtonElement>("[data-reset-text-style]")!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="box_fill_color"]')?.value).toBe("#ffffff");
    expect(dialog.querySelector<HTMLTextAreaElement>('[name="box_text"]')?.value).toBe("Target"); expect(dialog.querySelector<HTMLInputElement>('[name="box_x"]')?.value).toBe("70");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click(); expect(dialog.querySelector<HTMLInputElement>('[name="box_fill_color"]')?.value).toBe("#ff0000");
  });

  it("updates custom output size with predictable aspect locking and canvas color history", async () => {
    const { dialog, context } = setup(); await choose(dialog);
    dialog.querySelector<HTMLButtonElement>('[data-output-size="1080x1080"]')!.click();
    expect(dialog.querySelector("[data-resolution]")?.textContent).toBe("1080 × 1080 PNG");
    const width = dialog.querySelector<HTMLInputElement>('[name="output_width"]')!; width.focus(); width.value = "1200"; width.dispatchEvent(new Event("change", { bubbles: true })); width.blur();
    expect(dialog.querySelector<HTMLInputElement>('[name="output_height"]')?.value).toBe("1200");
    const lock = dialog.querySelector<HTMLInputElement>('[name="lock_aspect"]')!; lock.checked = false; lock.dispatchEvent(new Event("change", { bubbles: true }));
    const height = dialog.querySelector<HTMLInputElement>('[name="output_height"]')!; height.value = "700"; height.dispatchEvent(new Event("change", { bubbles: true }));
    expect(width.value).toBe("1200"); expect(height.value).toBe("700");
    width.value = "99999"; width.dispatchEvent(new Event("change", { bubbles: true })); expect(width.value).toBe("4096");
    const color = dialog.querySelector<HTMLInputElement>('[name="canvas_background_color"]')!; color.value = "#123456"; color.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(context.fillRect).toHaveBeenCalled());
    expect(color.value).toBe("#123456");
    dialog.querySelector<HTMLButtonElement>("[data-undo]")!.click(); await vi.waitFor(() => expect(color.value).toBe("#ffffff"));
    dialog.querySelector<HTMLButtonElement>("[data-redo]")!.click(); await vi.waitFor(() => expect(color.value).toBe("#123456"));
  });
});
