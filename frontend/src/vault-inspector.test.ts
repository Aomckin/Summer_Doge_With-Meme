import { beforeEach, describe, expect, it, vi } from "vitest";
import { VaultInspectorController } from "./vault-inspector";
import type {
  MemeResponse,
  SimilarityInspectionResponse,
} from "./types";

function meme(id: number, title = `Meme ${id}`): MemeResponse {
  return {
    id, title, description: "desc", source: null,
    original_filename: `${id}.png`, stored_filename: `${id}.png`,
    image_url: `/media/${id}.png`, thumbnail_url: `/thumb/${id}.png`,
    mime_type: "image/png", file_size: 10, width: 10, height: 10,
    file_hash: String(id), created_at: "2026-01-01", updated_at: "2026-01-01",
    tags: [{ id, name: `tag-${id}`, category: "custom", description: null, created_at: "2026-01-01", usage_count: 1 }],
    template: null,
    images: [{ id, original_filename: `${id}.png`, stored_filename: `${id}.png`, image_url: `/media/${id}.png`, thumbnail_url: null, mime_type: "image/png", file_size: 10, width: 10, height: 10, file_hash: String(id), position: 0, created_at: "2026-01-01" }],
    image_count: 1,
  };
}

function response(pairs = [
  { meme_a: meme(1), meme_b: meme(2), score: 0.927, weak_relation_exists: false },
  { meme_a: meme(1), meme_b: meme(3), score: 0.88, weak_relation_exists: true },
  { meme_a: meme(4), meme_b: meme(5), score: 0.86, weak_relation_exists: false },
]): SimilarityInspectionResponse {
  return { requested_count: 10, ready_count: 8, missing_or_stale_count: 2, candidate_pair_count: pairs.length, pairs };
}

function setup(overrides: Record<string, unknown> = {}) {
  document.body.innerHTML = '<button id="open">宝库巡检</button>';
  const api = {
    inspect: vi.fn().mockResolvedValue(response()),
    ignore: vi.fn().mockResolvedValue({}),
    relate: vi.fn().mockResolvedValue([]),
    merge: vi.fn().mockImplementation((targetId: number) => Promise.resolve(meme(targetId, "合并结果"))),
    ...overrides,
  };
  const actions = { openViewer: vi.fn(), onMerge: vi.fn() };
  new VaultInspectorController(document.querySelector<HTMLButtonElement>("#open")!, api, actions);
  document.querySelector<HTMLButtonElement>("#open")!.click();
  return { api, actions, dialog: document.querySelector<HTMLDialogElement>("[data-vault-inspector-dialog]")! };
}

function fill(dialog: HTMLDialogElement): void {
  dialog.querySelector<HTMLInputElement>('[name="start_meme_id"]')!.value = "7201";
  dialog.querySelector<HTMLInputElement>('[name="end_meme_id"]')!.value = "7300";
  dialog.querySelector<HTMLInputElement>('[name="top_k"]')!.value = "5";
  dialog.querySelector<HTMLInputElement>('[name="similarity_threshold"]')!.value = "0.85";
}

