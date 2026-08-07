import { normalizeTags } from "./api";
import type { TagResponse } from "./types";

export interface TagEditorOptions {
  tags?: string[];
  availableTags?: TagResponse[];
  label?: string;
  disabled?: boolean;
  onChange?: (tags: string[]) => void;
}

function normalizedKey(value: string): string {
  return normalizeTags([value])[0] ?? "";
}

export class TagEditor {
  private tags: string[];
  private availableTags: TagResponse[];
  private editing = false;
  private inputValue = "";
  private error: string | null = null;
  private disabled: boolean;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: TagEditorOptions = {},
  ) {
    this.tags = (options.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
    this.availableTags = options.availableTags ?? [];
    this.disabled = options.disabled ?? false;
    this.render();
  }

  getTags(): string[] {
    return [...this.tags];
  }

  setTags(tags: string[]): void {
    this.tags = tags.map((tag) => tag.trim()).filter(Boolean);
    this.editing = false;
    this.inputValue = "";
    this.error = null;
    this.render();
  }

  setAvailableTags(tags: TagResponse[]): void {
    this.availableTags = tags;
    this.render();
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.render();
  }

  private notify(): void {
    this.options.onChange?.(this.getTags());
  }

  private addInput(): void {
    if (this.disabled || this.editing) return;
    this.editing = true;
    this.inputValue = "";
    this.error = null;
    this.render(true);
  }

  private cancelInput(): void {
    this.editing = false;
    this.inputValue = "";
    this.error = null;
    this.render();
  }

  private commit(value: string): void {
    const displayName = value.trim();
    if (!displayName) {
      this.cancelInput();
      return;
    }
    if (displayName.length > 100) {
      this.error = "标签名称不能超过 100 个字符。";
      this.render(true);
      return;
    }
    const key = normalizedKey(displayName);
    if (!key || this.tags.some((tag) => normalizedKey(tag) === key)) {
      this.error = "这个标签已经添加。";
      this.render(true);
      return;
    }
    this.tags.push(displayName);
    this.editing = false;
    this.inputValue = "";
    this.error = null;
    this.notify();
    this.render();
  }

  private suggestions(): TagResponse[] {
    const query = normalizedKey(this.inputValue);
    const selected = new Set(this.tags.map(normalizedKey));
    return this.availableTags
      .filter(
        (tag) =>
          tag.usage_count > 0 &&
          !selected.has(normalizedKey(tag.name)) &&
          (!query || normalizedKey(tag.name).includes(query)),
      )
      .slice(0, 8);
  }

  private render(focus = false): void {
    this.container.replaceChildren();
    this.container.className = "tag-editor";
    this.container.setAttribute("aria-label", this.options.label ?? "标签编辑器");

    const chips = document.createElement("div");
    chips.className = "tag-editor-chips";
    for (const [index, tag] of this.tags.entries()) {
      const chip = document.createElement("span");
      chip.className = "tag-editor-chip";
      chip.append(document.createTextNode(tag));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `删除标签 ${tag}`);
      remove.disabled = this.disabled;
      remove.addEventListener("click", () => {
        this.tags.splice(index, 1);
        this.error = null;
        this.notify();
        this.render();
      });
      chip.append(remove);
      chips.append(chip);
    }

    if (this.editing) {
      const editor = document.createElement("span");
      editor.className = "tag-editor-input-slot";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 100;
      input.placeholder = "输入标签……";
      input.value = this.inputValue;
      input.setAttribute("aria-label", "输入标签");
      input.addEventListener("input", (event) => {
        this.inputValue = input.value;
        this.error = null;
        if (!(event instanceof InputEvent) || !event.isComposing) this.render(true);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          this.commit(input.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          this.cancelInput();
        }
      });
      input.addEventListener("blur", () => this.commit(input.value));
      editor.append(input);
      for (const [label, action] of [
        ["确认", () => this.commit(input.value)],
        ["取消", () => this.cancelInput()],
      ] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", action);
        editor.append(button);
      }
      chips.append(editor);

      const suggestions = this.suggestions();
      if (suggestions.length) {
        const list = document.createElement("div");
        list.className = "tag-editor-suggestions";
        list.setAttribute("role", "listbox");
        for (const suggestion of suggestions) {
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("role", "option");
          button.textContent = `${suggestion.name} · ${suggestion.usage_count}`;
          button.addEventListener("mousedown", (event) => event.preventDefault());
          button.addEventListener("click", () => this.commit(suggestion.name));
          list.append(button);
        }
        chips.append(list);
      }
      if (focus) queueMicrotask(() => input.focus());
    } else {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "tag-editor-add";
      add.textContent = "+";
      add.disabled = this.disabled;
      add.setAttribute("aria-label", "添加标签");
      add.addEventListener("click", () => this.addInput());
      chips.append(add);
    }
    this.container.append(chips);
    if (this.error) {
      const error = document.createElement("p");
      error.className = "tag-editor-error";
      error.setAttribute("role", "alert");
      error.textContent = this.error;
      this.container.append(error);
    }
  }
}
