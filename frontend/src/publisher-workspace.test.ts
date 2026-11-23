import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, publisherApi } from "./api";
import { PublisherAutosave } from "./publisher-autosave";
import { PublisherWorkspace } from "./publisher-workspace";
import type { CaptionResponse, MemeResponse, PostContent, PostDraft, PostItem, PublishAttempt, PublisherInfo, VaultSummary } from "./types";

function image(index: number, caption = `文案 ${index}\n第二行`): PostItem {
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    position: index - 1, meme_id: index, meme_image_id: index, caption,
    meme_title: `素材 ${index}`, image_url: `/image-${index}.png`, thumbnail_url: null,
  };
}

function makeDraft(items: PostItem[] = []): PostDraft {
  return {
    id: 1, status: "draft", revision: 1, title: "草稿", intro_text: "", outro_text: "",
    created_at: "2026-11-19T00:00:00Z", updated_at: "2026-11-19T00:00:00Z", items,
  };
}

function merged(saved: PostDraft, body: PostContent, revision: number): PostDraft {
  return {
    ...saved, ...body, revision,
    items: body.items.map((row, index) => ({ ...image(row.meme_image_id, row.caption), ...row, position: index })),
  };
}

const savedCaption: CaptionResponse = {
  id: 12, meme_id: 45, content: "已保存的正文\n第二行 <img src=x>", scene: "群聊", tone: "吐槽",
  length: "short", source: "manual", created_at: "2026-11-19T00:00:00Z", updated_at: "2026-11-19T00:00:00Z",
};

const mock: PublisherInfo = {
  plugin_id: "mock", name: "Mock Publisher", version: "1", protocol_version: "1", execution_mode: "local_process",
  supported_content_types: ["image_text"], capabilities: ["image_text", "prepare", "dry_run"],
  limits: { max_images: null, max_image_bytes: null, max_package_bytes: null },
  enabled: true, available: true, recent_attempt: null,
};

function query<T extends Element>(selector: string): T {
  return document.querySelector<T>(selector)!;
}

function queryAll<T extends Element>(selector: string): NodeListOf<T> {
  return document.querySelectorAll<T>(selector);
}

function click(action: string): void {
  query<HTMLButtonElement>(`[data-publisher-action="${action}"]`).click();
}

