import { beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionManagerController, type CollectionApi } from "./collection-manager";
import type { CollectionDetail, CollectionSummary, MemeResponse } from "./types";

const meme = {
  id: 7, title: "猫猫", description: null, source: null,
  original_filename: "cat.png", stored_filename: "cat.png",
  image_url: "/cat.png", thumbnail_url: "/cat-thumb.png", mime_type: "image/png",
  file_size: 10, width: 10, height: 10, file_hash: "a".repeat(64),
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  tags: [], template: null, images: [], image_count: 1,
} satisfies MemeResponse;

const collection = {
  id: 1, name: "高频火力", description: "常用", meme_count: 1,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
} satisfies CollectionSummary;

function setup(overrides: Partial<CollectionApi> = {}) {
  document.body.innerHTML = '<button id="open">牌组</button>';
  const api: CollectionApi = {
    list: vi.fn().mockResolvedValue([collection]),
    get: vi.fn().mockResolvedValue({ ...collection, items: [{ position: 0, added_at: collection.created_at, meme }] } satisfies CollectionDetail),
    create: vi.fn().mockResolvedValue(collection),
    update: vi.fn().mockResolvedValue(collection),
    delete: vi.fn().mockResolvedValue(undefined),
    removeMeme: vi.fn().mockResolvedValue(undefined),
    getMemberships: vi.fn().mockResolvedValue({ collection_ids: [1] }),
    replaceMemberships: vi.fn().mockResolvedValue({ collection_ids: [1] }),
    ...overrides,
  };
  const actions = { openDetail: vi.fn(), openViewer: vi.fn(), copyMeme: vi.fn().mockResolvedValue(true) };
  const controller = new CollectionManagerController(document.querySelector("#open")!, api, actions);
  return { api, actions, controller };
}

beforeEach(() => vi.restoreAllMocks());

describe("CollectionManagerController", () => {
  it("opens and renders the empty state", async () => {
    setup({ list: vi.fn().mockResolvedValue([]) });
    document.querySelector<HTMLButtonElement>("#open")!.click();
    await vi.waitFor(() => expect(document.querySelector("[data-collection-dialog]")?.textContent).toContain("还没有牌组"));
  });

  it("creates, edits and confirms deletion", async () => {
    const { api } = setup();
    document.querySelector<HTMLButtonElement>("#open")!.click();
    await vi.waitFor(() => expect(document.querySelector("[data-collection-form]")).not.toBeNull());
    const form = document.querySelector<HTMLFormElement>("[data-collection-form]")!;
    form.querySelector<HTMLInputElement>('[name="name"]')!.value = "新牌组";
    form.requestSubmit();
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledWith({ name: "新牌组", description: null }));
    document.querySelector<HTMLButtonElement>("[data-edit-collection]")!.click();
    const editForm = document.querySelector<HTMLFormElement>("[data-collection-form]")!;
    editForm.querySelector<HTMLInputElement>('[name="name"]')!.value = "已编辑";
    editForm.requestSubmit();
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledWith(1, { name: "已编辑", description: "常用" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    document.querySelector<HTMLButtonElement>("[data-delete-collection]")!.click();
    await vi.waitFor(() => expect(api.delete).toHaveBeenCalledWith(1));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Meme 不会被删除"));
  });

  it("opens collection detail, reuses cards and removes only membership", async () => {
    const { api, actions } = setup();
    document.querySelector<HTMLButtonElement>("#open")!.click();
    await vi.waitFor(() => expect(document.querySelector("[data-open-collection]")).not.toBeNull());
    document.querySelector<HTMLButtonElement>("[data-open-collection]")!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-meme-id="7"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>("[data-collection-viewer]")!.click();
    expect(actions.openViewer).toHaveBeenCalledWith(meme);
    document.querySelector<HTMLButtonElement>("[data-collection-copy]")!.click();
    expect(actions.copyMeme).toHaveBeenCalledWith(meme, expect.any(HTMLButtonElement));
    expect(api.removeMeme).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>("[data-remove-collection-meme]")!.click();
    await vi.waitFor(() => expect(api.removeMeme).toHaveBeenCalledWith(1, 7));
  });

  it("loads current memberships and saves multi-select without duplicates", async () => {
    const second = { ...collection, id: 2, name: "猫猫", meme_count: 0 };
    const { api, controller } = setup({ list: vi.fn().mockResolvedValue([collection, second]) });
    await controller.openMembership(meme);
    const choices = [...document.querySelectorAll<HTMLInputElement>('[data-membership-dialog] input[type="checkbox"]')];
    expect(choices.map(item => item.checked)).toEqual([true, false]);
    choices[1].checked = true;
    document.querySelector<HTMLFormElement>("[data-membership-form]")!.requestSubmit();
    await vi.waitFor(() => expect(api.replaceMemberships).toHaveBeenCalledWith(7, [1, 2]));
  });

  it("shows loading and API errors, and ignores stale membership requests", async () => {
    let resolveFirst!: (value: { collection_ids: number[] }) => void;
    const first = new Promise<{ collection_ids: number[] }>(resolve => { resolveFirst = resolve; });
    const apiMemberships = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ collection_ids: [] });
    const { controller } = setup({ getMemberships: apiMemberships });
    const opening = controller.openMembership(meme);
    expect(document.querySelector("[data-membership-dialog]")?.textContent).toContain("正在加载");
    await controller.openMembership({ ...meme, id: 8, title: "新的" });
    resolveFirst({ collection_ids: [1] });
    await opening;
    expect(document.querySelector("[data-membership-dialog]")?.textContent).toContain("新的");

    const broken = setup({ list: vi.fn().mockRejectedValue(new Error("boom")) });
    document.querySelector<HTMLButtonElement>("#open")!.click();
    await vi.waitFor(() => expect(document.querySelector("[role=alert]")?.textContent).toContain("牌组请求失败"));
    void broken;
  });
});