describe("vault inspector", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

  it("opens, submits range parameters, shows loading, stats, pair details and navigation", async () => {
    let resolve!: (value: SimilarityInspectionResponse) => void;
    const pending = new Promise<SimilarityInspectionResponse>(value => { resolve = value; });
    const { api, dialog, actions } = setup({ inspect: vi.fn().mockReturnValue(pending) });
    expect(dialog.open).toBe(true);
    fill(dialog);
    dialog.querySelector<HTMLButtonElement>("[data-start-inspection]")!.click();
    expect(document.body.textContent).toContain("正在读取本地语义索引");
    resolve(response());
    await vi.waitFor(() => expect(document.body.textContent).toContain("语义相似度 0.927"));
    expect(api.inspect).toHaveBeenCalledWith(expect.objectContaining({ start_meme_id: 7201, end_meme_id: 7300, top_k: 5, similarity_threshold: 0.85 }));
    expect(document.body.textContent).toContain("8 个拥有有效向量");
    expect(document.body.textContent).toContain("2 个缺少或已过期");
    expect(document.body.textContent).toContain("#1 · Meme 1");
    dialog.querySelector<HTMLButtonElement>("[data-next-pair]")!.click();
    expect(document.body.textContent).toContain("已有弱关联");
    dialog.querySelector<HTMLButtonElement>("[data-previous-pair]")!.click();
    dialog.querySelector<HTMLButtonElement>('[data-inspector-side="a"] [data-view-inspector-meme]')!.click();
    expect(actions.openViewer).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("shows validation, error and empty states", async () => {
    const { api, dialog } = setup();
    dialog.querySelector<HTMLInputElement>('[name="start_meme_id"]')!.value = "5";
    dialog.querySelector<HTMLInputElement>('[name="end_meme_id"]')!.value = "3";
    dialog.querySelector<HTMLButtonElement>("[data-start-inspection]")!.click();
    expect(document.body.textContent).toContain("有效且不超过 1000 个 ID");
    expect(api.inspect).not.toHaveBeenCalled();

    fill(dialog);
    api.inspect.mockRejectedValueOnce(new Error("索引不可用"));
    dialog.querySelector<HTMLButtonElement>("[data-start-inspection]")!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("索引不可用"));
    api.inspect.mockResolvedValueOnce(response([]));
    dialog.querySelector<HTMLButtonElement>("[data-start-inspection]")!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("没有待处理的候选 Pair"));
  });

  it("ignores and relates pairs, removing only the current pair", async () => {
    const { api, dialog } = setup();
    fill(dialog);
    dialog.querySelector<HTMLButtonElement>("[data-start-inspection]")!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("1 / 3"));
    dialog.querySelector<HTMLButtonElement>("[data-ignore-pair]")!.click();
    await vi.waitFor(() => expect(api.ignore).toHaveBeenCalledWith(1, 2));
    await vi.waitFor(() => expect(document.body.textContent).toContain("1 / 2"));
    expect(document.body.textContent).toContain("已有弱关联");
    dialog.querySelector<HTMLButtonElement>("[data-next-pair]")!.click();
    dialog.querySelector<HTMLButtonElement>("[data-relate-pair]")!.click();
    await vi.waitFor(() => expect(api.relate).toHaveBeenCalledWith(4, [5]));
    await vi.waitFor(() => expect(document.body.textContent).toContain("1 / 1"));
  });

  it("requires explicit merge confirmation and removes every stale pair involving both memes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { api, actions, dialog } = setup();
    fill(dialog);
    dialog.querySelector<HTMLButtonElement>("[data-start-inspection]")!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("1 / 3"));
    dialog.querySelector<HTMLButtonElement>("[data-merge-left]")!.click();
    expect(api.merge).not.toHaveBeenCalled();
    dialog.querySelector<HTMLButtonElement>("[data-merge-left]")!.click();
    await vi.waitFor(() => expect(api.merge).toHaveBeenCalledWith(1, 2));
    expect(confirm.mock.calls[1][0]).toContain("不提供自动撤销");
    expect(actions.onMerge).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 2);
    await vi.waitFor(() => expect(document.body.textContent).toContain("#4 · Meme 4"));
    expect(document.body.textContent).toContain("1 / 1");
    expect(document.body.textContent).toContain("向量已标记过期");
  });

  it("supports right target, ignores stale responses, and clears temporary state on close", async () => {
    let resolveFirst!: (value: SimilarityInspectionResponse) => void;
    const first = new Promise<SimilarityInspectionResponse>(resolve => { resolveFirst = resolve; });
    const inspect = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(response([{ meme_a: meme(9), meme_b: meme(10), score: 0.99, weak_relation_exists: false }]));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { api, dialog } = setup({ inspect });
    fill(dialog);
    dialog.querySelector<HTMLButtonElement>("[data-start-inspection]")!.click();
    dialog.querySelector<HTMLInputElement>('[name="start_meme_id"]')!.value = "9";
    dialog.querySelector<HTMLInputElement>('[name="end_meme_id"]')!.value = "10";
    dialog.querySelector<HTMLButtonElement>("[data-start-inspection]")!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("#9 · Meme 9"));
    resolveFirst(response());
    await Promise.resolve();
    expect(document.body.textContent).not.toContain("#1 · Meme 1");
    dialog.querySelector<HTMLButtonElement>("[data-merge-right]")!.click();
    await vi.waitFor(() => expect(api.merge).toHaveBeenCalledWith(10, 9));
    expect(confirm).toHaveBeenCalled();
    dialog.querySelector<HTMLButtonElement>("[data-close-inspector]")!.click();
    expect(dialog.open).toBe(false);
    expect(dialog.querySelector<HTMLInputElement>('[name="start_meme_id"]')!.value).toBe("");
    expect(dialog.querySelector("[data-inspector-side]")).toBeNull();
  });
});
