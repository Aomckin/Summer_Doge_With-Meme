import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import {
  BatchUploadController,
  type BatchUploadResult,
} from "./batch-upload";
import type {
  MemeResponse,
  TemplateResponse,
  UploadMemeInput,
} from "./types";

const template: TemplateResponse = {
  id: 3,
  name: "Doge",
  description: null,
  reference_image_url: null,
  reference_thumbnail_url: null,
  reference_mime_type: null,
  reference_width: null,
  reference_height: null,
  created_at: "2026-07-30T00:00:00Z",
  updated_at: "2026-07-30T00:00:00Z",
};

function meme(id: number, title: string): MemeResponse {
  return {
    id,
    title,
    description: null,
    source: null,
    original_filename: `${title}.png`,
    stored_filename: `${id}.png`,
    image_url: `/media/images/${id}.png`,
    thumbnail_url: `/media/thumbnails/${id}.png`,
    mime_type: "image/png",
    file_size: 3,
    width: 10,
    height: 10,
    file_hash: `hash-${id}`,
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z",
    tags: [],
    template: null,
    images: [],
    image_count: 1,
  };
}

function image(name: string): File {
  return new File([name], name, { type: "image/png" });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) {
    throw new Error(`Missing button: ${label}`);
  }
  return match;
}

function input(name: string): HTMLInputElement {
  const match = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!match) {
    throw new Error(`Missing input: ${name}`);
  }
  return match;
}

function choose(files: File[]): void {
  const picker = input("batch_files");
  Object.defineProperty(picker, "files", {
    configurable: true,
    value: files,
  });
  picker.dispatchEvent(new Event("change", { bubbles: true }));
}

function drop(files: File[]): void {
  const zone = document.querySelector<HTMLElement>("[data-batch-drop-zone]");
  if (!zone) {
    throw new Error("Missing drop zone");
  }
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  zone.dispatchEvent(event);
}

function createController(
  uploadMeme = vi
    .fn<(input: UploadMemeInput) => Promise<MemeResponse>>()
    .mockImplementation(async (item) => meme(1, item.title)),
  onComplete = vi.fn<(result: BatchUploadResult) => Promise<void>>(
    async () => undefined,
  ),
  confirmClose = vi.fn(() => true),
) {
  const controller = new BatchUploadController({
    uploadMeme,
    onComplete,
    confirmClose,
  });
  controller.open([template]);
  return { controller, uploadMeme, onComplete, confirmClose };
}

