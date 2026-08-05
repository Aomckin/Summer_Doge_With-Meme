import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemeVaultApp, type MemeApi } from "./app";
import type {
  AppState,
  MemeImageResponse,
  MemeResponse,
  TagResponse,
} from "./types";

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
  reference_image_url: null,
  reference_thumbnail_url: null,
  reference_mime_type: null,
  reference_width: null,
  reference_height: null,
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
    images: [],
    image_count: 1,
  };
}

function makeMemeImage(
  id: number,
  position: number,
  name = `image-${id}`,
): MemeImageResponse {
  return {
    id,
    original_filename: `${name}.png`,
    stored_filename: `stored-${name}.png`,
    image_url: `/media/images/stored-${name}.png`,
    thumbnail_url: `/media/thumbnails/stored-${name}.png`,
    mime_type: "image/png",
    file_size: 1024 + id,
    width: 320,
    height: 240,
    file_hash: `image-hash-${id}`,
    position,
    created_at: "2026-07-29T00:00:00Z",
  };
}

function makeCompositeMeme(id = 1): MemeResponse {
  const images = [
    makeMemeImage(11, 0, "first"),
    makeMemeImage(12, 1, "second"),
    makeMemeImage(13, 2, "third"),
  ];
  return {
    ...makeMeme(id, "复合 Meme"),
    original_filename: images[0].original_filename,
    stored_filename: images[0].stored_filename,
    image_url: images[0].image_url,
    thumbnail_url: images[0].thumbnail_url,
    file_size: images[0].file_size,
    width: images[0].width,
    height: images[0].height,
    file_hash: images[0].file_hash,
    images,
    image_count: images.length,
  };
}

