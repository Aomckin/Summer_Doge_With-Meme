import { ApiError, listMemePage, semanticSearch } from "./api";
import { clampPage, memePageSizeOptions, paginationMarkup } from "./pagination";
import { newPostId } from "./publisher-autosave";
import type { MemeImageResponse, MemePageSize, MemeResponse, PostItem, PostSummary, VaultSummary } from "./types";
import { escapeHtml } from "./ui";

type PickerOptions = {
  source?: never;
  single?: boolean;
  existingImageIds?: ReadonlySet<number>;
  otherImageIds?: ReadonlySet<number>;
  submit(items: PostItem[]): void | Promise<void>;
} | {
  source: readonly MemeResponse[];
  single?: never;
  drafts: PostSummary[];
  submit(items: PostItem[], postId: number): Promise<void>;
};

export function publisherMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "请求失败，请重试";
}

export class PublisherPicker {
  private readonly dialog = document.createElement("dialog");
  private readonly selected = new Map<number, PostItem>();
  private readonly visible = new Map<number, PostItem>();
  private options: PickerOptions | null = null;
  private request: AbortController | null = null;
  private page = 1;
  private pageSize: MemePageSize = 24;
  private totalPages = 0;
  private query = "";
  private loading = false;
  private busy = false;

  constructor(private readonly vaults: () => VaultSummary[], private readonly currentVault: () => number | undefined) {
    this.dialog.className = "settings-dialog publisher-picker";
    this.dialog.setAttribute("aria-label", "选取帖文图片");
    this.dialog.innerHTML = `<div class="publisher-shell">
      <header class="publisher-bar"><h2 data-picker-title>选图</h2><button type="button" class="icon-button" data-picker-close aria-label="关闭选图">×</button></header>
      <form class="publisher-bar" data-picker-search>
        <label>仓库 <select name="vault"></select></label>
        <label>搜索方式 <select name="search-mode"><option value="keyword">关键词</option><option value="semantic">语义</option></select></label>
        <label>查询 <input type="search" name="q" maxlength="500" autocomplete="off"></label>
        <button type="submit" class="button button-secondary">搜索</button>
      </form>
      <div class="publisher-picker-results" data-picker-results aria-label="搜索结果"></div>
      <footer class="publisher-picker-footer">
        <div class="publisher-bar">
          <label>每页素材 <select name="picker-page-size">${memePageSizeOptions}</select></label>
          <span data-picker-count role="status"></span>
        </div>
        <nav class="pagination" data-picker-pages aria-label="选图分页"></nav>
        <div class="publisher-bar">
          <label data-picker-destination>添加到 <select name="destination"></select></label>
          <button type="button" class="button button-primary" data-picker-confirm>添加所选图片</button>
        </div>
        <p class="form-error" data-picker-error role="alert" hidden></p>
      </footer>
    </div>`;
    document.body.append(this.dialog);
    this.dialog.addEventListener("close", () => {
      if (!this.dialog.open) this.request?.abort();
    });
    this.dialog.addEventListener("cancel", event => { if (this.busy) event.preventDefault(); });
    this.dialog.addEventListener("submit", event => {
      event.preventDefault();
      const query = this.node<HTMLInputElement>('input[name="q"]').value.trim();
      if (this.semanticMode && [...query].length < 2) {
        this.setError("请输入至少 2 个字符进行语义搜索");
        return;
      }
      this.query = query;
      void this.load(1);
    });
    this.dialog.addEventListener("keydown", event => {
      const field = event.target;
      if (event.key === "Enter" && field instanceof HTMLInputElement && field.matches("[data-page-input]")) {
        event.preventDefault();
        if (field.value.trim()) this.goToPage(Number(field.value));
      }
    });
    this.dialog.addEventListener("click", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("button");
      if (!button || this.busy) return;
      if (button.hasAttribute("data-picker-close")) this.dialog.close();
      if (button.hasAttribute("data-page")) this.goToPage(Number(button.dataset.page));
      if (button.hasAttribute("data-picker-confirm")) void this.submit();
    });
    this.dialog.addEventListener("change", event => {
      const field = event.target as HTMLInputElement;
      if (field.name === "vault") {
        const wasSemantic = this.semanticMode;
        this.syncSearchControls();
        if (wasSemantic && !this.semanticMode) this.query = "";
        void this.load(1);
      } else if (field.name === "search-mode") {
        this.query = "";
        this.syncSearchControls();
        void this.load(1);
      } else if (field.name === "picker-page-size") {
        const size = Number(field.value);
        if (size === 24 || size === 48 || size === 96) {
          this.pageSize = size;
          void this.load(1);
        }
      }
      if (field.name !== "post-image") return;
      const item = this.visible.get(Number(field.value));
      if (!item) return;
      if (this.options?.single) this.selected.clear();
      if (field.checked) this.selected.set(item.meme_image_id, item);
      else this.selected.delete(item.meme_image_id);
      this.renderCount();
    });
  }

  private node<T extends HTMLElement>(selector: string): T {
    return this.dialog.querySelector<T>(selector)!;
  }

  private get semanticMode(): boolean {
    return this.node<HTMLSelectElement>('select[name="search-mode"]').value === "semantic";
  }

  private get vaultId(): number | undefined {
    return Number(this.node<HTMLSelectElement>('select[name="vault"]').value) || undefined;
  }

  private syncSearchControls(): void {
    const mode = this.node<HTMLSelectElement>('select[name="search-mode"]');
    const semantic = mode.options[1];
    const vault = this.vaults().find(item => item.id === this.vaultId);
    semantic.hidden = semantic.disabled = vault?.capabilities?.semanticSearch !== true;
    if (semantic.disabled) mode.value = "keyword";
    this.node<HTMLInputElement>('input[name="q"]').placeholder = this.semanticMode ? "描述想找的图片" : "搜索素材";
  }

  private goToPage(value: number): void {
    if (this.loading || this.busy || !this.totalPages) return;
    const page = clampPage(value, this.totalPages);
    if (page !== this.page) void this.load(page);
  }

  open(options: PickerOptions): void {
    if (this.dialog.open) return;
    this.options = options;
    this.selected.clear();
    this.query = "";
    this.page = 1;
    this.totalPages = 0;
    this.node("[data-picker-title]").textContent = options.single ? "替换图片" : "选取帖文图片";
    const search = this.node<HTMLFormElement>("[data-picker-search]");
    search.hidden = Boolean(options.source);
    search.reset();
    const availableVaults = this.vaults();
    const vaultSelect = this.node<HTMLSelectElement>('select[name="vault"]');
    vaultSelect.replaceChildren(...availableVaults.map(vault => new Option(vault.name, String(vault.id))));
    const current = this.currentVault();
    if (current !== undefined && availableVaults.some(vault => vault.id === current)) vaultSelect.value = String(current);
    this.syncSearchControls();
    this.node<HTMLSelectElement>('select[name="picker-page-size"]').value = String(this.pageSize);
    const destination = this.node<HTMLSelectElement>('select[name="destination"]');
    destination.replaceChildren(...(options.source ? options.drafts : [])
      .map(post => new Option(post.title || "未命名帖文", String(post.id))));
    destination.closest<HTMLElement>("label")!.hidden = !options.source;
    this.dialog.showModal();
    void this.load(1);
  }

  private async load(page: number): Promise<void> {
    const options = this.options!;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const results = this.node("[data-picker-results]");
    this.loading = true;
    this.renderPagination();
    this.renderCount();
    results.setAttribute("aria-busy", "true");
    results.textContent = "正在加载图片…";
    results.scrollTop = 0;
    this.visible.clear();
    this.setError("");
    try {
      let response: { items: readonly MemeResponse[]; page: number; total_pages: number };
      if (options.source) {
        const start = (page - 1) * this.pageSize;
        response = { items: options.source.slice(start, start + this.pageSize), page,
          total_pages: Math.ceil(options.source.length / this.pageSize) };
      } else if (this.semanticMode) {
        if (!this.query) {
          results.textContent = "输入自然语言描述，搜索相关图片。";
          this.page = 1;
          this.totalPages = 0;
          return;
        }
        const matching = await semanticSearch({ query: this.query, tags: [], template_id: null,
          page, page_size: this.pageSize, vaultId: this.vaultId, signal: request.signal });
        response = { ...matching, items: matching.items.map(item => item.meme) };
      } else {
        response = await listMemePage({ q: this.query, page, pageSize: this.pageSize,
          sort: "default", vaultId: this.vaultId, signal: request.signal });
      }
      if (request.signal.aborted || this.request !== request || !this.dialog.open) return;
      this.page = response.page;
      this.totalPages = response.total_pages;
      const existingImageIds = options.source ? undefined : options.existingImageIds;
      const otherImageIds = options.source ? undefined : options.otherImageIds;
      const groups = response.items.flatMap(meme => meme.images.map(image => this.option(
        meme, image, Boolean(options.single), existingImageIds?.has(image.id) === true, otherImageIds?.has(image.id) === true,
      )));
      results.innerHTML = groups.join("") || "<p>没有找到可选图片</p>";
    } catch (error) {
      if (request.signal.aborted || this.request !== request || !this.dialog.open) return;
      this.totalPages = 0;
      results.textContent = "";
      this.setError(publisherMessage(error));
    } finally {
      if (this.request === request && !request.signal.aborted && this.dialog.open) {
        this.loading = false;
        results.removeAttribute("aria-busy");
        this.renderPagination();
        this.renderCount();
      }
    }
  }

  private renderPagination(): void {
    this.node("[data-picker-pages]").innerHTML = paginationMarkup(this.page, this.totalPages, this.loading);
  }

  private option(meme: MemeResponse, image: MemeImageResponse, single: boolean, inCurrentPost: boolean, inOtherPosts: boolean): string {
    const item = this.selected.get(image.id) ?? {
      id: newPostId(), position: 0, meme_id: meme.id, meme_image_id: image.id, caption: "",
      meme_title: meme.title, image_url: image.image_url, thumbnail_url: image.thumbnail_url,
    };
    this.visible.set(image.id, item);
    const label = `${meme.title || "图片"}${meme.images.length > 1 ? ` · 图 ${image.position + 1}` : ""}`;
    const badge = inCurrentPost
      ? (inOtherPosts ? "本帖及其他帖文已用" : "已在本帖")
      : (inOtherPosts ? "已在其他帖文" : "");
    return `<label class="publisher-choice"${badge ? ` title="${badge}"` : ""}>
      <img src="${escapeHtml(image.thumbnail_url ?? image.image_url)}" alt="" loading="lazy">
      ${badge ? `<span class="publisher-choice-badge" role="img" aria-label="${badge}"></span>` : ""}
      <span><input type="${single ? "radio" : "checkbox"}" name="post-image" value="${image.id}" ${this.selected.has(image.id) ? "checked" : ""}>
      ${escapeHtml(label)}</span>
    </label>`;
  }

  private renderCount(): void {
    this.node("[data-picker-count]").textContent = `已选 ${this.selected.size} 张`;
    this.node<HTMLButtonElement>("[data-picker-confirm]").disabled = this.busy || this.loading || this.selected.size === 0;
  }

  private setError(message: string): void {
    const error = this.node("[data-picker-error]");
    error.hidden = !message;
    error.textContent = message;
  }

  private async submit(): Promise<void> {
    if (this.busy || this.loading || this.selected.size === 0) return;
    const options = this.options!;
    this.busy = true;
    this.setError("");
    const controls = this.dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select");
    const enabled = [...controls].filter(control => !control.disabled);
    for (const control of enabled) control.disabled = true;
    try {
      const items = [...this.selected.values()];
      if (options.source) {
        const postId = Number(this.node<HTMLSelectElement>('select[name="destination"]').value);
        await options.submit(items, postId);
      } else {
        await options.submit(items);
      }
      this.dialog.close();
    } catch (error) {
      this.setError(publisherMessage(error));
    } finally {
      this.busy = false;
      for (const control of enabled) control.disabled = false;
      this.renderCount();
    }
  }

  destroy(): void {
    this.request?.abort();
    this.dialog.close();
    this.dialog.remove();
  }
}
