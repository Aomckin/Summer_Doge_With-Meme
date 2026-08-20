import type { MemeImageResponse, MemeResponse } from "./types";

export type CopyErrorCode =
  | "browser-unsupported"
  | "gif-unsupported"
  | "composite-unsupported"
  | "fetch-failed"
  | "conversion-failed"
  | "permission-denied"
  | "clipboard-failed";

export class MemeCopyError extends Error {
  constructor(public readonly code: CopyErrorCode, message: string) {
    super(message);
    this.name = "MemeCopyError";
  }
}

export interface CopyImageSource {
  image_url: string;
  mime_type: string;
}

interface CopyDependencies {
  fetch: typeof fetch;
  createImageBitmap: typeof createImageBitmap;
  clipboard: Pick<Clipboard, "write"> | undefined;
  ClipboardItem: typeof ClipboardItem | undefined;
  createCanvas(): HTMLCanvasElement;
}

function dependencies(): CopyDependencies {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    createImageBitmap: globalThis.createImageBitmap?.bind(globalThis),
    clipboard: globalThis.navigator?.clipboard,
    ClipboardItem: globalThis.ClipboardItem,
    createCanvas: () => document.createElement("canvas"),
  } as CopyDependencies;
}

function normalizedMime(value: string): string {
  return value.toLowerCase().split(";", 1)[0].trim();
}

export function clipboardImageSupported(): boolean {
  const current = dependencies();
  return typeof current.clipboard?.write === "function" && typeof current.ClipboardItem === "function";
}

export function memeCopySource(meme: MemeResponse): CopyImageSource | null {
  if (meme.image_count !== 1) return null;
  const image = meme.images[0];
  return image
    ? { image_url: image.image_url, mime_type: image.mime_type }
    : { image_url: meme.image_url, mime_type: meme.mime_type };
}

export function copyUnavailableReason(source: CopyImageSource | null): string | null {
  if (!source) return "复合 Meme 请先选择其中一张图片";
  if (!clipboardImageSupported()) return "当前浏览器不支持图片剪贴板，请使用下载";
  return null;
}

async function convertToPng(blob: Blob, current: CopyDependencies): Promise<Blob> {
  try {
    if (typeof current.createImageBitmap !== "function") throw new Error("createImageBitmap unavailable");
    const bitmap = await current.createImageBitmap(blob);
    const canvas = current.createCanvas();
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("PNG encoding failed");
    return png;
  } catch (error) {
    if (error instanceof MemeCopyError) throw error;
    throw new MemeCopyError("conversion-failed", "图片转换失败，请使用下载");
  }
}

export async function copyImageToClipboard(
  source: CopyImageSource,
  overrides: Partial<CopyDependencies> = {},
): Promise<void> {
  const current = { ...dependencies(), ...overrides };
  const mime = normalizedMime(source.mime_type);
  if (typeof current.clipboard?.write !== "function" || typeof current.ClipboardItem !== "function") {
    throw new MemeCopyError("browser-unsupported", "当前浏览器不支持图片剪贴板，请使用下载");
  }

  let blob: Blob;
  try {
    const response = await current.fetch(source.image_url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
  } catch {
    throw new MemeCopyError("fetch-failed", "原图读取失败，请稍后重试或使用下载");
  }

  const isGif = mime === "image/gif";
  const output = isGif || mime === "image/png" ? blob : await convertToPng(blob, current);
  try {
    const outputMime = isGif ? "image/gif" : "image/png";
    const item = new current.ClipboardItem({ [outputMime]: output });
    await current.clipboard.write([item]);
  } catch (error) {
    const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new MemeCopyError("permission-denied", "没有剪贴板权限，请允许访问后重试");
    }
    if (isGif) {
      throw new MemeCopyError("gif-unsupported", "当前浏览器无法直接复制动态 GIF，请使用下载。");
    }
    throw new MemeCopyError("clipboard-failed", "复制失败，请重试或使用下载");
  }
}

let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

export function showMemeActionFeedback(message: string, error = false): void {
  let toast = document.querySelector<HTMLElement>("[data-meme-action-feedback]");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "meme-action-feedback";
    toast.dataset.memeActionFeedback = "";
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.dataset.kind = error ? "error" : "success";
  toast.setAttribute("role", error ? "alert" : "status");
  toast.hidden = false;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { if (toast) toast.hidden = true; }, 2600);
}

export async function copySourceWithFeedback(
  source: CopyImageSource | null,
  button?: HTMLButtonElement,
): Promise<boolean> {
  if (button?.disabled) return false;
  const reason = copyUnavailableReason(source);
  if (reason) {
    showMemeActionFeedback(reason, true);
    return false;
  }
  const label = button?.textContent ?? "";
  if (button) {
    button.disabled = true;
    button.textContent = "复制中…";
  }
  try {
    await copyImageToClipboard(source!);
    showMemeActionFeedback(normalizedMime(source!.mime_type) === "image/gif" ? "GIF 已复制，可直接粘贴到聊天窗口" : "图片已复制，可直接粘贴到聊天窗口");
    return true;
  } catch (error) {
    showMemeActionFeedback(error instanceof Error ? error.message : "复制失败，请使用下载", true);
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}

export function memeImageAt(meme: MemeResponse, index: number): CopyImageSource {
  const image: MemeImageResponse | undefined = meme.images[index];
  return image
    ? { image_url: image.image_url, mime_type: image.mime_type }
    : { image_url: meme.image_url, mime_type: meme.mime_type };
}
