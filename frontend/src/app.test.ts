import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemeVaultApp, type MemeApi } from "./app";
import type { MemeResponse, TagResponse } from "./types";

const funnyTag: TagResponse = {
  id: 1,
  name: "funny",
  category: "custom",
  description: null,
  created_at: "2026-07-25T00:00:00Z",
};

function makeMeme(id: number, title = `Meme ${id}`): MemeResponse {
  return {
    id,
    title,
    description: `描述 ${id}`,
    source: "本地",
    original_filename: `${id}.png`,
    stored_filename: `stored-${id}.png`,
    image_url: `/media/images/stored-${id}.png`,
    thumbnail_url: `/media/thumbnails/stored-${id}.png`,
    mime_type: "image/png",
    file_size: 1024,
    width: 320,
    height: 240,
    file_hash: `hash-${id}`,
    created_at: "2026-07-25T00:00:00Z",
    updated_at: "2026-07-25T00:00:00Z",
    tags: [funnyTag],
  };
}

function makeApi(overrides: Partial<MemeApi> = {}): MemeApi {
  return {
    listMemes: vi.fn().mockResolvedValue([]),
    listTags: vi.fn().mockResolvedValue([funnyTag]),
    getRandomMeme: vi.fn().mockResolvedValue(makeMeme(99, "随机 Meme")),
    uploadMeme: vi.fn().mockResolvedValue(makeMeme(2, "新上传")),
    updateMeme: vi.fn().mockResolvedValue(makeMeme(2, "已编辑")),
    deleteMeme: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
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

function root(): HTMLElement {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) {
    throw new Error("Missing app root");
  }
  return element;
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.includes(label),
  );
  if (!match) {
    throw new Error(`Missing button: ${label}`);
  }
  return match;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("MemeVaultApp", () => {
  it("loads the library, appends another page and filters by tag", async () => {
    const firstPage = Array.from({ length: 24 }, (_, index) =>
      makeMeme(index + 1),
    );
    const api = makeApi({
      listMemes: vi
        .fn()
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce([makeMeme(25)])
        .mockResolvedValueOnce([makeMeme(1)]),
    });
    const app = new MemeVaultApp(root(), api);

    await app.start();
    expect(document.querySelectorAll("[data-meme-id]")).toHaveLength(24);

    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    expect(document.querySelector("[data-detail-title]")?.textContent).toBe(
      "Meme 1",
    );

    button("加载更多").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-meme-id]")).toHaveLength(25);
    });

    button("funny").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-meme-id]")).toHaveLength(1);
    });
    expect(api.listMemes).toHaveBeenLastCalledWith(
      expect.objectContaining({
        offset: 0,
        limit: 24,
        tags: ["funny"],
      }),
    );
  });

  it("debounces search and randomizes only within selected tags", async () => {
    vi.useFakeTimers();
    const api = makeApi();
    const app = new MemeVaultApp(root(), api);
    await app.start();

    button("funny").click();
    await vi.runAllTimersAsync();

    const search = document.querySelector<HTMLInputElement>("#meme-search");
    if (!search) {
      throw new Error("Missing search input");
    }
    search.value = " reaction ";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(299);
    expect(api.listMemes).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "reaction" }),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(api.listMemes).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "reaction", tags: ["funny"] }),
    );

    button("随机一个").click();
    await vi.runAllTimersAsync();
    expect(api.getRandomMeme).toHaveBeenCalledWith(["funny"]);
    expect(document.querySelector("[data-detail-title]")?.textContent).toBe(
      "随机 Meme",
    );
  });

  it("uploads, edits and deletes the selected Meme", async () => {
    const created = makeMeme(2, "新上传");
    const edited = {
      ...created,
      title: "已编辑",
      description: null,
      source: null,
      tags: [{ ...funnyTag, name: "reaction" }],
    };
    const api = makeApi({
      listMemes: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([created])
        .mockResolvedValueOnce([edited])
        .mockResolvedValueOnce([]),
      uploadMeme: vi.fn().mockResolvedValue(created),
      updateMeme: vi.fn().mockResolvedValue(edited),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    button("上传 Meme").click();
    const dialog = document.querySelector<HTMLDialogElement>("#upload-dialog");
    const uploadForm = document.querySelector<HTMLFormElement>("#upload-form");
    const fileInput =
      document.querySelector<HTMLInputElement>("#upload-file");
    if (!dialog || !uploadForm || !fileInput) {
      throw new Error("Missing upload controls");
    }
    const file = new File(["image"], "new.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    const titleInput = uploadForm.elements.namedItem("title") as HTMLInputElement;
    titleInput.value = "新上传";
    uploadForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(dialog.open).toBe(false);
      expect(document.querySelector("[data-detail-title]")?.textContent).toBe(
        "新上传",
      );
    });

    button("编辑").click();
    const editForm = document.querySelector<HTMLFormElement>("#edit-form");
    if (!editForm) {
      throw new Error("Missing edit form");
    }
    (editForm.elements.namedItem("title") as HTMLInputElement).value = "已编辑";
    (editForm.elements.namedItem("description") as HTMLTextAreaElement).value =
      "";
    (editForm.elements.namedItem("source") as HTMLInputElement).value = "";
    (editForm.elements.namedItem("tags") as HTMLInputElement).value =
      "Reaction";
    editForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(document.querySelector("[data-detail-title]")?.textContent).toBe(
        "已编辑",
      );
    });
    expect(api.updateMeme).toHaveBeenCalledWith(2, {
      title: "已编辑",
      description: null,
      source: null,
      tags: ["reaction"],
    });

    button("删除").click();
    await vi.waitFor(() => {
      expect(api.deleteMeme).toHaveBeenCalledWith(2);
      expect(document.querySelector("[data-detail-title]")).toBeNull();
    });
  });

  it("shows a retry action when the list request fails", async () => {
    const listMemes = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([makeMeme(1)]);
    const app = new MemeVaultApp(root(), makeApi({ listMemes }));

    await app.start();
    expect(document.querySelector("[data-list-error]")?.textContent).toContain(
      "网络请求失败",
    );

    button("重试").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-meme-id]")).toHaveLength(1);
    });
  });

  it("shows a random request error while the library is empty", async () => {
    const api = makeApi({
      getRandomMeme: vi.fn().mockRejectedValue(new Error("empty")),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    button("随机一个").click();

    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-action-error]")?.textContent,
      ).toContain("网络请求失败");
    });
  });

  it("keeps loaded cards and retries the same page after load-more fails", async () => {
    const firstPage = Array.from({ length: 24 }, (_, index) =>
      makeMeme(index + 1),
    );
    const listMemes = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([makeMeme(25)]);
    const app = new MemeVaultApp(root(), makeApi({ listMemes }));
    await app.start();

    button("加载更多").click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-more-error]")).not.toBeNull();
    });
    expect(document.querySelectorAll("[data-meme-id]")).toHaveLength(24);

    button("重试加载").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-meme-id]")).toHaveLength(25);
    });
    expect(listMemes).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 24, limit: 24 }),
    );
  });

  it("does not let a completed edit replace a newer selection", async () => {
    const first = makeMeme(1, "第一个");
    const second = makeMeme(2, "第二个");
    const updated = { ...first, title: "第一个已编辑" };
    const pendingUpdate = deferred<MemeResponse>();
    const api = makeApi({
      listMemes: vi
        .fn()
        .mockResolvedValueOnce([first, second])
        .mockResolvedValueOnce([updated, second]),
      updateMeme: vi.fn().mockReturnValue(pendingUpdate.promise),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    button("编辑").click();
    const editForm = document.querySelector<HTMLFormElement>("#edit-form");
    if (!editForm) {
      throw new Error("Missing edit form");
    }
    (editForm.elements.namedItem("title") as HTMLInputElement).value =
      "第一个已编辑";
    editForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    document.querySelector<HTMLButtonElement>('[data-meme-id="2"]')?.click();

    pendingUpdate.resolve(updated);
    await vi.waitFor(() => {
      expect(api.listMemes).toHaveBeenCalledTimes(2);
      expect(api.listTags).toHaveBeenCalledTimes(2);
      expect(document.querySelector("[data-detail-title]")?.textContent).toBe(
        "第二个",
      );
    });
  });

  it("reapplies filters after editing and reloads pagination after delete", async () => {
    const firstPage = Array.from({ length: 24 }, (_, index) =>
      makeMeme(index + 1),
    );
    const updated = {
      ...firstPage[0],
      tags: [{ ...funnyTag, name: "reaction" }],
    };
    const shiftedPage = Array.from({ length: 24 }, (_, index) =>
      makeMeme(index + 2),
    );
    const listMemes = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([]);
    const api = makeApi({
      listMemes,
      updateMeme: vi.fn().mockResolvedValue(updated),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    button("funny").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-meme-id]")).toHaveLength(24);
    });
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    button("编辑").click();
    const filteredEditForm =
      document.querySelector<HTMLFormElement>("#edit-form");
    if (!filteredEditForm) {
      throw new Error("Missing filtered edit form");
    }
    (filteredEditForm.elements.namedItem("tags") as HTMLInputElement).value =
      "reaction";
    filteredEditForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-meme-id]")).toHaveLength(0);
    });
    expect(listMemes).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0, tags: ["funny"] }),
    );

    // Recreate the app to isolate delete pagination from the filter scenario.
    document.body.innerHTML = '<div id="app"></div>';
    const deleteApi = makeApi({
      listMemes: vi
        .fn()
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(shiftedPage),
    });
    const deleteApp = new MemeVaultApp(root(), deleteApi);
    await deleteApp.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    button("删除").click();

    await vi.waitFor(() => {
      expect(deleteApi.listMemes).toHaveBeenCalledTimes(2);
      expect(deleteApi.listMemes).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 0, limit: 24 }),
      );
      expect(document.querySelectorAll("[data-meme-id]")).toHaveLength(24);
    });
  });

  it("does not let a completed delete clear a newer selection", async () => {
    const first = makeMeme(1, "第一个");
    const second = makeMeme(2, "第二个");
    const pendingDelete = deferred<void>();
    const api = makeApi({
      listMemes: vi
        .fn()
        .mockResolvedValueOnce([first, second])
        .mockResolvedValueOnce([second]),
      deleteMeme: vi.fn().mockReturnValue(pendingDelete.promise),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    button("删除").click();
    document.querySelector<HTMLButtonElement>('[data-meme-id="2"]')?.click();

    pendingDelete.resolve();
    await vi.waitFor(() => {
      expect(api.listMemes).toHaveBeenCalledTimes(2);
      expect(document.querySelector("[data-detail-title]")?.textContent).toBe(
        "第二个",
      );
    });
  });

  it("reports an edit failure globally after the selection changes", async () => {
    const first = makeMeme(1, "第一个");
    const second = makeMeme(2, "第二个");
    const pendingUpdate = deferred<MemeResponse>();
    const api = makeApi({
      listMemes: vi.fn().mockResolvedValue([first, second]),
      updateMeme: vi.fn().mockReturnValue(pendingUpdate.promise),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    button("编辑").click();
    const editForm = document.querySelector<HTMLFormElement>("#edit-form");
    if (!editForm) {
      throw new Error("Missing edit form");
    }
    editForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    document.querySelector<HTMLButtonElement>('[data-meme-id="2"]')?.click();

    pendingUpdate.reject(new Error("offline"));
    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-operation-error]")?.textContent,
      ).toContain("网络请求失败");
    });
    expect(document.querySelector("[data-detail-title]")?.textContent).toBe(
      "第二个",
    );
  });

  it("reports a delete failure globally after the selection changes", async () => {
    const first = makeMeme(1, "第一个");
    const second = makeMeme(2, "第二个");
    const pendingDelete = deferred<void>();
    const api = makeApi({
      listMemes: vi.fn().mockResolvedValue([first, second]),
      deleteMeme: vi.fn().mockReturnValue(pendingDelete.promise),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    button("删除").click();
    document.querySelector<HTMLButtonElement>('[data-meme-id="2"]')?.click();

    pendingDelete.reject(new Error("offline"));
    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-operation-error]")?.textContent,
      ).toContain("网络请求失败");
    });
    expect(document.querySelector("[data-detail-title]")?.textContent).toBe(
      "第二个",
    );
  });
});