beforeEach(() => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("BatchUploadController", () => {
  it("adds selected and dropped images with previews and filename titles", () => {
    createController();

    choose([image("first.panel.png"), image("second.jpg")]);
    drop([image("third.webp")]);

    const rows = [...document.querySelectorAll<HTMLElement>("[data-batch-item]")];
    expect(rows.map((row) => row.dataset.title)).toEqual([
      "first.panel",
      "second",
      "third",
    ]);
    expect(rows.map((row) => row.querySelector("img")?.getAttribute("src"))).toEqual([
      "blob:first.panel.png",
      "blob:second.jpg",
      "blob:third.webp",
    ]);
  });

  it("removes one image and clears the queue before upload", () => {
    createController();
    choose([image("one.png"), image("two.png"), image("three.png")]);

    document
      .querySelector<HTMLButtonElement>('[data-remove-batch-item="1"]')
      ?.click();
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-batch-item]")].map(
        (row) => row.dataset.title,
      ),
    ).toEqual(["one", "three"]);

    button("清空全部").click();
    expect(document.querySelectorAll("[data-batch-item]")).toHaveLength(0);
  });

  it("uploads an edited item title and locks it after upload starts", () => {
    const pending = deferred<MemeResponse>();
    const uploadMeme = vi
      .fn<(input: UploadMemeInput) => Promise<MemeResponse>>()
      .mockReturnValue(pending.promise);
    createController(uploadMeme);
    choose([image("generated-name.png")]);
    const titleInput = document.querySelector<HTMLInputElement>(
      '[data-batch-title="0"]',
    );
    if (!titleInput) throw new Error("Missing item title input");
    expect(titleInput.value).toBe("generated-name");

    titleInput.value = "自定义标题";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    button("开始上传").click();

    expect(uploadMeme).toHaveBeenCalledWith(
      expect.objectContaining({ title: "自定义标题" }),
    );
    expect(
      document.querySelector<HTMLInputElement>(
        '[data-batch-title="0"]',
      )?.disabled,
    ).toBe(true);
  });

  it("applies shared metadata to every image in strict serial order", async () => {
    const first = deferred<MemeResponse>();
    const second = deferred<MemeResponse>();
    const uploadMeme = vi
      .fn<(input: UploadMemeInput) => Promise<MemeResponse>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    createController(uploadMeme);
    choose([image("first.png"), image("second.png")]);
    input("tags").value = " funny, Reaction ";
    input("source").value = "Discord";
    const templateSelect =
      document.querySelector<HTMLSelectElement>('[name="template_id"]');
    if (!templateSelect) throw new Error("Missing template select");
    templateSelect.value = "3";

    button("开始上传").click();
    expect(uploadMeme).toHaveBeenCalledTimes(1);
    expect(uploadMeme).toHaveBeenNthCalledWith(1, {
      file: expect.objectContaining({ name: "first.png" }),
      title: "first",
      description: "",
      source: "Discord",
      tags: ["funny", "reaction"],
      template_id: 3,
    });

    first.resolve(meme(1, "first"));
    await vi.waitFor(() => expect(uploadMeme).toHaveBeenCalledTimes(2));
    expect(uploadMeme).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        title: "second",
        source: "Discord",
        tags: ["funny", "reaction"],
        template_id: 3,
      }),
    );
    second.resolve(meme(2, "second"));
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLDialogElement>("[data-batch-dialog]")?.open,
      ).toBe(false),
    );
  });

  it("continues after failures and classifies HTTP 409 as skipped", async () => {
    const uploadMeme = vi
      .fn<(input: UploadMemeInput) => Promise<MemeResponse>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new ApiError(409, "any language"))
      .mockResolvedValueOnce(meme(3, "third"));
    const { onComplete } = createController(uploadMeme);
    choose([image("first.png"), image("second.png"), image("third.png")]);

    button("开始上传").click();

    await vi.waitFor(() => expect(uploadMeme).toHaveBeenCalledTimes(3));
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-batch-item]")].map(
        (row) => row.dataset.status,
      ),
    ).toEqual(["failed", "skipped", "success"]);
    expect(document.body.textContent).toContain("offline");
    expect(
      document.querySelector<HTMLDialogElement>("[data-batch-dialog]")?.open,
    ).toBe(true);
    expect(onComplete).toHaveBeenCalledWith({
      success: 1,
      skipped: 1,
      failed: 1,
    });
  });

  it("stops after the current request and resumes pending uploads", async () => {
    const first = deferred<MemeResponse>();
    const uploadMeme = vi
      .fn<(input: UploadMemeInput) => Promise<MemeResponse>>()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (item) => meme(2, item.title));
    createController(uploadMeme);
    choose([image("first.png"), image("second.png")]);

    button("开始上传").click();
    button("停止上传").click();
    first.resolve(meme(1, "first"));

    await vi.waitFor(() => {
      expect(uploadMeme).toHaveBeenCalledTimes(1);
      expect(button("继续上传").disabled).toBe(false);
    });
    expect(
      document.querySelector<HTMLElement>(
        '[data-batch-item][data-title="second"]',
      )?.dataset.status,
    ).toBe("pending");

    button("继续上传").click();
    await vi.waitFor(() => expect(uploadMeme).toHaveBeenCalledTimes(2));
  });

  it("retries only failed items and preserves success and skipped items", async () => {
    const uploadMeme = vi
      .fn<(input: UploadMemeInput) => Promise<MemeResponse>>()
      .mockResolvedValueOnce(meme(1, "one"))
      .mockRejectedValueOnce(new ApiError(409, "duplicate"))
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(meme(3, "three"));
    createController(uploadMeme);
    choose([image("one.png"), image("two.png"), image("three.png")]);

    button("开始上传").click();
    await vi.waitFor(() => expect(uploadMeme).toHaveBeenCalledTimes(3));
    button("重试失败项").click();

    await vi.waitFor(() => expect(uploadMeme).toHaveBeenCalledTimes(4));
    expect(uploadMeme.mock.calls.map(([item]) => item.title)).toEqual([
      "one",
      "two",
      "three",
      "three",
    ]);
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLDialogElement>("[data-batch-dialog]")?.open,
      ).toBe(false),
    );
  });

  it("auto-closes when every item succeeds or skips and reports statistics", async () => {
    const uploadMeme = vi
      .fn<(input: UploadMemeInput) => Promise<MemeResponse>>()
      .mockResolvedValueOnce(meme(1, "one"))
      .mockRejectedValueOnce(new ApiError(409, "duplicate"));
    const { onComplete } = createController(uploadMeme);
    choose([image("one.png"), image("two.png")]);

    button("开始上传").click();

    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLDialogElement>("[data-batch-dialog]")?.open,
      ).toBe(false),
    );
    expect(onComplete).toHaveBeenCalledWith({
      success: 1,
      skipped: 1,
      failed: 0,
    });
    expect(
      document.querySelector("[data-batch-result]")?.textContent,
    ).toContain("成功 1，跳过 1，失败 0");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one.png");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:two.png");
  });

  it("confirms before closing a queue with unfinished work", () => {
    const confirmClose = vi.fn(() => false);
    const { controller } = createController(undefined, undefined, confirmClose);
    choose([image("unfinished.png")]);

    button("关闭").click();
    expect(confirmClose).toHaveBeenCalledOnce();
    expect(
      document.querySelector<HTMLDialogElement>("[data-batch-dialog]")?.open,
    ).toBe(true);

    confirmClose.mockReturnValue(true);
    controller.requestClose();
    expect(
      document.querySelector<HTMLDialogElement>("[data-batch-dialog]")?.open,
    ).toBe(false);
  });
});
