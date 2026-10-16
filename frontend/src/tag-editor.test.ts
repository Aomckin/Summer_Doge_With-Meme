import { afterEach, describe, expect, it, vi } from "vitest";

import { TagEditor } from "./tag-editor";
import type { TagResponse } from "./types";

function tag(id: number, name: string, usageCount: number): TagResponse {
  return {
    id,
    name,
    usage_count: usageCount,
    category: "custom",
    description: null,
    created_at: "2026-08-06T00:00:00Z",
  };
}

function create(tags: string[] = []) {
  document.body.innerHTML = '<div id="editor"></div>';
  const host = document.querySelector<HTMLElement>("#editor")!;
  const onChange = vi.fn();
  const editor = new TagEditor(host, {
    tags,
    availableTags: [tag(1, "舞台", 5), tag(2, "灯光效果", 2), tag(3, "空标签", 0)],
    onChange,
  });
  return { editor, onChange };
}

function addButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("[aria-label='添加标签']")!;
}

function currentInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>("[aria-label='输入标签']")!;
}

function type(value: string): HTMLInputElement {
  const input = currentInput();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return currentInput();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TagEditor", () => {
  it("creates one focused input slot and confirms with Enter", async () => {
    const { editor } = create(["舞台"]);
    addButton().click();
    await vi.waitFor(() => expect(document.activeElement).toBe(currentInput()));
    expect(document.querySelectorAll("[aria-label='输入标签']")).toHaveLength(1);

    const input = type("  蓝色调  ");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(editor.getTags()).toEqual(["舞台", "蓝色调"]);
    expect(document.body.textContent).toContain("蓝色调");
  });

  it("keeps the input mounted while a Chinese IME is composing", () => {
    const { editor } = create();
    addButton().click();
    const input = currentInput();
    input.value = "mao";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, isComposing: true,
    }));

    expect(currentInput()).toBe(input);
    expect(editor.getTags()).toEqual([]);

    input.value = "猫";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    currentInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(editor.getTags()).toEqual(["猫"]);
  });

  it("cancels with Escape and does not create blank tags on blur", () => {
    const { editor } = create();
    addButton().click();
    currentInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(editor.getTags()).toEqual([]);

    addButton().click();
    type("   ").dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    expect(editor.getTags()).toEqual([]);
  });

  it("rejects normalized duplicates with a visible error", () => {
    const { editor } = create(["舞台"]);
    addButton().click();
    type(" 舞台 ").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(editor.getTags()).toEqual(["舞台"]);
    expect(document.querySelector("[role='alert']")?.textContent).toContain("已经添加");
  });

  it("removes a tag with its accessible close button", () => {
    const { editor, onChange } = create(["舞台", "灯光效果"]);
    document.querySelector<HTMLButtonElement>("[aria-label='删除标签 舞台']")?.click();

    expect(editor.getTags()).toEqual(["灯光效果"]);
    expect(onChange).toHaveBeenLastCalledWith(["灯光效果"]);
  });

  it("suggests only used unselected tags and adds a clicked suggestion", () => {
    const { editor } = create(["舞台"]);
    addButton().click();

    const suggestions = [...document.querySelectorAll("[role='option']")].map(
      (item) => item.textContent,
    );
    expect(suggestions).toEqual(["灯光效果 · 2"]);
    expect(document.body.textContent).not.toContain("空标签 · 0");
    document.querySelector<HTMLButtonElement>("[role='option']")?.click();
    expect(editor.getTags()).toEqual(["舞台", "灯光效果"]);
  });

  it("allows a new tag that is not in autocomplete", () => {
    const { editor } = create();
    addButton().click();
    type("新标签").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(editor.getTags()).toEqual(["新标签"]);
  });

  it("preserves input DOM node and cursor position across continuous keystrokes", () => {
    const { editor } = create(["既存标签"]);
    addButton().click();
    const initialInput = currentInput();

    // Type first character
    initialInput.value = "a";
    initialInput.setSelectionRange(1, 1);
    initialInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(currentInput()).toBe(initialInput);
    expect(currentInput().selectionStart).toBe(1);

    // Type second character
    initialInput.value = "ab";
    initialInput.setSelectionRange(2, 2);
    initialInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(currentInput()).toBe(initialInput);
    expect(currentInput().selectionStart).toBe(2);

    initialInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(editor.getTags()).toEqual(["既存标签", "ab"]);
  });

  it("handles native IME compositionstart and compositionend lifecycle without node destruction", () => {
    const { editor } = create();
    addButton().click();
    const input = currentInput();

    // IME starts composition
    input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    input.value = "beijing";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Pressing Enter while composing should not commit
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(editor.getTags()).toEqual([]);
    expect(currentInput()).toBe(input);

    // IME finishes composition
    input.value = "北京";
    input.dispatchEvent(new Event("compositionend", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Now Enter commits
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(editor.getTags()).toEqual(["北京"]);
  });
});
