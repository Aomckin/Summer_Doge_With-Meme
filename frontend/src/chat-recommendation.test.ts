import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatRecommendationController } from "./chat-recommendation";
import type {
  ChatRecommendationResponse,
  MemeResponse,
} from "./types";

function meme(id: number, title = `Meme ${id}`): MemeResponse {
  return {
    id,
    title,
    description: "desc",
    source: null,
    original_filename: `${id}.png`,
    stored_filename: `${id}.png`,
    image_url: `/media/${id}.png`,
    thumbnail_url: `/thumb/${id}.png`,
    mime_type: "image/png",
    file_size: 10,
    width: 10,
    height: 10,
    file_hash: String(id),
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    tags: [{ id: 1, name: "反讽", category: "scene", description: null, created_at: "2026-01-01", usage_count: 1 }],
    template: null,
    images: [],
    image_count: 1,
    vault_id: 1,
    vault_asset_no: id,
  };
}

function response(item = meme(1), page = 1, totalPages = 2): ChatRecommendationResponse {
  return {
    items: [{ meme: item, score: 0.834 }],
    total: 13,
    page,
    page_size: 12,
    total_pages: totalPages,
    indexed_count: 20,
    missing_count: 1,
    model_id: "qwen3-vl-embedding",
  };
}

function setup(recommend = vi.fn().mockResolvedValue(response())) {
  document.body.innerHTML = '<button id="open">场景召唤</button>';
  const openDetail = vi.fn();
  const openViewer = vi.fn();
  const copyMeme = vi.fn().mockResolvedValue(true);
  new ChatRecommendationController(
    document.querySelector<HTMLButtonElement>("#open")!,
    { recommend },
    { openDetail, openViewer, copyMeme },
  );
  document.querySelector<HTMLButtonElement>("#open")!.click();
  return { recommend, openDetail, openViewer, copyMeme };
}

describe("chat scene recommendations", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens, keeps context and intent separate, and fills intent from a chip", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { recommend } = setup();
    const dialog = document.querySelector<HTMLDialogElement>("[data-scene-recommendation-dialog]")!;
    expect(dialog.open).toBe(true);
    const context = dialog.querySelector<HTMLTextAreaElement>('[name="context"]')!;
    const intent = dialog.querySelector<HTMLInputElement>('[name="response_intent"]')!;
    context.value = "朋友：你不是说马上写作业吗？";
    dialog.querySelector<HTMLButtonElement>('[data-scene-intent="阴阳怪气"]')!.click();
    expect(intent.value).toBe("阴阳怪气");
    dialog.querySelector<HTMLButtonElement>("[data-scene-submit]")!.click();
    await vi.waitFor(() => expect(recommend).toHaveBeenCalledWith(expect.objectContaining({
      context: "朋友：你不是说马上写作业吗？",
      response_intent: "阴阳怪气",
      page: 1,
    })));
    expect(document.body.textContent).toContain("相关度 0.834");
    expect(document.body.textContent).toContain("反讽");
    expect(dialog.querySelector<HTMLAnchorElement>('.scene-result-actions a')?.getAttribute("href")).toBe("/api/memes/1/download");
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("shows loading and errors, then requests the next semantic page", async () => {
    let rejectFirst!: (error: Error) => void;
    const pending = new Promise<ChatRecommendationResponse>((_resolve, reject) => { rejectFirst = reject; });
    const recommend = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(response(meme(2), 2, 2));
    setup(recommend);
    const dialog = document.querySelector<HTMLDialogElement>("[data-scene-recommendation-dialog]")!;
    dialog.querySelector<HTMLTextAreaElement>('[name="context"]')!.value = "最近聊天";
    dialog.querySelector<HTMLButtonElement>("[data-scene-submit]")!.click();
    expect(document.body.textContent).toContain("正在检索最合适的 Meme");
    rejectFirst(new Error("Provider 未配置"));
    await vi.waitFor(() => expect(document.body.textContent).toContain("Provider 未配置"));

    dialog.querySelector<HTMLButtonElement>("[data-scene-submit]")!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Meme 2"));
    expect(recommend).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
  });

  it("uses detail and viewer callbacks and clears private text when closing", async () => {
    const { openDetail, openViewer } = setup();
    const dialog = document.querySelector<HTMLDialogElement>("[data-scene-recommendation-dialog]")!;
    const context = dialog.querySelector<HTMLTextAreaElement>('[name="context"]')!;
    context.value = "私人聊天正文";
    dialog.querySelector<HTMLButtonElement>("[data-scene-submit]")!.click();
    await vi.waitFor(() => expect(dialog.querySelector("[data-scene-detail]")).not.toBeNull());
    dialog.querySelector<HTMLButtonElement>("[data-scene-detail]")!.click();
    expect(openDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(context.value).toBe("");
    expect(dialog.open).toBe(false);

    document.querySelector<HTMLButtonElement>("#open")!.click();
    dialog.querySelector<HTMLTextAreaElement>('[name="context"]')!.value = "另一段聊天";
    dialog.querySelector<HTMLButtonElement>("[data-scene-submit]")!.click();
    await vi.waitFor(() => expect(dialog.querySelector("[data-scene-viewer]")).not.toBeNull());
    dialog.querySelector<HTMLButtonElement>("[data-scene-viewer]")!.click();
    expect(openViewer).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("copies from a result without changing or closing the query", async () => {
    const { copyMeme } = setup();
    const dialog = document.querySelector<HTMLDialogElement>("[data-scene-recommendation-dialog]")!;
    const context = dialog.querySelector<HTMLTextAreaElement>('[name="context"]')!;
    context.value = "保留这段聊天";
    dialog.querySelector<HTMLButtonElement>("[data-scene-submit]")!.click();
    await vi.waitFor(() => expect(dialog.querySelector("[data-scene-copy]")).not.toBeNull());
    dialog.querySelector<HTMLButtonElement>("[data-scene-copy]")!.click();
    expect(copyMeme).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), expect.any(HTMLButtonElement));
    expect(context.value).toBe("保留这段聊天");
    expect(dialog.open).toBe(true);
  });

  it("prevents an older query from overwriting a newer result and clears on close", async () => {
    let resolveFirst!: (value: ChatRecommendationResponse) => void;
    const first = new Promise<ChatRecommendationResponse>(resolve => { resolveFirst = resolve; });
    const recommend = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(response(meme(9, "新结果"), 1, 2));
    setup(recommend);
    const dialog = document.querySelector<HTMLDialogElement>("[data-scene-recommendation-dialog]")!;
    const context = dialog.querySelector<HTMLTextAreaElement>('[name="context"]')!;
    context.value = "旧查询";
    dialog.querySelector<HTMLButtonElement>("[data-scene-submit]")!.click();
    context.value = "新查询";
    dialog.querySelector<HTMLButtonElement>("[data-scene-submit]")!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("新结果"));
    resolveFirst(response(meme(8, "旧结果"), 1, 2));
    await Promise.resolve();
    expect(document.body.textContent).not.toContain("旧结果");

    dialog.querySelector<HTMLButtonElement>("[data-scene-next]")!.click();
    await vi.waitFor(() => expect(recommend).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    dialog.querySelector<HTMLButtonElement>("[data-close-scene]")!.click();
    expect(context.value).toBe("");
    expect(dialog.querySelector("[data-scene-meme]")).toBeNull();
  });
});
