import { describe, expect, it, vi } from "vitest";
import { MemeCopyError, copyImageToClipboard } from "./meme-actions";

class TestClipboardItem {
  constructor(readonly data: Record<string, Blob>) {}
}

function source(mime_type = "image/png") {
  return { image_url: "/media/test", mime_type };
}

describe("copyImageToClipboard", () => {
  it("writes PNG bytes directly", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const write = vi.fn().mockResolvedValue(undefined);
    await copyImageToClipboard(source(), {
      fetch: vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) } as Response),
      clipboard: { write },
      ClipboardItem: TestClipboardItem as unknown as typeof ClipboardItem,
    });
    const item = write.mock.calls[0][0][0] as TestClipboardItem;
    expect(item.data["image/png"].type).toBe("image/png");
    expect(await item.data["image/png"].text()).toBe("png");
  });

  it.each(["image/jpeg", "image/webp"])("converts %s to a same-size PNG", async mime => {
    const write = vi.fn().mockResolvedValue(undefined);
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: BlobCallback) => callback(new Blob(["png"], { type: "image/png" })),
    } as unknown as HTMLCanvasElement;
    const bitmap = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
    await copyImageToClipboard(source(mime), {
      fetch: vi.fn().mockResolvedValue(new Response(new Blob(["image"], { type: mime }))),
      createImageBitmap: vi.fn().mockResolvedValue(bitmap),
      createCanvas: () => canvas,
      clipboard: { write },
      ClipboardItem: TestClipboardItem as unknown as typeof ClipboardItem,
    });
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(write).toHaveBeenCalledOnce();
  });

  it("rejects GIF instead of copying its first frame", async () => {
    await expect(copyImageToClipboard(source("image/gif"), {})).rejects.toMatchObject({
      code: "gif-unsupported",
    });
  });

  it("reports unsupported clipboard browsers", async () => {
    await expect(copyImageToClipboard(source(), { clipboard: undefined, ClipboardItem: undefined }))
      .rejects.toMatchObject({ code: "browser-unsupported" } satisfies Partial<MemeCopyError>);
  });

  it("reports image fetch failures", async () => {
    await expect(copyImageToClipboard(source(), {
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
      clipboard: { write: vi.fn() },
      ClipboardItem: TestClipboardItem as unknown as typeof ClipboardItem,
    })).rejects.toMatchObject({ code: "fetch-failed" } satisfies Partial<MemeCopyError>);
  });

  it("reports denied clipboard permission", async () => {
    const denied = new DOMException("denied", "NotAllowedError");
    await expect(copyImageToClipboard(source(), {
      fetch: vi.fn().mockResolvedValue(new Response(new Blob(["png"], { type: "image/png" }))),
      clipboard: { write: vi.fn().mockRejectedValue(denied) },
      ClipboardItem: TestClipboardItem as unknown as typeof ClipboardItem,
    })).rejects.toMatchObject({ code: "permission-denied" } satisfies Partial<MemeCopyError>);
  });
});
