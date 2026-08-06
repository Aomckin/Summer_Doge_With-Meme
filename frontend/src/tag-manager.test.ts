import { afterEach, describe, expect, it, vi } from "vitest";

import { TagManagerController } from "./tag-manager";
import type { TagResponse } from "./types";

function tag(id: number, name: string, usageCount: number): TagResponse {
  return { id, name, usage_count: usageCount, category: "custom", description: null, created_at: "2026-08-06T00:00:00Z" };
}

const initial = [tag(1, "猫", 3), tag(2, "反应", 1), tag(3, "孤儿", 0)];

function setup() {
  const api = {
    listTags: vi.fn().mockResolvedValue(initial),
    renameTag: vi.fn().mockResolvedValue(tag(1, "猫咪", 3)),
    mergeTag: vi.fn().mockResolvedValue(tag(2, "反应", 4)),
    deleteTag: vi.fn().mockResolvedValue(undefined),
    cleanupEmptyTags: vi.fn().mockResolvedValue({ deleted_count: 1, deleted_tags: ["孤儿"] }),
  };
  const onMutation = vi.fn(async () => undefined);
  const onFilterTag = vi.fn(async () => undefined);
  const confirm = vi.fn<(message: string) => boolean>(() => true);
  const prompt = vi.fn(() => "猫咪");
  const manager = new TagManagerController(api, { onMutation, onFilterTag, confirm, prompt });
  manager.open();
  return { api, onMutation, onFilterTag, confirm, prompt };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("TagManagerController", () => {
  it("keeps controls and the scrollable list inside the fixed manager body", async () => {
    setup();
    await vi.waitFor(() => expect(document.querySelectorAll("[data-managed-tag]")).toHaveLength(3));
    const shell = document.querySelector(".tag-manager-shell")!;
    expect(shell.children).toHaveLength(2);
    expect(shell.children[0].tagName).toBe("HEADER");
    expect(shell.children[1].classList.contains("tag-manager-body")).toBe(true);
    expect(shell.children[1].querySelector(":scope > .tag-manager-stats")).not.toBeNull();
    expect(shell.children[1].querySelector(":scope > .tag-manager-controls")).not.toBeNull();
    expect(shell.children[1].querySelector(":scope > .tag-manager-list")).not.toBeNull();
  });

  it("loads every tag and renders used and empty statistics", async () => {
    const { api } = setup();
    await vi.waitFor(() => expect(document.querySelectorAll("[data-managed-tag]")).toHaveLength(3));
    expect(api.listTags).toHaveBeenCalledWith({ includeEmpty: true });
    expect(document.querySelector(".tag-manager-stats")?.textContent).toContain("标签总数 3");
    expect(document.querySelector(".tag-manager-stats")?.textContent).toContain("使用中 2");
    expect(document.querySelector(".tag-manager-stats")?.textContent).toContain("空标签 1");
    expect(document.body.textContent).toContain("未使用");
  });

  it("searches, sorts and filters locally", async () => {
    setup();
    await vi.waitFor(() => expect(document.querySelectorAll("[data-managed-tag]")).toHaveLength(3));
    const search = document.querySelector<HTMLInputElement>("[data-tag-search]")!;
    search.value = "猫";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelectorAll("[data-managed-tag]")).toHaveLength(1);
    const refreshedSearch = document.querySelector<HTMLInputElement>("[data-tag-search]")!;
    refreshedSearch.value = "";
    refreshedSearch.dispatchEvent(new Event("input", { bubbles: true }));
    const sort = document.querySelector<HTMLSelectElement>("[data-tag-sort]")!;
    sort.value = "usage_asc";
    sort.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector("[data-managed-tag]")?.getAttribute("data-managed-tag")).toBe("3");
    document.querySelector<HTMLButtonElement>("[data-tag-filter='empty']")?.click();
    expect(document.querySelectorAll("[data-managed-tag]")).toHaveLength(1);
    expect(document.body.textContent).toContain("孤儿");
  });

  it("renames and merges through the API and reports mutations", async () => {
    const { api, onMutation } = setup();
    await vi.waitFor(() => expect(document.querySelectorAll("[data-managed-tag]")).toHaveLength(3));
    document.querySelector<HTMLButtonElement>("[data-rename-tag='1']")?.click();
    await vi.waitFor(() => expect(onMutation).toHaveBeenCalledWith({ type: "rename", from: "猫", to: "猫咪" }));
    await vi.waitFor(() => expect(api.listTags).toHaveBeenCalledTimes(2));

    const target = document.querySelector<HTMLSelectElement>("[data-merge-target='1']")!;
    target.value = "2";
    document.querySelector<HTMLButtonElement>("[data-merge-tag='1']")?.click();
    await vi.waitFor(() => expect(onMutation).toHaveBeenCalledWith({ type: "merge", from: "猫", to: "反应" }));
  });

  it("only offers ordinary deletion for empty tags", async () => {
    const { onMutation } = setup();
    await vi.waitFor(() => expect(document.querySelectorAll("[data-managed-tag]")).toHaveLength(3));
    expect(document.querySelector("[data-delete-tag='1']")).toBeNull();
    document.querySelector<HTMLButtonElement>("[data-delete-tag='3']")?.click();
    await vi.waitFor(() => expect(onMutation).toHaveBeenCalledWith({ type: "delete", name: "孤儿" }));
  });

  it("requires two confirmations before cleaning every empty tag", async () => {
    const { api, confirm } = setup();
    await vi.waitFor(() => expect(document.querySelectorAll("[data-managed-tag]")).toHaveLength(3));
    document.querySelector<HTMLButtonElement>("[data-cleanup-tags]")?.click();
    await vi.waitFor(() => expect(api.cleanupEmptyTags).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0][0]).toContain("1 个未使用标签");
  });

  it("closes and applies a library filter when usage count is clicked", async () => {
    const { onFilterTag } = setup();
    await vi.waitFor(() => expect(document.querySelectorAll("[data-managed-tag]")).toHaveLength(3));
    document.querySelector<HTMLButtonElement>("[data-filter-library-tag='猫']")?.click();
    expect(onFilterTag).toHaveBeenCalledWith("猫");
    expect(document.querySelector<HTMLDialogElement>("[data-tag-manager]")?.open).toBe(false);
  });
});
