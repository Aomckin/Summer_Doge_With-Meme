import type { ListTagsOptions, TagCleanupResponse, TagResponse, TagSort } from "./types";

export type TagMutation =
  | { type: "rename"; from: string; to: string }
  | { type: "merge"; from: string; to: string }
  | { type: "delete"; name: string }
  | { type: "cleanup"; names: string[] };

export interface TagManagerApi {
  listTags(options?: ListTagsOptions): Promise<TagResponse[]>;
  renameTag(id: number, name: string): Promise<TagResponse>;
  mergeTag(sourceId: number, targetId: number): Promise<TagResponse>;
  deleteTag(id: number): Promise<void>;
  cleanupEmptyTags(): Promise<TagCleanupResponse>;
}

interface TagManagerOptions {
  onMutation(mutation: TagMutation): Promise<void> | void;
  onFilterTag(name: string): Promise<void> | void;
  confirm?: (message: string) => boolean;
  prompt?: (message: string, value?: string) => string | null;
}

type UsageFilter = "all" | "used" | "empty";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "标签操作失败，请稍后重试。";
}

export class TagManagerController {
  private readonly dialog: HTMLDialogElement;
  private tags: TagResponse[] = [];
  private query = "";
  private sort: TagSort = "name_asc";
  private filter: UsageFilter = "all";
  private loading = false;
  private busy = false;
  private error: string | null = null;