function makeApi(overrides: Partial<MemeApi> = {}): MemeApi {
  return {
    listMemes: vi.fn().mockResolvedValue([]),
    listTags: vi.fn().mockResolvedValue([funnyTag]),
    listTemplates: vi.fn().mockResolvedValue([]),
    createTemplate: vi.fn(),
    createTemplateWithReferenceImage: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn().mockResolvedValue(undefined),
    uploadTemplateReferenceImage: vi.fn(),
    deleteTemplateReferenceImage: vi.fn().mockResolvedValue(undefined),
    getRandomMeme: vi.fn().mockResolvedValue(makeMeme(99, "随机 Meme")),
    uploadMeme: vi.fn().mockResolvedValue(makeMeme(2, "新上传")),
    createImportJob: vi.fn(),
    getImportJob: vi.fn(),
    listImportJobItems: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 25 }),
    cancelImportJob: vi.fn(),
    retryFailedImportJob: vi.fn(),
    deleteImportJob: vi.fn().mockResolvedValue(undefined),
    updateMeme: vi.fn().mockResolvedValue(makeMeme(2, "已编辑")),
    deleteMeme: vi.fn().mockResolvedValue(undefined),
    listCaptions: vi.fn().mockResolvedValue([]),
    createCaption: vi.fn(),
    updateCaption: vi.fn(),
    deleteCaption: vi.fn().mockResolvedValue(undefined),
    generateCaptions: vi.fn(),
    rewriteCaption: vi.fn(),
    appendMemeImage: vi.fn().mockResolvedValue(makeMeme(1)),
    deleteMemeImage: vi.fn().mockResolvedValue(makeMeme(1)),
    reorderMemeImages: vi.fn().mockResolvedValue(makeMeme(1)),
    listMemeRelations: vi.fn().mockResolvedValue([]),
    addMemeRelations: vi.fn().mockResolvedValue([]),
    deleteMemeRelation: vi.fn().mockResolvedValue(undefined),
    analyzeMeme: vi.fn().mockResolvedValue({
      id: 1,
      meme_id: 1,
      model_name: "gpt-5.6-luna-test",
      suggested_title: "看到需求时的我",
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
            supports_image_embedding: false,
          },
        ],
      },
      {
        id: "dashscope_embedding",
        name: "阿里云百炼图像向量",
        base_url: "https://dashscope.aliyuncs.com/api/v1",
        protocol: "dashscope_multimodal_embedding",
        description: "多模态图像向量 API",
        models: [
          {
            model_id: "multimodal-embedding-v1",
            display_name: "Multimodal Embedding V1",
            supports_vision: false,
            supports_image_embedding: true,
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

  it("opens batch upload, refreshes page data, then edits and deletes", async () => {
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

    button("图片上传").click();
    const dialog = document.querySelector<HTMLDialogElement>(
      "[data-batch-dialog]",
    );
    const fileInput =
      document.querySelector<HTMLInputElement>('[name="batch_files"]');
    if (!dialog || !fileInput) {
      throw new Error("Missing upload controls");
    }
    const file = new File(["image"], "新上传.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    button("开始上传").click();

    await vi.waitFor(() => {
      expect(dialog.open).toBe(false);
      expect(document.querySelector('[data-meme-id="2"]')).not.toBeNull();
    });
    expect(api.uploadMeme).toHaveBeenCalledWith(
      expect.objectContaining({ title: "新上传" }),
    );
    expect(api.listTags).toHaveBeenCalledTimes(2);
    expect(api.listTemplates).toHaveBeenCalledTimes(2);

    document.querySelector<HTMLButtonElement>('[data-meme-id="2"]')?.click();
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

    button("图片上传").click();
    const fileInput =
      document.querySelector<HTMLInputElement>('[name="batch_files"]');
    const uploadTemplate =
      document.querySelector<HTMLSelectElement>(
        '[data-batch-dialog] [name="template_id"]',
      );
    if (!fileInput || !uploadTemplate) {
      throw new Error("Missing upload template controls");
    }
    expect(uploadTemplate.textContent).toContain("Doge");
    uploadTemplate.value = "3";
    Object.defineProperty(fileInput, "files", {
      value: [new File(["image"], "doge.png", { type: "image/png" })],
    });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    button("开始上传").click();
    await vi.waitFor(() => {
      expect(api.uploadMeme).toHaveBeenCalledWith(
        expect.objectContaining({ template_id: 3 }),
      );
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-meme-id="2"]')).not.toBeNull(),
    );
    document.querySelector<HTMLButtonElement>('[data-meme-id="2"]')?.click();
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
      expect(api.listMemes).toHaveBeenCalledTimes(1);
      expect(api.listTags).toHaveBeenCalledTimes(2);
      expect(document.querySelector("[data-detail-title]")?.textContent).toBe(
        "第二个",
      );
    });
  });

  it("creates a template and its reference image in one request", async () => {
    const referencedTemplate = {
      ...dogeTemplate,
      reference_image_url: "/media/template-images/doge.png",
      reference_thumbnail_url: "/media/template-thumbnails/doge.png",
      reference_mime_type: "image/png",
      reference_width: 320,
      reference_height: 240,
    };
    const listTemplates = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([referencedTemplate]);
    const createTemplateWithReferenceImage = vi
      .fn()
      .mockResolvedValue(referencedTemplate);
    const api = makeApi({
      listTemplates,
      createTemplateWithReferenceImage,
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    button("模板管理").click();
    const form = document.querySelector<HTMLFormElement>("#template-form");
    const fileInput = form?.elements.namedItem(
      "reference_image",
    ) as HTMLInputElement | null;
    if (!form || !fileInput) {
      throw new Error("Missing template form controls");
    }
    const file = new File(["image"], "doge.png", { type: "image/png" });
    (form.elements.namedItem("name") as HTMLInputElement).value = "Doge";
    Object.defineProperty(fileInput, "files", { value: [file] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      const preview = document.querySelector<HTMLImageElement>(
        "#template-reference-input-preview img",
      );
      expect(preview?.src).toMatch(/^data:image\/png;base64,/);
      expect(preview?.alt).toContain("doge.png");
    });
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(createTemplateWithReferenceImage).toHaveBeenCalledWith(
        { name: "Doge", description: null },
        file,
      );
      expect(api.createTemplate).not.toHaveBeenCalled();
    });
  });

  it("shows the reference image thumbnail in template management", async () => {
    const referencedTemplate = {
      ...dogeTemplate,
      reference_image_url: "/media/template-images/doge.png",
      reference_thumbnail_url: "/media/template-thumbnails/doge-thumb.png",
      reference_mime_type: "image/png",
      reference_width: 320,
      reference_height: 240,
    };
    const app = new MemeVaultApp(
      root(),
      makeApi({ listTemplates: vi.fn().mockResolvedValue([referencedTemplate]) }),
    );
    await app.start();

    button("模板管理").click();
    const preview = document.querySelector<HTMLImageElement>(
      '[data-template-reference-preview="3"]',
    );
    expect(preview?.getAttribute("src")).toBe(
      "/media/template-thumbnails/doge-thumb.png",
    );
    expect(preview?.getAttribute("alt")).toContain("Doge");

    document
      .querySelector<HTMLButtonElement>('[data-edit-template="3"]')
      ?.click();
    const formPreview = document.querySelector<HTMLImageElement>(
      "#template-reference-input-preview img",
    );
    expect(formPreview?.getAttribute("src")).toBe(
      "/media/template-thumbnails/doge-thumb.png",
    );
  });

  it("preserves two loaded pages and card order after editing one Meme", async () => {
    const firstPage = Array.from({ length: 24 }, (_, index) =>
      makeMeme(index + 1),
    );
    const secondPage = Array.from({ length: 24 }, (_, index) =>
      makeMeme(index + 25),
    );
    const updated = {
      ...secondPage[5],
      title: "第二页已编辑",
      tags: [{ ...funnyTag, name: "reaction" }],
    };
    const listMemes = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    const api = makeApi({
      listMemes,
      updateMeme: vi.fn().mockResolvedValue(updated),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    button("加载更多").click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-meme-id]")).toHaveLength(48);
    });
    document
      .querySelector<HTMLElement>('[data-meme-id="30"]')
      ?.click();
    button("编辑").click();
    const orderBefore = [
      ...document.querySelectorAll<HTMLElement>("[data-meme-id]"),
    ].map((card) => Number(card.dataset.memeId));
    const untouchedCard =
      document.querySelector<HTMLElement>('[data-meme-id="29"]');
    const editedCard =
      document.querySelector<HTMLElement>('[data-meme-id="30"]');
    document.documentElement.scrollTop = 420;
    const editForm = document.querySelector<HTMLFormElement>("#edit-form");
    if (!editForm) {
      throw new Error("Missing edit form");
    }
    (editForm.elements.namedItem("title") as HTMLInputElement).value =
      "第二页已编辑";
    (editForm.elements.namedItem("tags") as HTMLInputElement).value =
      "reaction";
    editForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(document.querySelector("[data-detail-title]")?.textContent).toBe(
        "第二页已编辑",
      );
    });
    const state = (app as unknown as { state: AppState }).state;
    const orderAfter = [
      ...document.querySelectorAll<HTMLElement>("[data-meme-id]"),
    ].map((card) => Number(card.dataset.memeId));
    expect(listMemes).toHaveBeenCalledTimes(2);
    expect(api.listTags).toHaveBeenCalledTimes(2);
    expect(state.memes).toHaveLength(48);
    expect(state.offset).toBe(48);
    expect(state.hasMore).toBe(true);
    expect(state.memes[29]).toEqual(updated);
    expect(state.selectedMeme).toEqual(updated);
    expect(orderAfter).toEqual(orderBefore);
    expect(
      document.querySelector<HTMLElement>('[data-meme-id="29"]'),
    ).toBe(untouchedCard);
    expect(
      document.querySelector<HTMLElement>('[data-meme-id="30"]'),
    ).not.toBe(editedCard);
    expect(document.documentElement.scrollTop).toBe(420);
  });

  it("reloads the first page after deleting a Meme", async () => {
    const firstPage = Array.from({ length: 24 }, (_, index) =>
      makeMeme(index + 1),
    );
    const shiftedPage = Array.from({ length: 24 }, (_, index) =>
      makeMeme(index + 2),
    );
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
    expect(document.querySelector(".ai-panel")?.textContent).toContain(
      "看到需求时的我",
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
    const titleChoice =
      document.querySelector<HTMLInputElement>("[data-ai-title]");
    if (!funnyChoice || !descriptionChoice || !titleChoice) {
      throw new Error("Missing AI confirmation controls");
    }
    expect(titleChoice.checked).toBe(false);
    funnyChoice.checked = false;
    funnyChoice.dispatchEvent(new Event("change", { bubbles: true }));
    descriptionChoice.checked = true;
    descriptionChoice.dispatchEvent(new Event("change", { bubbles: true }));
    button("确认采用").click();

    await vi.waitFor(() => {
      expect(api.confirmAIAnalysis).toHaveBeenCalledWith(1, 1, {
        tags: ["reaction"],
        apply_description: true,
        apply_title: false,
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

  it("applies the AI suggested title only after explicit selection", async () => {
    const original = makeMeme(1, "原始标题");
    const updated = { ...original, title: "看到需求时的我" };
    const api = makeApi({
      listMemes: vi.fn().mockResolvedValue([original]),
      confirmAIAnalysis: vi.fn().mockResolvedValue(updated),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    button("AI 分析").click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-ai-title]")).not.toBeNull();
    });

    const titleChoice =
      document.querySelector<HTMLInputElement>("[data-ai-title]");
    if (!titleChoice) {
      throw new Error("Missing AI title choice");
    }
    titleChoice.checked = true;
    titleChoice.dispatchEvent(new Event("change", { bubbles: true }));
    button("确认采用").click();

    await vi.waitFor(() => {
      expect(api.confirmAIAnalysis).toHaveBeenCalledWith(
        1,
        1,
        expect.objectContaining({ apply_title: true }),
      );
      expect(document.querySelector("[data-detail-title]")?.textContent).toBe(
        "看到需求时的我",
      );
    });
  });

  it("hides the title choice for legacy AI analyses", async () => {
    const api = makeApi({
      listMemes: vi.fn().mockResolvedValue([makeMeme(1)]),
      analyzeMeme: vi.fn().mockResolvedValue({
        id: 1,
        meme_id: 1,
        model_name: "legacy",
        suggested_title: null,
        description: "AI 描述",
        suggestions: [
          { name: "funny", confidence: 0.95, existing: true },
          { name: "reaction", confidence: 0.87, existing: false },
        ],
        created_at: "2026-07-27T00:00:00Z",
        confirmed_at: null,
        suggested_template: null,
      }),
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
    expect(document.querySelector("[data-ai-title]")).toBeNull();
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
        suggested_title: "看到需求时的我",
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
    const titleChoice =
      document.querySelector<HTMLInputElement>("[data-ai-title]");
    if (!titleChoice) {
      throw new Error("Missing AI title choice");
    }
    titleChoice.checked = true;
    titleChoice.dispatchEvent(new Event("change", { bubbles: true }));

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
    expect(
      document.querySelector<HTMLInputElement>("[data-ai-title]")?.checked,
    ).toBe(true);
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
      supports_image_embedding: false,
      enabled: true,
      is_active: false,
      is_embedding_active: false,
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

  it("activates an image embedding model independently from image analysis", async () => {
    const provider = {
      id: 2,
      name: "阿里云百炼图像向量",
      protocol: "dashscope_multimodal_embedding" as const,
      base_url: "https://dashscope.aliyuncs.com/api/v1",
      has_api_key: true,
      api_key_hint: "••••1234",
      timeout_seconds: 30,
      max_retries: 1,
      retry_delay_seconds: 1,
      enabled: true,
      created_at: "2026-07-27T00:00:00Z",
      updated_at: "2026-07-27T00:00:00Z",
    };
    const embeddingModel = {
      id: 9,
      provider_id: 2,
      model_id: "multimodal-embedding-v1",
      display_name: "Multimodal Embedding V1",
      supports_vision: false,
      supports_image_embedding: true,
      enabled: true,
      is_active: false,
      is_embedding_active: false,
      created_at: "2026-07-27T00:00:00Z",
      updated_at: "2026-07-27T00:00:00Z",
    };
    const api = makeApi({
      listAIProviders: vi.fn().mockResolvedValue([provider]),
      listAIModels: vi
        .fn()
        .mockResolvedValueOnce([embeddingModel])
        .mockResolvedValueOnce([
          { ...embeddingModel, is_embedding_active: true },
        ]),
      updateAIModel: vi.fn().mockResolvedValue({
        ...embeddingModel,
        is_embedding_active: true,
      }),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    button("API 设置").click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-settings-tab='models']")).not.toBeNull();
    });
    button("模型列表").click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-model-record-id='9']")).not.toBeNull();
    });
    button("用于模板视觉检索").click();

    await vi.waitFor(() => {
      expect(api.updateAIModel).toHaveBeenCalledWith(9, {
        is_embedding_active: true,
      });
      expect(button("当前视觉检索模型")).toBeTruthy();
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

  it("renders only the cover in cards and the ordered group in detail", async () => {
    const meme = makeCompositeMeme();
    const app = new MemeVaultApp(
      root(),
      makeApi({ listMemes: vi.fn().mockResolvedValue([meme]) }),
    );

    await app.start();

    const card = document.querySelector<HTMLElement>('[data-meme-id="1"]');
    expect(card?.querySelectorAll(".card-image img")).toHaveLength(1);
    expect(card?.querySelector(".card-image img")?.getAttribute("src")).toBe(
      meme.thumbnail_url,
    );
    expect(card?.querySelector(".image-count-badge")?.textContent).toContain(
      "3 张",
    );

    card?.click();
    const detailImages = [
      ...document.querySelectorAll<HTMLImageElement>(".detail-image img"),
    ];
    expect(detailImages.map((image) => image.getAttribute("src"))).toEqual(
      meme.images.map((image) => image.image_url),
    );
    expect(document.querySelector("[data-cover-label]")?.textContent).toContain(
      "封面",
    );
  });

  it("navigates the complete image group and clears the viewer on close", async () => {
    const meme = makeCompositeMeme();
    const app = new MemeVaultApp(
      root(),
      makeApi({ listMemes: vi.fn().mockResolvedValue([meme]) }),
    );
    await app.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();

    document
      .querySelector<HTMLButtonElement>('[data-image-index="1"]')
      ?.click();
    const dialog =
      document.querySelector<HTMLDialogElement>("#image-viewer-dialog");
    const viewer = dialog?.querySelector<HTMLImageElement>("[data-viewer-image]");
    const previous =
      dialog?.querySelector<HTMLButtonElement>("[data-viewer-previous]");
    const next = dialog?.querySelector<HTMLButtonElement>("[data-viewer-next]");
    expect(viewer?.getAttribute("src")).toBe(meme.images[1].image_url);
    expect(previous?.disabled).toBe(false);
    expect(next?.disabled).toBe(false);

    next?.click();
    expect(viewer?.getAttribute("src")).toBe(meme.images[2].image_url);
    expect(next?.disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(viewer?.getAttribute("src")).toBe(meme.images[1].image_url);

    dialog
      ?.querySelector<HTMLButtonElement>("[data-close-viewer]")
      ?.click();
    expect(dialog?.open).toBe(false);
    expect(viewer?.hasAttribute("src")).toBe(false);
  });

  it("appends, deletes and reorders images with busy and error feedback", async () => {
    const meme = makeCompositeMeme();
    const appended = {
      ...meme,
      images: [...meme.images, makeMemeImage(14, 3, "fourth")],
      image_count: 4,
    };
    const appendResult = deferred<MemeResponse>();
    const reorderResult = deferred<MemeResponse>();
    const api = makeApi({
      listMemes: vi.fn().mockResolvedValue([meme]),
      appendMemeImage: vi.fn(() => appendResult.promise),
      reorderMemeImages: vi.fn(() => reorderResult.promise),
      deleteMemeImage: vi.fn().mockRejectedValue(new Error("删除失败")),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();

    const file = new File(["fourth"], "fourth.png", { type: "image/png" });
    const input =
      document.querySelector<HTMLInputElement>("[data-append-image]");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(api.appendMemeImage).toHaveBeenCalledWith(meme.id, file);
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLInputElement>("[data-append-image]")
          ?.disabled,
      ).toBe(true);
    });
    appendResult.resolve(appended);
    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-image-id]")).toHaveLength(4);
    });

    const firstCard =
      document.querySelector<HTMLElement>('[data-image-id="11"]');
    const thirdCard =
      document.querySelector<HTMLElement>('[data-image-id="13"]');
    firstCard?.dispatchEvent(new Event("dragstart", { bubbles: true }));
    thirdCard?.dispatchEvent(new Event("dragover", { bubbles: true }));
    thirdCard?.dispatchEvent(new Event("drop", { bubbles: true }));
    expect(api.reorderMemeImages).toHaveBeenCalledWith(meme.id, [12, 13, 11, 14]);
    reorderResult.resolve({
      ...appended,
      images: [
        appended.images[1],
        appended.images[2],
        appended.images[0],
        appended.images[3],
      ].map((image, position) => ({ ...image, position })),
    });
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLInputElement>("[data-append-image]")
          ?.disabled,
      ).toBe(false);
    });

    document
      .querySelector<HTMLButtonElement>('[data-delete-image="12"]')
      ?.click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-image-error]")?.textContent).toContain(
        "网络请求失败",
      );
    });
  });

  it("searches and batch-adds relations, then removes one relation", async () => {
    const selected = makeMeme(1, "当前");
    const related = makeMeme(2, "已关联");
    const third = { ...makeMeme(3, "候选甲"), description: "目标 alpha" };
    const fourth = { ...makeMeme(4, "候选乙"), description: "目标 beta" };
    const addResult = deferred<MemeResponse[]>();
    const api = makeApi({
      listMemes: vi.fn().mockResolvedValue([selected, related, third, fourth]),
      listMemeRelations: vi.fn().mockResolvedValue([related]),
      addMemeRelations: vi.fn(() => addResult.promise),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-related-meme=\"2\"]")).not.toBeNull();
    });

    document
      .querySelector<HTMLButtonElement>("[data-open-relations]")
      ?.click();
    const dialog =
      document.querySelector<HTMLDialogElement>("[data-relation-dialog]");
    expect(dialog?.open).toBe(true);
    const search =
      dialog?.querySelector<HTMLInputElement>("[data-relation-search]");
    if (search) {
      search.value = "目标";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(dialog?.querySelector('[data-relation-choice="1"]')).toBeNull();
    expect(dialog?.querySelector('[data-relation-choice="2"]')).toBeNull();
    expect(dialog?.querySelector('[data-relation-choice="3"]')).not.toBeNull();
    expect(dialog?.querySelector('[data-relation-choice="4"]')).not.toBeNull();

    for (const id of [3, 4]) {
      const choice = dialog?.querySelector<HTMLInputElement>(
        `[data-relation-choice="${id}"]`,
      );
      choice?.click();
    }
    dialog
      ?.querySelector<HTMLButtonElement>("[data-save-relations]")
      ?.click();
    expect(api.addMemeRelations).toHaveBeenCalledWith(1, [3, 4]);
    expect(
      dialog?.querySelector<HTMLButtonElement>("[data-save-relations]")?.disabled,
    ).toBe(true);

    addResult.resolve([related, third, fourth]);
    await vi.waitFor(() => {
      expect(dialog?.open).toBe(false);
      expect(document.querySelector("[data-related-meme=\"4\"]")).not.toBeNull();
    });

    document
      .querySelector<HTMLButtonElement>('[data-remove-relation="2"]')
      ?.click();
    await vi.waitFor(() => {
      expect(api.deleteMemeRelation).toHaveBeenCalledWith(1, 2);
      expect(document.querySelector("[data-related-meme=\"2\"]")).toBeNull();
    });
  });

  it("keeps a newer relation removal busy when an older request settles", async () => {
    const first = makeMeme(1, "甲");
    const second = makeMeme(2, "乙");
    const third = makeMeme(3, "丙");
    const firstRemoval = deferred<void>();
    const secondRemoval = deferred<void>();
    const api = makeApi({
      listMemes: vi.fn().mockResolvedValue([first, second, third]),
      listMemeRelations: vi.fn((id: number) =>
        Promise.resolve(id === 1 ? [second] : id === 2 ? [third] : []),
      ),
      deleteMemeRelation: vi
        .fn()
        .mockImplementationOnce(() => firstRemoval.promise)
        .mockImplementationOnce(() => secondRemoval.promise),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-remove-relation="2"]')).not.toBeNull();
    });
    document
      .querySelector<HTMLButtonElement>('[data-remove-relation="2"]')
      ?.click();

    document.querySelector<HTMLButtonElement>('[data-meme-id="2"]')?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-remove-relation="3"]')).not.toBeNull();
    });
    document
      .querySelector<HTMLButtonElement>('[data-remove-relation="3"]')
      ?.click();
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLButtonElement>(
          '[data-remove-relation="3"]',
        )?.textContent,
      ).toContain("正在移除");
    });

    firstRemoval.resolve();
    await vi.waitFor(() => {
      expect(api.deleteMemeRelation).toHaveBeenCalledTimes(2);
    });
    expect(
      document.querySelector<HTMLButtonElement>('[data-remove-relation="3"]')
        ?.textContent,
    ).toContain("正在移除");
    expect(
      document.querySelector<HTMLButtonElement>('[data-remove-relation="3"]')
        ?.disabled,
    ).toBe(true);

    secondRemoval.resolve();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-related-meme="3"]')).toBeNull();
    });
  });

  it("shows relation loading failures without stale peers", async () => {
    const api = makeApi({
      listMemes: vi.fn().mockResolvedValue([makeMeme(1), makeMeme(2)]),
      listMemeRelations: vi.fn().mockRejectedValue(new Error("关联加载失败")),
    });
    const app = new MemeVaultApp(root(), api);
    await app.start();

    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();

    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-relation-error]")?.textContent,
      ).toContain("网络请求失败");
    });
    expect(document.querySelector("[data-related-meme]")).toBeNull();
  });
});