function input(selector: string, value: string): void {
  const field = query<HTMLInputElement>(selector);
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Publisher Workspace", () => {
  let workspace: PublisherWorkspace;

  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(publisherApi, "otherImageIds").mockResolvedValue([]);
    workspace = new PublisherWorkspace(() => [], () => undefined);
  });

  afterEach(() => {
    workspace.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("keeps the sidebar order when switching or saving and moves a post up only on request", async () => {
    const first = { ...makeDraft(), id: 1, title: "第一篇" };
    let second = { ...makeDraft(), id: 2, title: "第二篇" };
    vi.spyOn(publisherApi, "list").mockImplementation(async () => [first, second]);
    vi.spyOn(publisherApi, "get").mockImplementation(async id => structuredClone(id === first.id ? first : second));
    vi.spyOn(publisherApi, "plugins").mockResolvedValue([]);
    vi.spyOn(publisherApi, "attempts").mockResolvedValue([]);
    vi.spyOn(publisherApi, "update").mockImplementation(async (_id, revision, content) => {
      second = merged(second, content, revision + 1);
      return structuredClone(second);
    });
    const move = vi.spyOn(publisherApi, "moveToTop").mockImplementation(async () => second);
    const sidebar = () => [...queryAll<HTMLElement>("[data-posts] [data-id]")].map(button => button.dataset.id);
    const selected = () => query<HTMLElement>("[data-posts] [aria-current]").dataset.id;

    await workspace.open();
    query<HTMLButtonElement>('[data-posts] [data-id="2"]').click();
    await vi.waitFor(() => expect(selected()).toBe("2"));
    expect(sidebar()).toEqual(["1", "2"]);
    input('input[name="title"]', "第二篇更新");
    click("save");
    await vi.waitFor(() => expect(query('[data-posts] [data-id="2"] strong').textContent).toBe("第二篇更新"));
    expect(sidebar()).toEqual(["1", "2"]);
    expect(move).not.toHaveBeenCalled();

    click("move-to-top");
    await vi.waitFor(() => expect(sidebar()).toEqual(["2", "1"]));
    expect(move).toHaveBeenCalledExactlyOnceWith(2, expect.any(AbortSignal));
    expect(selected()).toBe("2");
    expect(query<HTMLInputElement>('input[name="title"]').value).toBe("第二篇更新");
  });

  it("drags a whole image/caption row, preserves newlines and saves a 25-image draft without replacing the active textarea", async () => {
    let saved = makeDraft(Array.from({ length: 25 }, (_, index) => image(index + 1)));
    vi.spyOn(publisherApi, "list").mockResolvedValue([saved]);
    vi.spyOn(publisherApi, "get").mockImplementation(async () => structuredClone(saved));
    vi.spyOn(publisherApi, "plugins").mockResolvedValue([mock]);
    vi.spyOn(publisherApi, "attempts").mockResolvedValue([]);
    const update = vi.spyOn(publisherApi, "update").mockImplementation(async (_id, revision, body) => {
      saved = merged(saved, body, revision + 1);
      return structuredClone(saved);
    });
    await workspace.open();
    query("[data-drag-handle]").dispatchEvent(new Event("dragstart", { bubbles: true }));
    document.querySelectorAll("[data-post-item]")[24].dispatchEvent(new Event("drop", { bubbles: true }));
    expect(query<HTMLTextAreaElement>('textarea[name="caption"]').value).toBe("文案 2\n第二行");
    expect([...document.querySelectorAll<HTMLTextAreaElement>('textarea[name="caption"]')].at(-1)?.value).toBe("文案 1\n第二行");
    const field = query<HTMLTextAreaElement>('textarea[name="caption"]');
    field.focus();
    input('textarea[name="caption"]', "新的第一条\n<不作为 HTML>");
    click("preview");
    expect(query("[data-post-preview] figcaption").textContent).toBe("新的第一条\n<不作为 HTML>");
    expect(query("[data-post-preview] img").getAttribute("src")).toBe("/image-2.png");
    field.focus();
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(document.activeElement).toBe(field);
    expect(saved.items.map(row => row.meme_image_id)).toEqual([...Array.from({ length: 24 }, (_, i) => i + 2), 1]);
    click("close");
    await vi.waitFor(() => expect(query<HTMLDialogElement>(".publisher-workspace").open).toBe(false));
    await workspace.open();
    expect(query<HTMLTextAreaElement>('textarea[name="caption"]').value).toBe("新的第一条\n<不作为 HTML>");
  });

  it("adds a chosen secondary image to an existing draft without opening the editor", async () => {
    const draft = makeDraft();
    vi.spyOn(publisherApi, "list").mockResolvedValue([draft]);
    const append = vi.spyOn(publisherApi, "append").mockResolvedValue(draft);
    const create = vi.spyOn(publisherApi, "create");
    const meme = {
      id: 7, title: "多图素材", image_count: 2,
      images: [1, 2].map(id => ({ id, position: id - 1, image_url: `/image-${id}.png`, thumbnail_url: null })),
    } as MemeResponse;
    await workspace.addFromGallery([meme]);
    query<HTMLInputElement>('input[name="post-image"][value="2"]').click();
    expect([...query<HTMLSelectElement>('select[name="destination"]').options].map(option => option.value)).toEqual(["1"]);
    query<HTMLButtonElement>("[data-picker-confirm]").click();
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append.mock.calls[0][1]).toEqual([{ id: expect.any(String), meme_id: 7, meme_image_id: 2, caption: "" }]);
    expect(create).not.toHaveBeenCalled();
    expect(query<HTMLDialogElement>(".publisher-workspace").open).toBe(false);
  });

  it("directs gallery users to the workspace when no post exists", async () => {
    vi.spyOn(publisherApi, "list").mockResolvedValue([]);
    const create = vi.spyOn(publisherApi, "create");
    await workspace.addFromGallery([]);
    expect(document.body.textContent).toContain("请先在帖文工作台新建");
    expect(query<HTMLDialogElement>('[aria-label="选取帖文图片"]').open).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("reuses library pagination and submitted semantic queries while keeping selections across pages", async () => {
    workspace.destroy();
    const vault = { id: 3, name: "图库", capabilities: { semanticSearch: true } } as unknown as VaultSummary;
    workspace = new PublisherWorkspace(() => [vault], () => vault.id);
    const draft = makeDraft();
    vi.spyOn(publisherApi, "list").mockResolvedValue([draft]);
    vi.spyOn(publisherApi, "get").mockResolvedValue(draft);
    vi.spyOn(publisherApi, "plugins").mockResolvedValue([]);
    vi.spyOn(publisherApi, "attempts").mockResolvedValue([]);
    const api = await import("./api");
    const tile = (id: number) => ({ id, title: `素材 ${id}`,
      images: [{ id, position: 0, image_url: `/asset-${id}.png`, thumbnail_url: null }] }) as MemeResponse;
    const keyword = vi.spyOn(api, "listMemePage").mockImplementation(async ({ page, pageSize }) => ({
      items: [tile(page)], page, page_size: pageSize, total: 201, total_pages: Math.ceil(201 / pageSize),
      sort: "default", shuffle_seed: null,
    }));
    const semantic = vi.spyOn(api, "semanticSearch").mockImplementation(async ({ page, page_size }) => ({
      items: [{ meme: tile(10 + page), score: 0.9 }], page, page_size,
      total: 100, total_pages: Math.ceil(100 / page_size), indexed_count: 100, missing_count: 0, model_id: "fixture",
    }));
    const change = (name: string, value: string) => {
      const field = query<HTMLSelectElement>(`select[name="${name}"]`);
      field.value = value;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const jump = (value: string) => {
      const field = query<HTMLInputElement>("[data-picker-pages] [data-page-input]");
      field.value = value;
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    };
    const choose = (id: number) => query<HTMLInputElement>(`input[name="post-image"][value="${id}"]`).click();
    await workspace.open();
    click("pick");
    await vi.waitFor(() => expect(keyword).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 24, vaultId: 3 })));
    choose(1);
    change("picker-page-size", "48");
    await vi.waitFor(() => expect(query<HTMLInputElement>('input[name="post-image"][value="1"]').checked).toBe(true));
    jump("4");
    await vi.waitFor(() => expect(keyword).toHaveBeenLastCalledWith(expect.objectContaining({ page: 4, pageSize: 48 })));
    choose(4);
    change("search-mode", "semantic");
    expect(semantic).not.toHaveBeenCalled();
    input('input[name="q"]', "惊讶的猫");
    query("[data-picker-search]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(semantic).toHaveBeenLastCalledWith(expect.objectContaining({ query: "惊讶的猫", page: 1, page_size: 48, vaultId: 3 })));
    input('input[name="q"]', "还未提交的查询");
    jump("2");
    await vi.waitFor(() => expect(semantic).toHaveBeenLastCalledWith(expect.objectContaining({ query: "惊讶的猫", page: 2, page_size: 48 })));
    choose(12);
    query<HTMLButtonElement>("[data-picker-confirm]").click();
    expect(queryAll("[data-post-item]")).toHaveLength(3);
    expect([...queryAll("[data-item-media] img")].map(element => element.getAttribute("src"))).toEqual([
      "/asset-1.png", "/asset-4.png", "/asset-12.png",
    ]);
  });

  it("marks exact images used in current or other posts and lets users add them again", async () => {
    const draft = makeDraft([{ ...image(1), meme_id: 7 }]);
    vi.spyOn(publisherApi, "list").mockResolvedValue([draft]);
    vi.spyOn(publisherApi, "get").mockResolvedValue(draft);
    vi.spyOn(publisherApi, "plugins").mockResolvedValue([]);
    vi.spyOn(publisherApi, "attempts").mockResolvedValue([]);
    vi.mocked(publisherApi.otherImageIds).mockResolvedValue([2]);
    vi.spyOn(publisherApi, "update").mockImplementation(async (_id, revision, body) => merged(draft, body, revision + 1));
    const api = await import("./api");
    const meme = { id: 7, title: "多图素材", images: [1, 2, 3].map((id, position) => ({
      id, position, image_url: `/asset-${id}.png`, thumbnail_url: null,
    })) } as MemeResponse;
    vi.spyOn(api, "listMemePage").mockResolvedValue({ items: [meme], page: 1, page_size: 24,
      total: 1, total_pages: 1, sort: "default", shuffle_seed: null });
    const checkbox = (id: number) => query<HTMLInputElement>(`input[name="post-image"][value="${id}"]`);
    const badge = (id: number) => checkbox(id)?.closest("label")?.querySelector(".publisher-choice-badge");
    const picker = query<HTMLDialogElement>('.publisher-picker[aria-label="选取帖文图片"]');

    await workspace.open();
    click("pick");
    await vi.waitFor(() => expect(checkbox(1)).not.toBeNull());
    expect(badge(1)?.getAttribute("aria-label")).toBe("已在本帖");
    expect(badge(1)?.textContent).toBe("");
    expect(checkbox(1).checked).toBe(false);
    expect(badge(2)?.getAttribute("aria-label")).toBe("已在其他帖文");
    expect(checkbox(2).closest("label")?.title).toBe("已在其他帖文");
    expect(checkbox(2).checked).toBe(false);
    expect(badge(3)).toBeNull();
    checkbox(1).click();
    checkbox(2).click();
    query<HTMLButtonElement>("[data-picker-confirm]").click();
    await vi.waitFor(() => expect(picker.open).toBe(false));
    expect(queryAll("[data-post-item]")).toHaveLength(3);
    click("pick");
    await vi.waitFor(() => expect(badge(2)?.getAttribute("aria-label")).toBe("本帖及其他帖文已用"));
    expect(checkbox(2).checked).toBe(false);
  });

  it("repairs a missing picture in place and keeps a caption that starts with a newline", async () => {
    const missing = { ...image(2, "\n以前写好的文案"), image_url: null };
    const draft = makeDraft([missing]);
    vi.spyOn(publisherApi, "list").mockResolvedValue([draft]);
    vi.spyOn(publisherApi, "get").mockResolvedValue(draft);
    vi.spyOn(publisherApi, "plugins").mockResolvedValue([]);
    vi.spyOn(publisherApi, "attempts").mockResolvedValue([]);
    const api = await import("./api");
    const meme = {
      id: 2, title: "替换素材",
      images: [{ id: 2, position: 0, image_url: "/replacement.png", thumbnail_url: null }],
    } as MemeResponse;
    const search = vi.spyOn(api, "listMemePage").mockResolvedValue({ items: [meme], page: 1, page_size: 24,
      total: 1, total_pages: 1, sort: "default", shuffle_seed: null });
    const update = vi.spyOn(publisherApi, "update").mockImplementation(async (_id, revision, body) => merged(draft, body, revision + 1));
    await workspace.open();
    expect(query("[data-item-media]").textContent).toContain("图片缺失");
    expect(query<HTMLTextAreaElement>('textarea[name="caption"]').value).toBe("\n以前写好的文案");
    click("replace");
    await vi.waitFor(() => expect(search).toHaveBeenCalled());
    query<HTMLInputElement>('input[name="post-image"]').click();
    query<HTMLButtonElement>("[data-picker-confirm]").click();
    expect(query("[data-item-media] img").getAttribute("src")).toBe("/replacement.png");
    click("save");
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const updated = update.mock.calls[0][2].items[0];
    expect(updated.id).not.toBe(missing.id);
    expect(updated.caption).toBe("\n以前写好的文案");
  });

  it("copies a saved caption into the selected image, updates preview, and autosaves the draft only", async () => {
    const draft = makeDraft([image(1), { ...image(2, "原有文案"), meme_id: 45 }]);
    vi.spyOn(publisherApi, "list").mockResolvedValue([draft]);
    vi.spyOn(publisherApi, "get").mockResolvedValue(draft);
    vi.spyOn(publisherApi, "plugins").mockResolvedValue([]);
    vi.spyOn(publisherApi, "attempts").mockResolvedValue([]);
    const api = await import("./api");
    const list = vi.spyOn(api, "listCaptions").mockResolvedValue([
      { ...savedCaption, id: 11, content: "第一条" }, savedCaption,
    ]);
    const editSource = vi.spyOn(api, "updateCaption");
    const update = vi.spyOn(publisherApi, "update").mockImplementation(async (_id, revision, body) => merged(draft, body, revision + 1));

    await workspace.open();
    click("preview");
    expect(list).not.toHaveBeenCalled();
    const row = queryAll("[data-post-item]")[1];
    const field = row.querySelector<HTMLTextAreaElement>("textarea")!;
    row.querySelector<HTMLButtonElement>('[data-publisher-action="choose-caption"]')!.click();
    await vi.waitFor(() => expect(queryAll("[data-saved-caption-results] button")).toHaveLength(2));
    expect(list).toHaveBeenCalledWith(45, expect.any(AbortSignal));
    expect(query("[data-saved-caption-results] small").textContent).toContain("群聊 · 吐槽");
    expect(query("[data-saved-caption-results] img")).toBeNull();
    const choice = queryAll<HTMLButtonElement>("[data-saved-caption-results] button")[1];
    expect(choice.textContent).toBe("替换为这条");

    choice.click();
    expect(query<HTMLDialogElement>(".publisher-caption-picker").open).toBe(false);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe(savedCaption.content);
    expect(queryAll("[data-post-preview] figcaption")[1].textContent).toBe(savedCaption.content);

    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce(), { timeout: 1500 });
    expect(update.mock.calls[0][2].items.map(item => item.caption)).toEqual([image(1).caption, savedCaption.content]);
    expect(editSource).not.toHaveBeenCalled();
  });

  it("cancels stale caption requests and shows empty and error states without changing the draft", async () => {
    const draft = makeDraft([image(1, "")]);
    vi.spyOn(publisherApi, "list").mockResolvedValue([draft]);
    vi.spyOn(publisherApi, "get").mockResolvedValue(draft);
    vi.spyOn(publisherApi, "plugins").mockResolvedValue([]);
    vi.spyOn(publisherApi, "attempts").mockResolvedValue([]);
    let resolveStale!: (captions: CaptionResponse[]) => void;
    const api = await import("./api");
    const list = vi.spyOn(api, "listCaptions")
      .mockReturnValueOnce(new Promise(resolve => { resolveStale = resolve; }))
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new ApiError(503, "暂时无法读取文案"));
    const update = vi.spyOn(publisherApi, "update");

    await workspace.open();
    click("choose-caption");
    const results = query("[data-saved-caption-results]");
    expect(results.textContent).toContain("正在读取");
    query<HTMLButtonElement>("[data-saved-caption-close]").click();
    expect(list.mock.calls[0][1]?.aborted).toBe(true);
    click("choose-caption");
    await vi.waitFor(() => expect(results.textContent).toContain("还没有已保存文案"));
    resolveStale([savedCaption]);
    await Promise.resolve();
    expect(results.textContent).toContain("还没有已保存文案");

    query<HTMLButtonElement>("[data-saved-caption-close]").click();
    click("choose-caption");
    await vi.waitFor(() => expect(results.textContent).toContain("暂时无法读取文案"));
    expect(query<HTMLTextAreaElement>('textarea[name="caption"]').value).toBe("");
    expect(update).not.toHaveBeenCalled();
  });

  it("starts Xiaoheihe QR login from Publisher management and reflects the CLI result", async () => {
    vi.spyOn(publisherApi, "plugins").mockResolvedValue([
      mock, { ...mock, plugin_id: "xiaoheihe", name: "小黑盒 CLI", qr_session_saved: false },
    ]);
    const begin = vi.spyOn(publisherApi, "beginXiaoheiheLogin").mockResolvedValue({
      id: "test-login", status: "waiting", qr_png: "cXItcG5n", message: null,
    });
    const status = vi.spyOn(publisherApi, "xiaoheiheLogin").mockResolvedValue({
      id: "test-login", status: "succeeded", qr_png: null, message: "扫码登录成功。",
    });
    await workspace.open(true);
    expect(query("[data-xiaoheihe-session]").textContent).toBe("尚未登录小黑盒");
    expect(queryAll('[data-publisher-action="xiaoheihe-login"]')).toHaveLength(1);
    click("xiaoheihe-login");
    const image = query<HTMLImageElement>("[data-xiaoheihe-qr]");
    await vi.waitFor(() => expect(image.getAttribute("src")).toBe("data:image/png;base64,cXItcG5n"));
    expect(begin).toHaveBeenCalledOnce();
    expect(image.hidden).toBe(false);
    await vi.waitFor(() => expect(query("[data-xiaoheihe-session]").textContent).toBe("已登录小黑盒"), { timeout: 2000 });
    expect(status).toHaveBeenCalledWith("test-login", expect.any(AbortSignal));
    expect(image.hidden).toBe(true);
    expect(image.hasAttribute("src")).toBe(false);
  });

  it("offers a guarded retry only for a legacy small-black-box draft without a receipt", async () => {
    const draft = makeDraft([image(1)]);
    const legacy: PublishAttempt = {
      id: "10000000-0000-4000-8000-000000000003", post_id: 1, revision: 1, plugin_id: "xiaoheihe", plugin_version: "1",
      action: "remote_draft", retry_of: null, status: "unknown", external_post_id: null, external_url: null,
      error_code: "plugin_exit", error_message: "插件异常退出", download_url: null, created_at: draft.created_at,
      started_at: null, finished_at: null,
    };
    const latest = { ...legacy, id: "10000000-0000-4000-8000-000000000004", error_code: "xiaoheihe_submit_unknown" };
    const knownId = { ...legacy, id: "10000000-0000-4000-8000-000000000005", external_post_id: "ab-42" };
    vi.spyOn(publisherApi, "list").mockResolvedValue([draft]);
    vi.spyOn(publisherApi, "get").mockResolvedValue(draft);
    vi.spyOn(publisherApi, "plugins").mockResolvedValue([]);
    vi.spyOn(publisherApi, "attempts").mockResolvedValueOnce([latest, legacy]).mockResolvedValue([knownId, latest, legacy]);
    const run = vi.spyOn(publisherApi, "run").mockResolvedValue(latest);
    await workspace.open();
    const buttons = queryAll<HTMLButtonElement>('[data-publisher-action="retry"]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("核对后重试");
    buttons[0].click();
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith(1, expect.objectContaining({
      action: "remote_draft", plugin_id: "xiaoheihe", retry_of: latest.id, revision: 1,
    })));
    await vi.waitFor(() => expect(queryAll('[data-publisher-action="retry"]')).toHaveLength(0));
  });

  it("offers only supported actions and displays local preparation without claiming platform publication", async () => {
    const draft = makeDraft([image(1)]);
    const attempt: PublishAttempt = {
      id: "10000000-0000-4000-8000-000000000002", post_id: 1, revision: 1, plugin_id: "mock", plugin_version: "1",
      action: "prepare", retry_of: null, status: "queued", external_post_id: null, external_url: null,
      error_code: null, error_message: null, download_url: null, created_at: draft.created_at,
      started_at: null, finished_at: null,
    };
    vi.spyOn(publisherApi, "list").mockResolvedValue([draft]);
    vi.spyOn(publisherApi, "get").mockResolvedValue(draft);
    vi.spyOn(publisherApi, "plugins").mockResolvedValue([mock, { ...mock, plugin_id: "disabled", available: false }]);
    vi.spyOn(publisherApi, "attempts").mockResolvedValueOnce([]).mockResolvedValue([{ ...attempt, status: "prepared" }]);
    const run = vi.spyOn(publisherApi, "run").mockResolvedValue(attempt);
    await workspace.open();
    const target = query<HTMLSelectElement>('[name="target"]');
    expect([...target.options].map(option => option.value)).toEqual(["", "mock"]);
    target.value = "mock";
    target.dispatchEvent(new Event("change", { bubbles: true }));
    const actions = query<HTMLSelectElement>('[name="action"]');
    expect([...actions.options].map(option => option.value)).toEqual(["prepare", "dry_run"]);
    click("run");
    await vi.waitFor(() => expect(query("[data-publisher-history]").textContent).toContain("已在本地准备"));
    expect(run).toHaveBeenCalledWith(1, expect.objectContaining({ action: "prepare", plugin_id: "mock", revision: 1 }));
    expect(query("[data-publisher-history]").textContent).not.toContain("平台已确认发布");
  });
});

