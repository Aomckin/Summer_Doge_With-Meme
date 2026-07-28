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

const dogeTemplate = {
  id: 3,
  name: "Doge",
  description: "经典柴犬模板",
  created_at: "2026-07-28T00:00:00Z",
  updated_at: "2026-07-28T00:00:00Z",
};

const wojakTemplate = {
  ...dogeTemplate,
  id: 4,
  name: "Wojak",
  description: null,
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
    template: null,
  };
}

function makeApi(overrides: Partial<MemeApi> = {}): MemeApi {
  return {
    listMemes: vi.fn().mockResolvedValue([]),
    listTags: vi.fn().mockResolvedValue([funnyTag]),
    listTemplates: vi.fn().mockResolvedValue([]),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn().mockResolvedValue(undefined),
    getRandomMeme: vi.fn().mockResolvedValue(makeMeme(99, "随机 Meme")),
    uploadMeme: vi.fn().mockResolvedValue(makeMeme(2, "新上传")),
    updateMeme: vi.fn().mockResolvedValue(makeMeme(2, "已编辑")),
    deleteMeme: vi.fn().mockResolvedValue(undefined),
    analyzeMeme: vi.fn().mockResolvedValue({
      id: 1,
      meme_id: 1,
      model_name: "gpt-5.6-luna-test",
      description: "AI 描述",
      suggestions: [
        { name: "funny", confidence: 0.95, existing: true },
        { name: "reaction", confidence: 0.87, existing: false },
      ],
      created_at: "2026-07-27T00:00:00Z",
      confirmed_at: null,
      suggested_template: null,
    }),
    confirmAIAnalysis: vi.fn().mockResolvedValue(makeMeme(1)),
    listAIProviderPresets: vi.fn().mockResolvedValue([
      {
        id: "qwen",
        name: "Qwen",
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        protocol: "openai_chat_completions",
        description: "Qwen 视觉模型",
        models: [
          {
            model_id: "qwen3.6-flash",
            display_name: "Qwen3.6 Flash",
            supports_vision: true,
          },
        ],
      },
      {
        id: "deepseek",
        name: "DeepSeek",
        base_url: "https://api.deepseek.com",
        protocol: "openai_chat_completions",
        description: "DeepSeek 文本模型",
        models: [],
      },
    ]),
    listAIProviders: vi.fn().mockResolvedValue([]),
    createAIProvider: vi.fn(),
    updateAIProvider: vi.fn(),
    deleteAIProvider: vi.fn().mockResolvedValue(undefined),
    testAIProvider: vi.fn().mockResolvedValue({
      ok: true,
      message: "连接成功",
      model_count: 1,
    }),
    refreshAIModels: vi.fn().mockResolvedValue([]),
    listAIModels: vi.fn().mockResolvedValue([]),
    createAIModel: vi.fn(),
    updateAIModel: vi.fn(),
    deleteAIModel: vi.fn().mockResolvedValue(undefined),
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
  it("renders natural-ratio cards with overlay metadata", async () => {
    const portrait = {
      ...makeMeme(1, "纵向 Meme"),
      width: 1260,
      height: 1861,
    };
    const app = new MemeVaultApp(
      root(),
      makeApi({ listMemes: vi.fn().mockResolvedValue([portrait]) }),
    );

    await app.start();

    const card = document.querySelector<HTMLElement>('[data-meme-id="1"]');
    const image = card?.querySelector<HTMLImageElement>(".card-image img");
    expect(image?.getAttribute("width")).toBe("1260");
    expect(image?.getAttribute("height")).toBe("1861");
    expect(card?.querySelector(".card-overlay strong")?.textContent).toBe(
      "纵向 Meme",
    );
    expect(card?.querySelector(".card-overlay .tag")?.textContent).toBe(
      "funny",
    );
  });

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

  it("collapses excess tags and keeps selected tags visible", async () => {
    const tags = Array.from({ length: 10 }, (_, index) => ({
      ...funnyTag,
      id: index + 1,
      name: `标签${index + 1}`,
    }));
    const api = makeApi({ listTags: vi.fn().mockResolvedValue(tags) });
    const app = new MemeVaultApp(root(), api);

    await app.start();

    expect(document.querySelectorAll("[data-tag]")).toHaveLength(8);
    expect(button("展开全部标签（+2）").getAttribute("aria-expanded")).toBe(
      "false",
    );

    button("展开全部标签（+2）").click();
    expect(document.querySelectorAll("[data-tag]")).toHaveLength(10);
    expect(button("收起标签").getAttribute("aria-expanded")).toBe("true");

    document.querySelector<HTMLButtonElement>('[data-tag="标签10"]')?.click();
    button("收起标签").click();
    expect(document.querySelectorAll("[data-tag]")).toHaveLength(9);
    expect(document.querySelector('[data-tag="标签10"]')).not.toBeNull();
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
      template_id: null,
    });

    button("删除").click();
    await vi.waitFor(() => {
      expect(api.deleteMeme).toHaveBeenCalledWith(2);
      expect(document.querySelector("[data-detail-title]")).toBeNull();
    });
  });

  it("loads templates and uses them in upload, edit and detail views", async () => {
    const assigned = {
      ...makeMeme(1, "Doge Meme"),
      template: dogeTemplate,
    };
    const created = {
      ...makeMeme(2, "上传模板 Meme"),
      template: dogeTemplate,
    };
    const cleared = { ...assigned, template: null };
    const api = makeApi({
      listTemplates: vi.fn().mockResolvedValue([dogeTemplate]),
      listMemes: vi
        .fn()
        .mockResolvedValueOnce([assigned])
        .mockResolvedValueOnce([assigned, created])
        .mockResolvedValueOnce([cleared, created]),
      uploadMeme: vi.fn().mockResolvedValue(created),
      updateMeme: vi.fn().mockResolvedValue(cleared),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    expect(api.listTemplates).toHaveBeenCalledTimes(1);
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    expect(document.querySelector(".metadata")?.textContent).toContain("Doge");

    button("上传 Meme").click();
    const uploadForm = document.querySelector<HTMLFormElement>("#upload-form");
    const fileInput =
      document.querySelector<HTMLInputElement>("#upload-file");
    const uploadTemplate =
      document.querySelector<HTMLSelectElement>("#upload-template");
    if (!uploadForm || !fileInput || !uploadTemplate) {
      throw new Error("Missing upload template controls");
    }
    expect(uploadTemplate.textContent).toContain("Doge");
    uploadTemplate.value = "3";
    Object.defineProperty(fileInput, "files", {
      value: [new File(["image"], "doge.png", { type: "image/png" })],
    });
    (uploadForm.elements.namedItem("title") as HTMLInputElement).value =
      "上传模板 Meme";
    uploadForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      expect(api.uploadMeme).toHaveBeenCalledWith(
        expect.objectContaining({ template_id: 3 }),
      );
    });

    button("编辑").click();
    const editForm = document.querySelector<HTMLFormElement>("#edit-form");
    const editTemplate = editForm?.elements.namedItem(
      "template_id",
    ) as HTMLSelectElement | null;
    if (!editForm || !editTemplate) {
      throw new Error("Missing edit template controls");
    }
    expect(editTemplate.value).toBe("3");
    editTemplate.value = "";
    editForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      expect(api.updateMeme).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ template_id: null }),
      );
    });
  });

  it("creates, edits and deletes templates in the management dialog", async () => {
    const renamed = { ...dogeTemplate, name: "Doge Classic" };
    const listTemplates = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([dogeTemplate])
      .mockResolvedValueOnce([renamed])
      .mockResolvedValueOnce([]);
    const api = makeApi({
      listTemplates,
      createTemplate: vi.fn().mockResolvedValue(dogeTemplate),
      updateTemplate: vi.fn().mockResolvedValue(renamed),
      deleteTemplate: vi.fn().mockResolvedValue(undefined),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    button("模板管理").click();
    const dialog =
      document.querySelector<HTMLDialogElement>("#template-dialog");
    const form = document.querySelector<HTMLFormElement>("#template-form");
    if (!dialog || !form) {
      throw new Error("Missing template manager");
    }
    expect(dialog.open).toBe(true);
    (form.elements.namedItem("name") as HTMLInputElement).value = "Doge";
    (form.elements.namedItem("description") as HTMLTextAreaElement).value =
      "经典柴犬模板";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      expect(api.createTemplate).toHaveBeenCalledWith({
        name: "Doge",
        description: "经典柴犬模板",
      });
      expect(document.querySelector(".template-row")?.textContent).toContain(
        "Doge",
      );
    });

    document
      .querySelector<HTMLButtonElement>('[data-edit-template="3"]')
      ?.click();
    (form.elements.namedItem("name") as HTMLInputElement).value =
      "Doge Classic";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      expect(api.updateTemplate).toHaveBeenCalledWith(3, {
        name: "Doge Classic",
        description: "经典柴犬模板",
      });
      expect(document.querySelector(".template-row")?.textContent).toContain(
        "Doge Classic",
      );
    });

    document
      .querySelector<HTMLButtonElement>('[data-delete-template="3"]')
      ?.click();
    await vi.waitFor(() => {
      expect(confirm).toHaveBeenCalled();
      expect(api.deleteTemplate).toHaveBeenCalledWith(3);
      expect(api.listMemes).toHaveBeenCalledTimes(2);
      expect(listTemplates).toHaveBeenCalledTimes(4);
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

  it("previews AI suggestions and applies only after confirmation", async () => {
    const original = makeMeme(1, "待分析");
    const reactionTag = { ...funnyTag, id: 2, name: "reaction" };
    const updated = {
      ...original,
      description: "AI 生成的图片描述",
      tags: [funnyTag, reactionTag],
    };
    const api = makeApi({
      listMemes: vi.fn().mockResolvedValue([original]),
      listTags: vi
        .fn()
        .mockResolvedValueOnce([funnyTag])
        .mockResolvedValueOnce([funnyTag, reactionTag]),
      confirmAIAnalysis: vi.fn().mockResolvedValue(updated),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();

    button("AI 分析").click();
    await vi.waitFor(() => {
      expect(document.querySelector(".ai-description")?.textContent).toBe(
        "AI 描述",
      );
    });
    expect(document.querySelector(".ai-panel .eyebrow")?.textContent).toContain(
      "gpt-5.6-luna-test",
    );
    expect(
      [...document.querySelectorAll(".detail-tags .tag")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["funny"]);
    expect(
      document.querySelector('[data-ai-tag="reaction"]')
        ?.closest(".ai-suggestion")
        ?.textContent,
    ).toContain("新建议");

    const funnyChoice =
      document.querySelector<HTMLInputElement>('[data-ai-tag="funny"]');
    const descriptionChoice =
      document.querySelector<HTMLInputElement>("[data-ai-description]");
    if (!funnyChoice || !descriptionChoice) {
      throw new Error("Missing AI confirmation controls");
    }
    funnyChoice.checked = false;
    funnyChoice.dispatchEvent(new Event("change", { bubbles: true }));
    descriptionChoice.checked = true;
    descriptionChoice.dispatchEvent(new Event("change", { bubbles: true }));
    button("确认采用").click();

    await vi.waitFor(() => {
      expect(api.confirmAIAnalysis).toHaveBeenCalledWith(1, 1, {
        tags: ["reaction"],
        apply_description: true,
        template_id: null,
        apply_template: false,
      });
      expect(document.querySelector(".detail-description")?.textContent).toBe(
        "AI 生成的图片描述",
      );
    });
    expect(
      [...document.querySelectorAll(".detail-tags .tag")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["funny", "reaction"]);
    expect(document.querySelector(".ai-description")).toBeNull();
    expect(button("reaction")).toBeTruthy();
  });

  it("defaults to the AI template suggestion and allows choosing another template", async () => {
    const original = makeMeme(1, "模板建议");
    const updated = { ...original, template: wojakTemplate };
    const api = makeApi({
      listMemes: vi.fn().mockResolvedValue([original]),
      listTemplates: vi
        .fn()
        .mockResolvedValue([dogeTemplate, wojakTemplate]),
      analyzeMeme: vi.fn().mockResolvedValue({
        id: 9,
        meme_id: 1,
        model_name: "fake",
        description: "AI 描述",
        suggestions: [
          { name: "funny", confidence: 0.9, existing: true },
          { name: "reaction", confidence: 0.8, existing: false },
        ],
        created_at: "2026-07-28T00:00:00Z",
        confirmed_at: null,
        suggested_template: dogeTemplate,
      }),
      confirmAIAnalysis: vi.fn().mockResolvedValue(updated),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();

    button("AI 分析").click();
    await vi.waitFor(() => {
      expect(document.querySelector(".ai-template-choice")?.textContent).toContain(
        "建议模板：Doge",
      );
    });
    const select = document.querySelector<HTMLSelectElement>(
      "[data-ai-template]",
    );
    const apply = document.querySelector<HTMLInputElement>(
      "[data-ai-apply-template]",
    );
    if (!select || !apply) {
      throw new Error("Missing AI template controls");
    }
    expect(apply.checked).toBe(true);
    expect(select.value).toBe("3");
    select.value = "4";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    button("确认采用").click();

    await vi.waitFor(() => {
      expect(api.confirmAIAnalysis).toHaveBeenCalledWith(
        1,
        9,
        expect.objectContaining({
          template_id: 4,
          apply_template: true,
        }),
      );
      expect(document.querySelector(".metadata")?.textContent).toContain(
        "Wojak",
      );
    });
  });

  it("keeps AI results and selections when confirmation fails", async () => {
    const api = makeApi({
      listMemes: vi.fn().mockResolvedValue([makeMeme(1)]),
      confirmAIAnalysis: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    button("AI 分析").click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-ai-tag="reaction"]')).not.toBeNull();
    });

    button("确认采用").click();
    await vi.waitFor(() => {
      expect(document.querySelector(".ai-error")?.textContent).toContain(
        "网络请求失败",
      );
    });
    expect(
      document.querySelector<HTMLInputElement>('[data-ai-tag="reaction"]')
        ?.checked,
    ).toBe(true);
    expect(document.querySelector(".ai-description")?.textContent).toBe(
      "AI 描述",
    );
  });

  it("opens API settings and fills common provider presets", async () => {
    const provider = {
      id: 1,
      name: "DeepSeek",
      protocol: "openai_chat_completions" as const,
      base_url: "https://api.deepseek.com",
      has_api_key: true,
      api_key_hint: "••••1234",
      timeout_seconds: 30,
      max_retries: 1,
      retry_delay_seconds: 1,
      enabled: true,
      created_at: "2026-07-27T00:00:00Z",
      updated_at: "2026-07-27T00:00:00Z",
    };
    const api = makeApi({
      listAIProviders: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([provider]),
      createAIProvider: vi.fn().mockResolvedValue(provider),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    button("API 设置").click();
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLDialogElement>("#api-settings-dialog")
          ?.open,
      ).toBe(true);
      expect(button("添加厂商")).toBeTruthy();
    });
    button("添加厂商").click();
    const form = document.querySelector<HTMLFormElement>("#provider-form");
    if (!form) {
      throw new Error("Missing provider form");
    }
    const preset = form.elements.namedItem("preset_id") as HTMLSelectElement;
    preset.value = "deepseek";
    preset.dispatchEvent(new Event("change", { bubbles: true }));
    expect(
      (form.elements.namedItem("base_url") as HTMLInputElement).value,
    ).toBe("https://api.deepseek.com");
    expect(
      (form.elements.namedItem("protocol") as HTMLSelectElement).value,
    ).toBe("openai_chat_completions");
    (form.elements.namedItem("api_key") as HTMLInputElement).value =
      "secret-key";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(api.createAIProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          preset_id: "deepseek",
          name: "DeepSeek",
          base_url: "https://api.deepseek.com",
          api_key: "secret-key",
        }),
      );
      expect(document.querySelector(".provider-row")?.textContent).toContain(
        "DeepSeek",
      );
    });
  });

  it("activates only a vision-capable model from the model list", async () => {
    const provider = {
      id: 1,
      name: "Qwen",
      protocol: "openai_chat_completions" as const,
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      has_api_key: true,
      api_key_hint: "••••1234",
      timeout_seconds: 30,
      max_retries: 1,
      retry_delay_seconds: 1,
      enabled: true,
      created_at: "2026-07-27T00:00:00Z",
      updated_at: "2026-07-27T00:00:00Z",
    };
    const inactive = {
      id: 8,
      provider_id: 1,
      model_id: "qwen3.6-flash",
      display_name: "Qwen3.6 Flash",
      supports_vision: true,
      enabled: true,
      is_active: false,
      created_at: "2026-07-27T00:00:00Z",
      updated_at: "2026-07-27T00:00:00Z",
    };
    const api = makeApi({
      listAIProviders: vi.fn().mockResolvedValue([provider]),
      listAIModels: vi
        .fn()
        .mockResolvedValueOnce([inactive])
        .mockResolvedValueOnce([{ ...inactive, is_active: true }]),
      updateAIModel: vi.fn().mockResolvedValue({
        ...inactive,
        is_active: true,
      }),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();
    button("API 设置").click();
    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-settings-tab='models']"),
      ).not.toBeNull();
      expect(api.listAIModels).toHaveBeenCalledTimes(1);
    });
    button("模型列表").click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-model-record-id='8']")).not.toBeNull();
    });
    button("用于图片分析").click();

    await vi.waitFor(() => {
      expect(api.updateAIModel).toHaveBeenCalledWith(8, {
        is_active: true,
      });
      expect(button("当前分析模型")).toBeTruthy();
    });
  });

  it("opens the selected original image in a reusable viewer", async () => {
    const portrait = {
      ...makeMeme(1, "纵向 Meme"),
      width: 1260,
      height: 1861,
    };
    const app = new MemeVaultApp(
      root(),
      makeApi({ listMemes: vi.fn().mockResolvedValue([portrait]) }),
    );
    await app.start();

    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    document.querySelector<HTMLButtonElement>("[data-open-viewer]")?.click();

    const dialog =
      document.querySelector<HTMLDialogElement>("#image-viewer-dialog");
    const image = dialog?.querySelector<HTMLImageElement>("[data-viewer-image]");
    const link = dialog?.querySelector<HTMLAnchorElement>("[data-viewer-link]");
    expect(dialog?.open).toBe(true);
    expect(image?.getAttribute("src")).toBe(portrait.image_url);
    expect(image?.getAttribute("width")).toBe("1260");
    expect(image?.getAttribute("height")).toBe("1861");
    expect(dialog?.querySelector("[data-viewer-title]")?.textContent).toBe(
      "纵向 Meme",
    );
    expect(link?.getAttribute("href")).toBe(portrait.image_url);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("closes only for the viewer backdrop or explicit close button", async () => {
    const meme = makeMeme(1, "查看边界");
    const app = new MemeVaultApp(
      root(),
      makeApi({ listMemes: vi.fn().mockResolvedValue([meme]) }),
    );
    await app.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    const trigger =
      document.querySelector<HTMLButtonElement>("[data-open-viewer]");
    trigger?.click();

    const dialog =
      document.querySelector<HTMLDialogElement>("#image-viewer-dialog");
    const content = dialog?.querySelector<HTMLElement>(".image-viewer-content");
    const title = dialog?.querySelector<HTMLElement>("[data-viewer-title]");
    content?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    title?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(dialog?.open).toBe(true);

    dialog
      ?.querySelector<HTMLButtonElement>("[data-close-viewer]")
      ?.click();
    expect(dialog?.open).toBe(false);

    trigger?.click();
    expect(dialog?.open).toBe(true);
    dialog?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(dialog?.open).toBe(false);
  });

  it("recovers when a valid image opens after a failed viewer image", async () => {
    const broken = makeMeme(1, "损坏图片");
    const valid = makeMeme(2, "正常图片");
    const app = new MemeVaultApp(
      root(),
      makeApi({ listMemes: vi.fn().mockResolvedValue([broken, valid]) }),
    );
    await app.start();

    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    document.querySelector<HTMLButtonElement>("[data-open-viewer]")?.click();
    const dialog =
      document.querySelector<HTMLDialogElement>("#image-viewer-dialog");
    const image = dialog?.querySelector<HTMLImageElement>("[data-viewer-image]");
    const frame = dialog?.querySelector<HTMLElement>("[data-viewer-frame]");
    const error = dialog?.querySelector<HTMLElement>("[data-viewer-error]");
    image?.dispatchEvent(new Event("error"));
    expect(image?.hidden).toBe(true);
    expect(frame?.classList.contains("is-broken")).toBe(true);
    expect(error?.hidden).toBe(false);

    dialog?.close();
    document.querySelector<HTMLButtonElement>('[data-meme-id="2"]')?.click();
    document.querySelector<HTMLButtonElement>("[data-open-viewer]")?.click();
    expect(image?.hidden).toBe(false);
    expect(frame?.classList.contains("is-broken")).toBe(false);
    expect(error?.hidden).toBe(true);
    expect(image?.getAttribute("src")).toBe(valid.image_url);
  });

  it("does not call showModal again while the viewer is open", async () => {
    const showModal = vi.spyOn(
      HTMLDialogElement.prototype,
      "showModal",
    );
    const app = new MemeVaultApp(
      root(),
      makeApi({ listMemes: vi.fn().mockResolvedValue([makeMeme(1)]) }),
    );
    await app.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();

    const trigger =
      document.querySelector<HTMLButtonElement>("[data-open-viewer]");
    trigger?.click();
    trigger?.click();

    expect(showModal).toHaveBeenCalledTimes(1);
  });
});
