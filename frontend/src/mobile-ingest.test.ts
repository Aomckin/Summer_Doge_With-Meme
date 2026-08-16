import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { MobileIngestController } from "./mobile-ingest";
import type { MemeResponse, UploadMemeInput } from "./types";

function meme(id: number, title: string): MemeResponse {
  return {
    id,
    title,
    description: null,
    source: "mobile-ingest",
    original_filename: `${title}.png`,
    stored_filename: `${id}.png`,
    image_url: `/media/images/${id}.png`,
    thumbnail_url: `/media/thumbnails/${id}.png`,
    mime_type: "image/png",
    file_size: 3,
    width: 10,
    height: 10,
    file_hash: `hash-${id}`,
    created_at: "2026-08-16T00:00:00Z",
    updated_at: "2026-08-16T00:00:00Z",
    tags: [],
    template: null,
    images: [],
    image_count: 1,
  };
}

function file(name: string, type = "image/png"): File {
  return new File([name], name, { type });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("MobileIngestController", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<main id="mobile-ingest"></main>';
    root = document.querySelector<HTMLElement>("#mobile-ingest")!;
  });

  it("starts idle and asks for files when upload is invoked empty", async () => {
    const uploadMeme = vi.fn<(input: UploadMemeInput) => Promise<MemeResponse>>();
    const controller = new MobileIngestController(root, { uploadMeme });

    await controller.upload();

    expect(uploadMeme).not.toHaveBeenCalled();
    expect(root.textContent).toContain("请先从相册选择至少一张图片");
    expect(controller.snapshot().status).toBe("idle");
  });

  it("shows selected filenames and uploads multiple files serially", async () => {
    const first = deferred<MemeResponse>();
    const uploadMeme = vi
      .fn<(input: UploadMemeInput) => Promise<MemeResponse>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(meme(2, "第二张"));
    const controller = new MobileIngestController(root, { uploadMeme });
    controller.selectFiles([file("中文 空格.png"), file("funny.gif", "image/gif")]);

    const uploading = controller.upload();
    expect(uploadMeme).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain("上传中 1 / 2");
    expect(root.querySelector<HTMLInputElement>("#mobile-files")?.disabled).toBe(true);

    first.resolve(meme(1, "中文 空格"));
    await uploading;

    expect(uploadMeme).toHaveBeenCalledTimes(2);
    expect(uploadMeme.mock.calls[0][0]).toMatchObject({ title: "中文 空格", source: "mobile-ingest" });
    expect(uploadMeme.mock.calls[1][0]).toMatchObject({ title: "funny", source: "mobile-ingest" });
    expect(controller.snapshot()).toMatchObject({ status: "success", successCount: 2, completedCount: 2 });
    expect(root.textContent).toContain("2 张 Meme 已入库");
  });

  it("reports partial failures by filename and can start a fresh round", async () => {
    const uploadMeme = vi
      .fn<(input: UploadMemeInput) => Promise<MemeResponse>>()
      .mockResolvedValueOnce(meme(1, "ok"))
      .mockRejectedValueOnce(new ApiError(415, "invalid"))
      .mockResolvedValueOnce(meme(3, "next"));
    const controller = new MobileIngestController(root, { uploadMeme });
    controller.selectFiles([file("ok.webp", "image/webp"), file("坏图<script>.txt", "text/plain")]);

    await controller.upload();

    expect(controller.snapshot()).toMatchObject({ status: "partial_failure", successCount: 1 });
    expect(root.textContent).toContain("成功 1 张，失败 1 张");
    expect(root.textContent).toContain("坏图<script>.txt");
    expect(root.querySelector("script")).toBeNull();

    root.querySelector<HTMLButtonElement>("[data-continue]")?.click();
    expect(controller.snapshot()).toMatchObject({ status: "idle", selectedCount: 0 });

    controller.selectFiles([file("next.webp", "image/webp")]);
    await controller.upload();
    expect(controller.snapshot().status).toBe("success");
    expect(uploadMeme).toHaveBeenCalledTimes(3);
  });

  it("always leaves uploading state after a network failure", async () => {
    const uploadMeme = vi
      .fn<(input: UploadMemeInput) => Promise<MemeResponse>>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const controller = new MobileIngestController(root, { uploadMeme });
    controller.selectFiles([file("断线.png")]);

    await controller.upload();

    expect(controller.snapshot().status).toBe("failure");
    expect(root.textContent).toContain("无法连接 Meme Vault");
    expect(root.textContent).not.toContain("正在上传…");
  });
});