describe("PublisherAutosave", () => {
  afterEach(() => { sessionStorage.clear(); });

  it("serializes saves and uses the new revision when edits arrive during an in-flight request", async () => {
    let resolveFirst!: (draft: PostDraft) => void;
    const draft = makeDraft();
    const server = vi.fn<ConstructorParameters<typeof PublisherAutosave>[1]>()
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementation(async (_id, revision, contents) => merged(draft, contents, revision + 1));
    const autosave = new PublisherAutosave(draft, server, vi.fn(), vi.fn());
    draft.title = "初稿";
    autosave.changed();
    const saving = autosave.flush();
    draft.title = "最新";
    autosave.changed();
    const again = autosave.flush();
    expect(again).toBe(saving);
    expect(server).toHaveBeenCalledTimes(1);
    resolveFirst({ ...draft, title: "初稿", revision: 2 });
    expect(await saving).toBe(true);
    expect(server.mock.calls.map(([, revision, content]) => [revision, content.title])).toEqual([[1, "初稿"], [2, "最新"]]);
    expect(Object.keys(sessionStorage)).toEqual([]);
    autosave.destroy();
  });

  it("recovers an unsaved edit after reload and preserves it on revision conflict", async () => {
    const server = vi.fn<ConstructorParameters<typeof PublisherAutosave>[1]>().mockRejectedValue(new ApiError(409, "版本冲突"));
    const first = new PublisherAutosave(makeDraft(), server, vi.fn(), vi.fn());
    first.draft.title = "未保存标题";
    first.changed();
    first.destroy();

    const sameBase = new PublisherAutosave(makeDraft(), server, vi.fn(), vi.fn());
    sameBase.restore();
    expect(sameBase.draft.title).toBe("未保存标题");
    expect(await sameBase.flush()).toBe(false);
    expect(sameBase.conflict).toBe(true);
    sameBase.destroy();

    const differentBase = new PublisherAutosave({ ...makeDraft(), revision: 3 }, server, vi.fn(), vi.fn());
    differentBase.restore();
    expect(await differentBase.flush()).toBe(false);
    expect(differentBase.draft.title).toBe("未保存标题");
    expect(server).toHaveBeenCalledTimes(1);
    differentBase.destroy();
  });
});
