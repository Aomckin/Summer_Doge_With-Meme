import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { MemeVaultApp, type MemeApi } from "./app";
import type { MemePageResponse, MemeResponse, SemanticSearchResponse } from "./types";

function meme(id: number, title = `Meme ${id}`): MemeResponse {
  return {
    id, title, description: "desc", source: null, original_filename: `${id}.png`,
    stored_filename: `${id}.png`, image_url: `/media/${id}.png`, thumbnail_url: `/thumb/${id}.png`,
    mime_type: "image/png", file_size: 10, width: 10, height: 10, file_hash: String(id),
    created_at: "2026-01-01", updated_at: "2026-01-01", tags: [], template: null,
    images: [], image_count: 1,
  };
}

function page(items = [meme(1)]): MemePageResponse {
  return { items, total: items.length, page: 1, page_size: 24, total_pages: items.length ? 1 : 0, sort: "default", shuffle_seed: null };
}

function semantic(items = [{ meme: meme(2, "语义结果"), score: 0.742 }], currentPage = 1): SemanticSearchResponse {
  return { items, total: 30, page: currentPage, page_size: 24, total_pages: 2, indexed_count: 30, missing_count: 2, model_id: "qwen3-vl-embedding" };
}

function api(overrides: Partial<MemeApi> = {}): MemeApi {
  return {
    listMemePage: vi.fn().mockResolvedValue(page()),
    listMemes: vi.fn().mockResolvedValue([]),
    listTags: vi.fn().mockResolvedValue([{ id: 1, name: "反讽", category: "", description: null, created_at: "", usage_count: 1 }]),
    listTemplates: vi.fn().mockResolvedValue([]),
    listMemeRelations: vi.fn().mockResolvedValue([]),
    semanticSearch: vi.fn().mockResolvedValue(semantic()),
    listSimilarMemes: vi.fn().mockRejectedValue(new ApiError(409, "missing")),
    ...overrides,
  } as unknown as MemeApi;
}

describe("semantic search mode", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });
  afterEach(() => vi.useRealTimers());

  it("defaults to keyword debounce and never submits semantic search while typing", async () => {
    vi.useFakeTimers();
    const mock = api();
    const app = new MemeVaultApp(document.querySelector("#root")!, mock);
    await app.start();
    expect(document.querySelector<HTMLSelectElement>("#search-mode")?.value).toBe("keyword");
    const input = document.querySelector<HTMLInputElement>("#meme-search")!;
    input.value = "reaction";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(299);
    expect(mock.listMemePage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.listMemePage).toHaveBeenLastCalledWith(expect.objectContaining({ q: "reaction" }));

    const mode = document.querySelector<HTMLSelectElement>("#search-mode")!;
    mode.value = "semantic";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    input.value = "朋友说了很离谱的话";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.runAllTimersAsync();
    expect(mock.semanticSearch).not.toHaveBeenCalled();
  });

  it("submits on Enter and button, keeps tags and pagination, hides sort, and displays decimal score", async () => {
    const mock = api();
    const app = new MemeVaultApp(document.querySelector("#root")!, mock);
    await app.start();
    const mode = document.querySelector<HTMLSelectElement>("#search-mode")!;
    mode.value = "semantic";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    const input = document.querySelector<HTMLInputElement>("#meme-search")!;
    input.value = "朋友说了很离谱的话";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(mock.semanticSearch).toHaveBeenCalledWith(expect.objectContaining({ page: 1, tags: [] })));
    expect(document.body.textContent).toContain("相关度 0.742");
    expect(document.body.textContent).not.toContain("74.2%");
    expect(document.querySelector<HTMLSelectElement>("[data-list-sort]")?.closest("label")?.hidden).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-tag="反讽"]')!.click();
    await vi.waitFor(() => expect(mock.semanticSearch).toHaveBeenLastCalledWith(expect.objectContaining({ tags: ["反讽"] })));
    document.querySelector<HTMLButtonElement>('[data-page="2"]')!.click();
    await vi.waitFor(() => expect(mock.semanticSearch).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, query: "朋友说了很离谱的话", tags: ["反讽"] })));
    document.querySelector<HTMLButtonElement>("#semantic-search-button")!.click();
    await vi.waitFor(() => expect(mock.semanticSearch).toHaveBeenCalledTimes(4));
  });

  it("prevents an older semantic response from replacing a newer query", async () => {
    let resolveFirst!: (value: SemanticSearchResponse) => void;
    const first = new Promise<SemanticSearchResponse>(resolve => { resolveFirst = resolve; });
    const search = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(semantic([{ meme: meme(9, "新结果"), score: 0.9 }]));
    const mock = api({ semanticSearch: search });
    const app = new MemeVaultApp(document.querySelector("#root")!, mock);
    await app.start();
    const mode = document.querySelector<HTMLSelectElement>("#search-mode")!;
    mode.value = "semantic";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    const input = document.querySelector<HTMLInputElement>("#meme-search")!;
    input.value = "第一个查询";
    document.querySelector<HTMLButtonElement>("#semantic-search-button")!.click();
    input.value = "第二个查询";
    document.querySelector<HTMLButtonElement>("#semantic-search-button")!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("新结果"));
    resolveFirst(semantic([{ meme: meme(8, "旧结果"), score: 0.8 }]));
    await Promise.resolve();
    expect(document.body.textContent).not.toContain("旧结果");
  });

  it("shows an explicit rebuild entry for an unindexed Meme and renders semantic similarity separately", async () => {
    const selected = meme(1, "当前");
    const similarItem = meme(2, "相似项");
    const similarApi = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, "missing"))
      .mockResolvedValueOnce({ items: [{ meme: similarItem, score: 0.812 }] });
    const rebuild = vi.fn().mockResolvedValue({});
    const mock = api({ listMemePage: vi.fn().mockResolvedValue(page([selected])), listSimilarMemes: similarApi, rebuildMemeEmbedding: rebuild as never });
    const app = new MemeVaultApp(document.querySelector("#root")!, mock);
    await app.start();
    document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("尚未建立语义索引"));
    expect(document.body.textContent).toContain("直接关联");
    expect(document.body.textContent).toContain("语义相似 Meme");
    document.querySelector<HTMLButtonElement>("[data-rebuild-embedding]")!.click();
    await vi.waitFor(() => expect(rebuild).toHaveBeenCalledWith(1));
    await vi.waitFor(() => expect(document.body.textContent).toContain("相似项"));
    expect(document.body.textContent).toContain("相关度 0.812");
  });
});