  constructor(
    private readonly api: TagManagerApi,
    private readonly options: TagManagerOptions,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "settings-dialog tag-manager-dialog";
    this.dialog.dataset.tagManager = "";
    document.body.append(this.dialog);
    this.dialog.addEventListener("click", (event) => this.handleClick(event));
    this.dialog.addEventListener("input", (event) => this.handleInput(event));
    this.dialog.addEventListener("change", (event) => this.handleChange(event));
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!this.busy) this.dialog.close();
    });
    this.render();
  }

  open(): void {
    this.query = "";
    this.filter = "all";
    this.error = null;
    if (!this.dialog.open) this.dialog.showModal();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.render();
    try {
      this.tags = await this.api.listTags({ includeEmpty: true });
    } catch (error) {
      this.error = errorText(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private visibleTags(): TagResponse[] {
    const query = this.query.trim().toLocaleLowerCase();
    return this.tags
      .filter((tag) => {
        if (this.filter === "used" && tag.usage_count === 0) return false;
        if (this.filter === "empty" && tag.usage_count > 0) return false;
        return !query || tag.name.toLocaleLowerCase().includes(query);
      })
      .sort((left, right) => {
        if (this.sort === "name_asc") return left.name.localeCompare(right.name, "zh-CN");
        if (this.sort === "name_desc") return right.name.localeCompare(left.name, "zh-CN");
        if (this.sort === "usage_asc") return left.usage_count - right.usage_count || left.name.localeCompare(right.name, "zh-CN");
        return right.usage_count - left.usage_count || left.name.localeCompare(right.name, "zh-CN");
      });
  }

  private async mutate(action: () => Promise<TagMutation>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const mutation = await action();
      await this.options.onMutation(mutation);
      this.tags = await this.api.listTags({ includeEmpty: true });
    } catch (error) {
      this.error = errorText(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private handleClick(event: Event): void {
    const target = event.target as Element;
    if (target.closest("[data-close-tag-manager]")) {
      if (!this.busy) this.dialog.close();
      return;
    }
    const filter = target.closest<HTMLButtonElement>("[data-tag-filter]");
    if (filter) {
      this.filter = filter.dataset.tagFilter as UsageFilter;
      this.render();
      return;
    }
    const usage = target.closest<HTMLButtonElement>("[data-filter-library-tag]");
    if (usage?.dataset.filterLibraryTag) {
      const name = usage.dataset.filterLibraryTag;
      this.dialog.close();
      void this.options.onFilterTag(name);
      return;
    }
    const rename = target.closest<HTMLButtonElement>("[data-rename-tag]");
    if (rename) {
      const tag = this.tags.find((item) => item.id === Number(rename.dataset.renameTag));
      if (!tag) return;
      const prompt = this.options.prompt ?? window.prompt;
      const name = prompt(`重命名标签“${tag.name}”`, tag.name);
      if (name === null) return;
      void this.mutate(async () => {
        const updated = await this.api.renameTag(tag.id, name);
        return { type: "rename", from: tag.name, to: updated.name };
      });
      return;
    }
    const merge = target.closest<HTMLButtonElement>("[data-merge-tag]");
    if (merge) {
      const source = this.tags.find((item) => item.id === Number(merge.dataset.mergeTag));
      const select = this.dialog.querySelector<HTMLSelectElement>(`[data-merge-target="${merge.dataset.mergeTag}"]`);
      const targetTag = this.tags.find((item) => item.id === Number(select?.value));
      if (!source || !targetTag) return;
      const confirm = this.options.confirm ?? window.confirm;
      if (!confirm("源标签将被删除，它关联的 Meme 将转移到目标标签。")) return;
      void this.mutate(async () => {
        const updated = await this.api.mergeTag(source.id, targetTag.id);
        return { type: "merge", from: source.name, to: updated.name };
      });
      return;
    }
    const remove = target.closest<HTMLButtonElement>("[data-delete-tag]");
    if (remove) {
      const tag = this.tags.find((item) => item.id === Number(remove.dataset.deleteTag));
      if (!tag || tag.usage_count > 0) return;
      const confirm = this.options.confirm ?? window.confirm;
      if (!confirm(`确定删除未使用标签“${tag.name}”吗？`)) return;
      void this.mutate(async () => {
        await this.api.deleteTag(tag.id);
        return { type: "delete", name: tag.name };
      });
      return;
    }
    if (target.closest("[data-cleanup-tags]")) {
      const count = this.tags.filter((tag) => tag.usage_count === 0).length;
      const confirm = this.options.confirm ?? window.confirm;
      if (!count || !confirm(`将删除 ${count} 个未使用标签，是否继续？`)) return;
      if (!confirm("请再次确认：清理后的空标签无法恢复。")) return;
      void this.mutate(async () => {
        const result = await this.api.cleanupEmptyTags();
        return { type: "cleanup", names: result.deleted_tags };
      });
    }
  }

  private handleInput(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.matches("[data-tag-search]")) {
      this.query = input.value;
      this.render();
      const replacement = this.dialog.querySelector<HTMLInputElement>("[data-tag-search]");
      replacement?.focus();
      replacement?.setSelectionRange(this.query.length, this.query.length);
    }
  }

  private handleChange(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement && select.matches("[data-tag-sort]")) {
      this.sort = select.value as TagSort;
      this.render();
    }
  }

  private render(): void {
    const used = this.tags.filter((tag) => tag.usage_count > 0).length;
    const empty = this.tags.length - used;
    const rows = this.visibleTags().map((tag) => `
      <article class="tag-manager-row" data-managed-tag="${tag.id}">
        <div><strong>${escapeHtml(tag.name)}</strong>${tag.usage_count === 0 ? '<span class="tag-unused-warning">未使用</span>' : ""}</div>
        <button class="button button-ghost tag-usage" type="button" data-filter-library-tag="${escapeHtml(tag.name)}" ${tag.usage_count === 0 || this.busy ? "disabled" : ""}>${tag.usage_count}</button>
        <button class="button button-secondary" type="button" data-rename-tag="${tag.id}" ${this.busy ? "disabled" : ""}>重命名</button>
        <select data-merge-target="${tag.id}" aria-label="${escapeHtml(tag.name)} 的合并目标" ${this.busy ? "disabled" : ""}>
          <option value="">选择目标标签</option>
          ${this.tags.filter((item) => item.id !== tag.id).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}
        </select>
        <button class="button button-secondary" type="button" data-merge-tag="${tag.id}" ${this.busy ? "disabled" : ""}>合并</button>
        ${tag.usage_count === 0 ? `<button class="button button-danger" type="button" data-delete-tag="${tag.id}" ${this.busy ? "disabled" : ""}>删除</button>` : ""}
      </article>`).join("");
    this.dialog.innerHTML = `
      <div class="settings-shell tag-manager-shell">
        <header class="settings-header"><div><p class="eyebrow">TAG LIBRARY</p><h2>标签管理</h2></div><button class="icon-button" type="button" data-close-tag-manager aria-label="关闭标签管理" ${this.busy ? "disabled" : ""}>×</button></header>
        <div class="tag-manager-body">
          <div class="tag-manager-stats"><span>标签总数 <strong>${this.tags.length}</strong></span><span>使用中 <strong>${used}</strong></span><span>空标签 <strong>${empty}</strong></span></div>
          <div class="tag-manager-controls">
            <input type="search" data-tag-search value="${escapeHtml(this.query)}" placeholder="搜索标签" aria-label="搜索标签">
            <select data-tag-sort aria-label="标签排序"><option value="name_asc" ${this.sort === "name_asc" ? "selected" : ""}>名称升序</option><option value="name_desc" ${this.sort === "name_desc" ? "selected" : ""}>名称降序</option><option value="usage_desc" ${this.sort === "usage_desc" ? "selected" : ""}>使用数降序</option><option value="usage_asc" ${this.sort === "usage_asc" ? "selected" : ""}>使用数升序</option></select>
            <div class="tag-manager-filters">${(["all", "used", "empty"] as const).map((value, index) => `<button type="button" class="button button-ghost ${this.filter === value ? "is-active" : ""}" data-tag-filter="${value}">${["全部", "使用中", "空标签"][index]}</button>`).join("")}</div>
            <button class="button button-danger" type="button" data-cleanup-tags ${empty === 0 || this.busy ? "disabled" : ""}>清理全部空标签</button>
          </div>
          ${this.error ? `<p class="form-error" role="alert">${escapeHtml(this.error)}</p>` : ""}
          <div class="tag-manager-list">${this.loading ? '<p class="muted">正在加载标签…</p>' : rows || '<p class="muted">没有符合条件的标签。</p>'}</div>
        </div>
      </div>`;
  }
}
