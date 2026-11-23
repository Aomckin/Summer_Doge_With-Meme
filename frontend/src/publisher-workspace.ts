import { ApiError, listCaptions, publisherApi } from "./api";
import { clearPublisherRecovery, newPostId, postContent, postItemInput, PublisherAutosave } from "./publisher-autosave";
import { publisherMessage, PublisherPicker } from "./publisher-picker";
import { showToast } from "./toast";
import type {
  MemeResponse, PostDraft, PostItem, PostSummary, PublishAction, PublishAttempt,
  PublisherInfo, PublisherLogin, PublishRequest, VaultSummary,
} from "./types";
import { escapeHtml } from "./ui";
import "./styles/publisher.css";

const ACTIONS: Record<PublishAction, string> = {
  export: "导出发布包 ZIP", prepare: "本地准备", dry_run: "试运行",
  remote_draft: "创建远端草稿", publish: "发布到平台",
};
const STATUSES: Record<PublishAttempt["status"], string> = {
  queued: "排队中", running: "执行中", prepared: "已在本地准备",
  remote_draft: "已创建远端草稿", published: "平台已确认发布", failed: "失败", unknown: "结果未知",
};
const CAPABILITIES: Record<string, string> = {
  image_text: "图文", multiple_images: "多图", gif: "GIF", external_url: "返回链接",
  preview: "平台预览", ...ACTIONS,
};
const LIMIT = 500;

export class PublisherWorkspace {
  private readonly dialog = document.createElement("dialog");
  private readonly picker: PublisherPicker;
  private readonly captionDialog = document.createElement("dialog");
  private captionRequest: AbortController | null = null;
  private loginRequest: AbortController | null = null;
  private loginPoll: ReturnType<typeof setTimeout> | undefined;
  private readonly lifecycle = new AbortController();
  private read: AbortController | null = null;
  private poll: ReturnType<typeof setTimeout> | undefined;
  private autosave: PublisherAutosave | null = null;
  private posts: PostSummary[] = [];
  private plugins: PublisherInfo[] = [];
  private attempts: PublishAttempt[] = [];
  private pending: PublishRequest | null = null;
  private busy = false;
  private loadingHistory = false;
  private moreHistory = false;
  private dragId: string | null = null;

  constructor(vaults: () => VaultSummary[], currentVault: () => number | undefined) {
    this.picker = new PublisherPicker(vaults, currentVault);
    this.dialog.className = "settings-dialog publisher-workspace";
    this.dialog.setAttribute("aria-label", "帖文工作台");
    this.dialog.innerHTML = `<div class="publisher-shell">
      <header class="publisher-bar publisher-heading"><h2 data-workspace-title>帖文工作台</h2>
        <button type="button" class="icon-button" aria-label="关闭" data-publisher-action="close">×</button>
      </header>
      <p class="form-error" data-publisher-error role="alert" hidden></p>
      <div class="publisher-layout" data-workspace-editor>
        <aside class="publisher-sidebar" aria-label="帖文列表">
          <button type="button" class="button button-primary" data-publisher-action="new">新建帖文</button>
          <div class="publisher-posts" data-posts></div>
        </aside>
        <div class="publisher-workspace-body">
          <p data-no-post>选择或新建一篇帖文。</p>
          <section data-publisher-editor aria-label="帖文编辑器" hidden>
            <div class="publisher-bar">
              <strong data-item-count></strong>
              <span data-save-status role="status"></span>
              <button type="button" class="button button-ghost" data-publisher-action="save">立即保存</button>
              <button type="button" class="button button-ghost" data-publisher-action="move-to-top">移到顶端</button>
              <button type="button" class="button button-ghost" data-publisher-action="copy">复制帖文</button>
              <button type="button" class="button button-danger" data-publisher-action="delete">删除</button>
            </div>
            <div class="publisher-bar" data-recovery hidden>
              <button type="button" class="button button-secondary" data-publisher-action="reload">读取服务器版本</button>
              <button type="button" class="button button-secondary" data-publisher-action="recover-copy">另存为新帖文</button>
            </div>
            <label>标题 <input name="title" maxlength="255"></label>
            <label>开头 <textarea name="intro_text" rows="3" maxlength="50000"></textarea></label>
            <div class="publisher-bar">
              <button type="button" class="button button-secondary" data-publisher-action="pick">从图库选图</button>
              <button type="button" class="button button-secondary" data-publisher-action="preview" aria-pressed="false">图文预览</button>
            </div>
            <ol class="publisher-items" data-post-items></ol>
            <label>结尾 <textarea name="outro_text" rows="3" maxlength="50000"></textarea></label>
            <section class="publisher-preview" aria-label="通用图文预览" data-post-preview hidden></section>
            <section class="publisher-delivery" aria-label="发布与历史">
              <h3>发布与历史</h3>
              <div class="publisher-bar">
                <label>目标 <select name="target"></select></label>
                <label data-action-field>操作 <select name="action"></select></label>
                <button type="button" class="button button-primary" data-publisher-action="run">执行</button>
              </div>
              <p data-publish-note role="status"></p>
              <div class="publisher-bar"><button type="button" class="button button-ghost" data-publisher-action="refresh-history">刷新记录</button></div>
              <ol class="publisher-history" data-publisher-history></ol>
              <button type="button" class="button button-ghost" data-publisher-action="more-history" hidden>更多记录</button>
            </section>
          </section>
        </div>
      </div>
      <section class="publisher-management" data-workspace-plugins hidden></section>
    </div>`;
    this.captionDialog.className = "settings-dialog publisher-picker publisher-caption-picker";
    this.captionDialog.setAttribute("aria-labelledby", "publisher-caption-title");
    this.captionDialog.innerHTML = `<div class="publisher-shell">
      <header class="publisher-bar publisher-heading">
        <h2 id="publisher-caption-title">选用已保存文案</h2>
        <button type="button" class="icon-button" data-saved-caption-close aria-label="关闭文案选择">×</button>
      </header>
      <p data-saved-caption-source hidden></p>
      <div class="publisher-saved-captions" data-saved-caption-results aria-live="polite"></div>
    </div>`;
    document.body.append(this.dialog, this.captionDialog);
    this.captionDialog.querySelector("[data-saved-caption-close]")!.addEventListener("click", () => this.closeCaptionPicker());
    this.captionDialog.addEventListener("close", () => {
      if (!this.captionDialog.open) this.captionRequest?.abort();
    });
    this.bind();
  }

  private node<T extends HTMLElement>(selector: string): T {
    return this.dialog.querySelector<T>(selector)!;
  }

  private button(action: string): HTMLButtonElement {
    return this.node(`button[data-publisher-action="${action}"]`);
  }

  private bind(): void {
    this.dialog.addEventListener("cancel", event => {
      event.preventDefault();
      void this.close();
    });
    this.dialog.addEventListener("click", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("button[data-publisher-action]");
      if (button && !this.busy) void this.handleAction(button);
    });
    this.dialog.addEventListener("input", event => {
      const input = event.target as HTMLInputElement | HTMLTextAreaElement;
      const current = this.autosave;
      if (!current) return;
      if (input.name === "title" || input.name === "intro_text" || input.name === "outro_text") {
        current.draft[input.name] = input.value;
      } else if (input.name === "caption") {
        const item = current.draft.items.find(candidate => candidate.id === input.closest<HTMLElement>("[data-post-item]")?.dataset.postItem);
        if (!item) return;
        item.caption = input.value;
      } else return;
      current.changed();
      this.updatePreviewText(input);
    });
    this.dialog.addEventListener("change", event => {
      if ((event.target as HTMLSelectElement).name === "target") this.renderActions();
    });
    this.dialog.addEventListener("dragstart", event => {
      const target = event.target as Element;
      if (this.busy || !target.closest("[data-drag-handle]")) return;
      this.dragId = target.closest<HTMLElement>("[data-post-item]")?.dataset.postItem ?? null;
      if (this.dragId && event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", this.dragId);
      }
    });
    this.dialog.addEventListener("dragover", event => {
      if (this.dragId && (event.target as Element).closest("[data-post-item]")) event.preventDefault();
    });
    this.dialog.addEventListener("drop", event => {
      if (this.busy || !this.dragId) return;
      event.preventDefault();
      const id = (event.target as Element).closest<HTMLElement>("[data-post-item]")?.dataset.postItem;
      const index = this.autosave?.draft.items.findIndex(item => item.id === id) ?? -1;
      this.move(this.dragId, index);
      this.dragId = null;
    });
    this.dialog.addEventListener("dragend", () => { this.dragId = null; });
  }

  async open(management = false): Promise<void> {
    if (this.dialog.open || this.busy) return;
    this.dialog.showModal();
    this.node("[data-workspace-title]").textContent = management ? "Publisher 管理" : "帖文工作台";
    this.node("[data-workspace-plugins]").hidden = !management;
    this.node("[data-workspace-editor]").hidden = management;
    this.setError("");
    if (management) {
      this.node("[data-workspace-plugins]").textContent = "正在读取已注册的 Publisher…";
      await this.operation(async () => {
        this.plugins = await publisherApi.plugins(this.lifecycle.signal);
        this.renderManagement();
      });
    } else {
      const posts = this.node("[data-posts]");
      posts.textContent = "正在加载帖文…";
      await this.operation(async () => {
        this.posts = await publisherApi.list(this.lifecycle.signal);
        this.renderPosts();
        if (this.posts.length) await this.openDraft(this.posts[0].id);
      });
    }
  }

  async addFromGallery(source: readonly MemeResponse[]): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const drafts = await publisherApi.list(this.lifecycle.signal);
      if (this.lifecycle.signal.aborted) return;
      if (!drafts.length) {
        showToast("还没有帖文，请先在帖文工作台新建。", "info");
        return;
      }
      this.picker.open({
        source, drafts,
        submit: async (items, postId) => {
          const saved = await publisherApi.append(postId, items.map(postItemInput));
          if (!this.lifecycle.signal.aborted) showToast(`已将 ${items.length} 张图片加入「${saved.title || "未命名帖文"}」`, "success");
        },
      });
    } finally {
      this.busy = false;
    }
  }

  private async operation(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setError("");
    this.dialog.setAttribute("aria-busy", "true");
    this.syncButtons();
    try {
      await action();
    } catch (error) {
      if (!this.lifecycle.signal.aborted) this.setError(publisherMessage(error));
    } finally {
      this.busy = false;
      this.dialog.removeAttribute("aria-busy");
      this.syncButtons();
    }
  }

  private async handleAction(button: HTMLButtonElement): Promise<void> {
    const action = button.dataset.publisherAction;
    if (action === "close") return this.close();
    if (action === "xiaoheihe-login") return this.startXiaoheiheLogin(button);
    if (action === "save") { await this.autosave?.flush(); return; }
    if (action === "open") {
      await this.operation(async () => {
        if (await this.finishEditing()) await this.openDraft(Number(button.dataset.id));
      });
      return;
    }
    if (action === "new") {
      await this.operation(async () => {
        if (await this.finishEditing()) this.loadDraft(await publisherApi.create({ title: "", intro_text: "", outro_text: "", items: [] }));
      });
      return;
    }
    const current = this.autosave;
    if (!current) return;
    const draft = current.draft;
    const row = button.closest<HTMLElement>("[data-post-item]");
    const itemId = row?.dataset.postItem;
    if (action === "pick" || action === "replace") {
      await this.operation(() => this.pick(itemId));
    } else if (action === "choose-caption" && row) {
      const item = draft.items.find(candidate => candidate.id === itemId);
      if (item) await this.pickCaption(item, row.querySelector<HTMLTextAreaElement>("textarea")!);
    } else if (action === "remove-item" && itemId) {
      draft.items = draft.items.filter(item => item.id !== itemId);
      this.itemsChanged();
    } else if ((action === "up" || action === "down") && itemId) {
      this.move(itemId, draft.items.findIndex(item => item.id === itemId) + (action === "up" ? -1 : 1));
      const row = [...this.dialog.querySelectorAll<HTMLElement>("[data-post-item]")].find(element => element.dataset.postItem === itemId);
      (row?.querySelector<HTMLButtonElement>(`button[data-publisher-action="${action}"]:not(:disabled)`) ?? row?.querySelector("textarea"))?.focus();
    } else if (action === "preview") {
      const preview = this.node("[data-post-preview]");
      preview.hidden = !preview.hidden;
      button.setAttribute("aria-pressed", String(!preview.hidden));
      this.renderPreview();
      if (!preview.hidden) preview.scrollIntoView?.({ block: "nearest" });
    } else if (action === "reload" && window.confirm("读取服务器版本并放弃当前恢复记录？")) {
      await this.operation(async () => {
        const latest = await publisherApi.get(draft.id, this.lifecycle.signal);
        current.discardRecovery();
        this.loadDraft(latest);
      });
    } else if (action === "recover-copy") {
      await this.operation(async () => {
        const copy = await publisherApi.create(postContent(draft));
        current.discardRecovery();
        this.loadDraft(copy);
      });
    } else if (action === "move-to-top") {
      await this.operation(async () => {
        if (!await this.finishEditing()) return;
        const post = await publisherApi.moveToTop(draft.id, this.lifecycle.signal);
        if (!this.lifecycle.signal.aborted) this.rememberPost(post, true);
      });
    } else if (action === "copy") {
      await this.operation(async () => {
        if (await this.finishEditing()) this.loadDraft(await publisherApi.copy(draft.id));
      });
    } else if (action === "delete" && window.confirm("删除这篇帖文？图库图片和发布记录会保留。")) {
      await this.operation(async () => {
        if (!await this.finishEditing()) return;
        await publisherApi.remove(draft.id, draft.revision);
        this.posts = this.posts.filter(post => post.id !== draft.id);
        this.clearEditor();
        this.renderPosts();
      });
    } else if (action === "run" || action === "retry") {
      const retry = action === "retry" ? this.attempts.find(attempt => attempt.id === button.dataset.id) : undefined;
      await this.operation(async () => this.run(retry));
    } else if (action === "refresh-history" || action === "more-history") {
      await this.refreshHistory(action === "more-history");
    }
  }

  private async openDraft(id: number): Promise<void> {
    this.loadDraft(await publisherApi.get(id, this.lifecycle.signal));
  }

  private loadDraft(draft: PostDraft): void {
    if (this.lifecycle.signal.aborted) return;
    this.clearEditor();
    const request = new AbortController();
    this.read = request;
    this.node("[data-no-post]").hidden = true;
    this.node("[data-publisher-editor]").hidden = false;
    this.node("[data-publisher-history]").textContent = "正在加载记录…";
    this.node("[data-publish-note]").textContent = "";
    this.node("[data-save-status]").textContent = "已保存";
    this.node("[data-recovery]").hidden = true;
    this.node("[data-post-preview]").hidden = true;
    this.button("preview").setAttribute("aria-pressed", "false");
    this.autosave = new PublisherAutosave(draft, publisherApi.update, status => {
      this.node("[data-save-status]").textContent = status.text;
      this.node("[data-save-status]").classList.toggle("form-error", Boolean(status.error));
      this.node("[data-recovery]").hidden = !status.conflict;
      this.syncButtons();
    }, (saved, current) => {
      this.rememberPost(saved);
      if (current && this.autosave) {
        const items = this.autosave.draft.items;
        const changedMedia = saved.items.some((item, index) =>
          item.image_url !== items[index].image_url || item.thumbnail_url !== items[index].thumbnail_url
          || item.meme_title !== items[index].meme_title);
        this.autosave.draft.items = saved.items;
        if (changedMedia) {
          this.updateItemMedia();
          this.renderPreview();
        }
      }
    });
    this.autosave.restore();
    const shown = this.autosave.draft;
    for (const field of ["title", "intro_text", "outro_text"] as const) {
      this.node<HTMLInputElement | HTMLTextAreaElement>(`[name="${field}"]`).value = shown[field];
    }
    this.rememberPost(draft);
    this.renderItems();
    this.plugins = [];
    this.renderTargets();
    void publisherApi.plugins(request.signal).then(plugins => {
      if (request.signal.aborted) return;
      this.plugins = plugins;
      this.renderTargets();
    }).catch(error => {
      if (!request.signal.aborted) this.setError(publisherMessage(error));
    });
    void this.refreshHistory();
  }

  private rememberPost(post: PostSummary, moveToTop = false): void {
    const index = this.posts.findIndex(candidate => candidate.id === post.id);
    if (moveToTop || index === -1) {
      if (index !== -1) this.posts.splice(index, 1);
      this.posts.unshift(post);
    } else {
      this.posts[index] = post;
    }
    this.renderPosts();
  }

  private renderPosts(): void {
    this.node("[data-posts]").innerHTML = this.posts.map(post => `<button type="button" data-publisher-action="open"
      data-id="${post.id}" ${post.id === this.autosave?.draft.id ? 'aria-current="true"' : ""}>
      <strong>${escapeHtml(post.title || "未命名帖文")}</strong>
      <span>${escapeHtml(new Date(post.updated_at).toLocaleString())}</span></button>`).join("")
      || "<p>暂无帖文</p>";
  }

  private image(item: PostItem, original = false): string {
    const src = original ? item.image_url : item.thumbnail_url ?? item.image_url;
    return src
      ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.meme_title || "帖文图片")}" loading="lazy">`
      : '<div class="publisher-missing" role="status">图片缺失，请替换或移除</div>';
  }

  private renderItems(): void {
    const draft = this.autosave!.draft;
    this.node("[data-item-count]").textContent = `${draft.items.length} 张图片`;
    this.node("[data-post-items]").innerHTML = draft.items.map((item, index) => `<li data-post-item="${item.id}">
      <div class="publisher-thumb" data-item-media>${this.image(item)}</div>
      <div class="publisher-item-fields">
        <label>第 ${index + 1} 张图的文案
          <textarea name="caption" rows="3" maxlength="12000"></textarea>
        </label>
        <div class="publisher-bar">
          <button type="button" class="button button-secondary" data-publisher-action="choose-caption"
            aria-label="为第 ${index + 1} 张图选用已保存文案">选用已保存文案</button>
          <span draggable="true" class="publisher-drag" data-drag-handle title="拖动整项排序" aria-hidden="true">⠿ 拖动</span>
          <button type="button" class="button button-ghost" data-publisher-action="up" ${index === 0 ? "disabled" : ""}>上移</button>
          <button type="button" class="button button-ghost" data-publisher-action="down" ${index === draft.items.length - 1 ? "disabled" : ""}>下移</button>
          <button type="button" class="button button-ghost" data-publisher-action="replace">替换</button>
          <button type="button" class="button button-ghost" data-publisher-action="remove-item">移除</button>
        </div>
      </div>
    </li>`).join("") || "<li class='publisher-empty'>从图库选择图片，添加逐图文案。</li>";
    this.dialog.querySelectorAll<HTMLTextAreaElement>('textarea[name="caption"]').forEach((field, index) => {
      field.value = draft.items[index].caption;
    });
    this.syncButtons();
  }

  private updateItemMedia(): void {
    const media = this.dialog.querySelectorAll("[data-item-media]");
    this.autosave!.draft.items.forEach((item, index) => { media[index].innerHTML = this.image(item); });
  }

  private itemsChanged(): void {
    this.autosave!.changed();
    this.renderItems();
    this.renderPreview();
  }

  private move(id: string, to: number): void {
    const items = this.autosave!.draft.items;
    const from = items.findIndex(item => item.id === id);
    if (from < 0 || from === to || to < 0 || to >= items.length) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    this.itemsChanged();
  }

  private async pick(replaceId?: string): Promise<void> {
    const current = this.autosave!;
    let otherImageIds: ReadonlySet<number> | undefined;
    if (!replaceId) {
      try {
        otherImageIds = new Set(await publisherApi.otherImageIds(current.draft.id, this.lifecycle.signal));
      } catch (error) {
        if (!this.lifecycle.signal.aborted) showToast(`无法读取其他帖文的图片标记。${publisherMessage(error)}`, "warning");
      }
      if (this.lifecycle.signal.aborted || this.autosave !== current || !this.dialog.open) return;
    }
    this.picker.open({
      single: Boolean(replaceId),
      existingImageIds: replaceId ? undefined : new Set(current.draft.items.map(item => item.meme_image_id)),
      otherImageIds,
      submit: items => {
        const draft = this.autosave!.draft;
        const previous = draft.items.find(item => item.id === replaceId);
        if (previous) {
          draft.items[draft.items.indexOf(previous)] = { ...items[0], caption: previous.caption };
        } else {
          if (draft.items.length + items.length > LIMIT) throw new ApiError(422, `一篇帖文最多保存 ${LIMIT} 个图片条目`);
          draft.items.push(...items);
        }
        this.itemsChanged();
      },
    });
  }

  private async pickCaption(item: PostItem, field: HTMLTextAreaElement): Promise<void> {
    if (this.captionDialog.open) return;
    this.captionRequest?.abort();
    const request = new AbortController();
    this.captionRequest = request;
    const source = this.captionDialog.querySelector<HTMLElement>("[data-saved-caption-source]")!;
    const results = this.captionDialog.querySelector<HTMLElement>("[data-saved-caption-results]")!;
    source.textContent = item.meme_title ?? "";
    source.hidden = !source.textContent;
    results.textContent = "正在读取文案…";
    this.captionDialog.showModal();
    if (item.meme_title === null && !item.image_url) {
      results.textContent = "原素材已不可用，请先替换图片。";
      return;
    }

    try {
      const captions = await listCaptions(item.meme_id, request.signal);
      if (request.signal.aborted || !this.captionDialog.open) return;
      if (!captions.length) {
        results.textContent = "这张图还没有已保存文案。";
        return;
      }

      const label = field.value ? "替换为这条" : "选用这条";
      results.innerHTML = captions.map(caption => {
        const metadata = [caption.scene, caption.tone].filter(Boolean).join(" · ");
        return `<article class="caption-card">
          <p>${escapeHtml(caption.content)}</p>
          <footer>
            ${metadata ? `<small>${escapeHtml(metadata)}</small>` : ""}
            <button type="button" class="button button-secondary">${label}</button>
          </footer>
        </article>`;
      }).join("");
      results.querySelectorAll<HTMLButtonElement>("button").forEach((button, index) => {
        button.addEventListener("click", () => {
          if (request.signal.aborted || !this.captionDialog.open || !field.isConnected) return;
          field.value = captions[index].content;
          field.dispatchEvent(new Event("input", { bubbles: true }));
          this.closeCaptionPicker();
          field.focus();
        });
      });
    } catch (error) {
      if (!request.signal.aborted && this.captionDialog.open) {
        results.textContent = publisherMessage(error);
      }
    }
  }

  private closeCaptionPicker(): void {
    this.captionRequest?.abort();
    this.captionRequest = null;
    if (this.captionDialog.open) this.captionDialog.close();
  }

  private updatePreviewText(input: HTMLInputElement | HTMLTextAreaElement): void {
    const preview = this.node("[data-post-preview]");
    if (preview.hidden) return;
    const id = input.closest<HTMLElement>("[data-post-item]")?.dataset.postItem;
    const target = input.name === "caption"
      ? preview.querySelector<HTMLElement>(`[data-preview-caption="${id}"]`)
      : preview.querySelector<HTMLElement>(`[data-preview-field="${input.name}"]`);
    if (target) {
      target.textContent = input.value;
      target.hidden = !input.value;
    }
  }

  private renderPreview(): void {
    const preview = this.node("[data-post-preview]");
    const draft = this.autosave?.draft;
    if (preview.hidden || !draft) return;
    preview.innerHTML = `<h3>通用图文预览</h3>
      <h4 data-preview-field="title" ${draft.title ? "" : "hidden"}>${escapeHtml(draft.title)}</h4>
      <p data-preview-field="intro_text" ${draft.intro_text ? "" : "hidden"}>${escapeHtml(draft.intro_text)}</p>
      ${draft.items.map(item => `<figure>${this.image(item, true)}
        <figcaption data-preview-caption="${item.id}" ${item.caption ? "" : "hidden"}>${escapeHtml(item.caption)}</figcaption></figure>`).join("")}
      <p data-preview-field="outro_text" ${draft.outro_text ? "" : "hidden"}>${escapeHtml(draft.outro_text)}</p>`;
  }

  private renderTargets(): void {
    const select = this.node<HTMLSelectElement>('[name="target"]');
    select.replaceChildren(new Option("标准发布包 ZIP", ""), ...this.plugins
      .filter(plugin => plugin.available && plugin.supported_content_types.includes("image_text")
        && (Object.keys(ACTIONS) as PublishAction[]).some(action => action !== "export" && plugin.capabilities.includes(action)))
      .map(plugin => new Option(plugin.name, plugin.plugin_id)));
    this.renderActions();
  }

  private renderActions(): void {
    const target = this.node<HTMLSelectElement>('[name="target"]').value;
    const plugin = this.plugins.find(candidate => candidate.plugin_id === target);
    const actions = (Object.entries(ACTIONS) as [PublishAction, string][]).filter(([key]) =>
      plugin ? key !== "export" && plugin.capabilities.includes(key) : key === "export");
    this.node<HTMLSelectElement>('[name="action"]').replaceChildren(...actions.map(([key, label]) => new Option(label, key)));
    this.node("[data-action-field]").hidden = !target;
  }

  private async run(retry?: PublishAttempt): Promise<void> {
    const current = this.autosave!;
    if (!await current.flush()) return;
    const draft = current.draft;
    if (retry && retry.revision !== draft.revision) {
      this.setError("该任务属于旧版本，请按当前版本发起新任务。");
      return;
    }
    const action = retry?.action ?? this.node<HTMLSelectElement>('[name="action"]').value as PublishAction;
    const pluginId = retry?.plugin_id ?? (this.node<HTMLSelectElement>('[name="target"]').value || null);
    if (!retry && (action === "publish" || action === "remote_draft") && !window.confirm(`确认${ACTIONS[action]}？`)) return;
    const body = { revision: draft.revision, action, plugin_id: action === "export" ? null : pluginId, retry_of: retry?.id ?? null };
    if (!this.pending || Object.entries(body).some(([key, value]) => this.pending![key as keyof PublishRequest] !== value)) {
      this.pending = { ...body, request_id: newPostId() };
    }
    try {
      const attempt = await publisherApi.run(draft.id, this.pending);
      this.pending = null;
      this.attempts = [attempt, ...this.attempts.filter(previous => previous.id !== attempt.id)];
      this.renderHistory();
      await this.refreshHistory();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) this.pending = null;
      throw error;
    }
  }

  private async refreshHistory(more = false): Promise<void> {
    const request = this.read;
    const post = this.autosave?.draft;
    if (!post || !request || this.loadingHistory) return;
    clearTimeout(this.poll);
    this.loadingHistory = true;
    try {
      const loaded = await publisherApi.attempts(post.id, more ? this.attempts.length : 0, request.signal);
      if (request.signal.aborted) return;
      const ordered = more ? [...this.attempts, ...loaded] : [...loaded, ...this.attempts];
      this.attempts = [...new Map(ordered.map(attempt => [attempt.id, attempt])).values()]
        .map(attempt => loaded.find(latest => latest.id === attempt.id) ?? attempt);
      if (more || this.attempts.length <= 30) this.moreHistory = loaded.length === 30;
      this.node("[data-publish-note]").textContent = "";
      this.renderHistory();
    } catch (error) {
      if (!request.signal.aborted) {
        this.node("[data-publish-note]").textContent = "无法刷新发布状态，请点击「刷新记录」重试。";
        if (!this.attempts.length) this.node("[data-publisher-history]").textContent = "";
      }
    } finally {
      if (!request.signal.aborted) {
        this.loadingHistory = false;
        if (this.hasActiveAttempt()) this.poll = setTimeout(() => void this.refreshHistory(), 1200);
      }
    }
  }

  private hasActiveAttempt(): boolean {
    return this.attempts.some(attempt => attempt.status === "queued" || attempt.status === "running");
  }

  private renderHistory(): void {
    const canRecheck = (attempt: PublishAttempt) => attempt.status === "unknown"
      && (attempt.error_code === "plugin_exit" || attempt.error_code === "xiaoheihe_submit_unknown")
      && attempt.plugin_id === "xiaoheihe" && attempt.action === "remote_draft"
      && attempt.external_post_id === null && attempt.external_url === null;
    this.node("[data-publisher-history]").innerHTML = this.attempts.map(attempt => {
      const name = this.plugins.find(plugin => plugin.plugin_id === attempt.plugin_id)?.name ?? attempt.plugin_id;
      const recheck = canRecheck(attempt);
      const remoteConflict = (attempt.action === "remote_draft" || attempt.action === "publish") && this.attempts.some(other =>
        other.id !== attempt.id && other.plugin_id === attempt.plugin_id
        && (other.action === "remote_draft" || other.action === "publish")
        && !(recheck && other.revision === attempt.revision && canRecheck(other))
        && (other.status === "unknown" || other.status === "published"
          || (other.status === "remote_draft" && attempt.action === "remote_draft")));
      const retryable = !remoteConflict && (attempt.status === "failed" || recheck)
        && attempt.revision === this.autosave?.draft.revision;
      return `<li>
        <div class="publisher-bar"><strong>${escapeHtml(ACTIONS[attempt.action])}${name ? ` · ${escapeHtml(name)}` : ""}</strong>
          <span class="publisher-attempt-status" data-status="${attempt.status}">${STATUSES[attempt.status]}</span></div>
        <small>版本 ${attempt.revision} · ${escapeHtml(new Date(attempt.created_at).toLocaleString())}</small>
        ${attempt.error_message ? `<p>${escapeHtml(attempt.error_message)}${attempt.error_code ? `（${escapeHtml(attempt.error_code)}）` : ""}</p>` : ""}
        ${attempt.download_url ? `<a href="${escapeHtml(attempt.download_url)}">下载 ZIP</a>` : ""}
        ${attempt.external_url ? `<a href="${escapeHtml(attempt.external_url)}" target="_blank" rel="noopener noreferrer">打开平台页面</a>` : ""}
        ${attempt.external_post_id ? `<small>平台编号 ${escapeHtml(attempt.external_post_id)}</small>` : ""}
        ${retryable ? `<button type="button" class="button button-ghost" data-publisher-action="retry" data-id="${attempt.id}">${recheck ? "核对后重试" : "重试"}</button>` : ""}
      </li>`;
    }).join("") || "<li class='publisher-empty'>暂无发布记录</li>";
    this.button("more-history").hidden = !this.moreHistory;
    this.syncButtons();
  }

  private renderManagement(): void {
    this.node("[data-workspace-plugins]").innerHTML = this.plugins.map(plugin => {
      const recent = plugin.recent_attempt;
      const limits = [
        plugin.limits.max_images ? `最多 ${plugin.limits.max_images} 图` : "",
        plugin.limits.max_image_bytes ? `单图 ${plugin.limits.max_image_bytes.toLocaleString()} 字节` : "",
        plugin.limits.max_package_bytes ? `图片合计 ${plugin.limits.max_package_bytes.toLocaleString()} 字节` : "",
      ].filter(Boolean).join(" · ");
      return `<article><div class="publisher-bar"><h3>${escapeHtml(plugin.name)}</h3>
        <span>v${escapeHtml(plugin.version)} · 协议 v${plugin.protocol_version}</span></div>
        <p>${plugin.enabled ? "已启用" : "已禁用"} · ${plugin.available ? "可用" : "不可用"}</p>
        <p>${escapeHtml(plugin.capabilities.map(capability => CAPABILITIES[capability] ?? capability).join(" · "))}</p>
        ${limits ? `<p>${escapeHtml(limits)}</p>` : ""}
        ${plugin.qr_session_saved != null ? `<div class="publisher-bar">
          <span data-xiaoheihe-session>${plugin.qr_session_saved ? "已有登录会话" : "尚未登录小黑盒"}</span>
          <button type="button" class="button button-secondary" data-publisher-action="xiaoheihe-login">
            ${plugin.qr_session_saved ? "重新扫码登录" : "扫码登录"}
          </button>
        </div>
        <div class="publisher-login" data-xiaoheihe-login hidden>
          <p role="status" data-xiaoheihe-status></p>
          <img alt="小黑盒扫码登录二维码" width="232" height="232" data-xiaoheihe-qr hidden>
        </div>` : ""}
        ${recent ? `<p>最近执行 · ${STATUSES[recent.status]} · ${escapeHtml(new Date(recent.created_at).toLocaleString())}</p>` : "<p>暂无执行记录</p>"}
      </article>`;
    }).join("") || "<p>暂无已注册的 Publisher。标准发布包仍可导出。</p>";
  }

  private async startXiaoheiheLogin(button: HTMLButtonElement): Promise<void> {
    this.loginRequest?.abort();
    clearTimeout(this.loginPoll);
    const request = new AbortController();
    this.loginRequest = request;
    const panel = this.node("[data-xiaoheihe-login]");
    const status = this.node("[data-xiaoheihe-status]");
    const qr = this.node<HTMLImageElement>("[data-xiaoheihe-qr]");
    panel.hidden = false;
    qr.hidden = true;
    qr.removeAttribute("src");
    button.disabled = true;
    status.textContent = "正在获取小黑盒登录二维码…";

    const show = (login: PublisherLogin) => {
      if (request.signal.aborted) return;
      if (login.status === "waiting") {
        if (login.qr_png) {
          const source = `data:image/png;base64,${login.qr_png}`;
          if (qr.getAttribute("src") !== source) qr.src = source;
          qr.hidden = false;
          status.textContent = "请用小黑盒 App 扫码并确认。";
        }
        this.loginPoll = setTimeout(() => {
          void publisherApi.xiaoheiheLogin(login.id, request.signal).then(show).catch(failed);
        }, 1000);
        return;
      }
      qr.hidden = true;
      qr.removeAttribute("src");
      status.textContent = login.message ?? "扫码未完成，请重试。";
      button.disabled = false;
      if (login.status === "succeeded") {
        this.node("[data-xiaoheihe-session]").textContent = "已登录小黑盒";
        button.textContent = "重新扫码登录";
      }
    };

    const failed = (error: unknown) => {
      if (request.signal.aborted) return;
      status.textContent = publisherMessage(error);
      qr.hidden = true;
      qr.removeAttribute("src");
      button.disabled = false;
    };

    await publisherApi.beginXiaoheiheLogin(request.signal).then(show).catch(failed);
  }

  private syncButtons(): void {
    const current = this.autosave;
    const active = this.hasActiveAttempt();
    this.button("run").disabled = this.busy || active || !current?.draft.items.length || Boolean(current.conflict);
    this.button("save").disabled = this.busy || !current?.dirty || Boolean(current.conflict);
    this.button("move-to-top").disabled = this.busy || !current || this.posts[0]?.id === current.draft.id;
    for (const field of this.dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-publisher-editor] input, [data-publisher-editor] textarea")) {
      field.readOnly = this.busy;
    }
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>('[data-publisher-action="retry"]')) {
      button.disabled = this.busy || active || Boolean(current?.conflict);
    }
  }

  private setError(message: string): void {
    const error = this.node("[data-publisher-error]");
    error.textContent = message;
    error.hidden = !message;
  }

  private async finishEditing(): Promise<boolean> {
    if (!this.autosave) return true;
    return this.autosave.flush();
  }

  private async close(): Promise<void> {
    if (this.busy) return;
    await this.operation(async () => {
      if (!await this.finishEditing() && !window.confirm(this.autosave?.cached
        ? "修改尚未保存。关闭后可在此标签页重新打开帖文恢复修改。仍要关闭？"
        : "修改尚未保存，关闭可能丢失修改。仍要关闭？")) return;
      this.clearEditor();
      this.dialog.close();
    });
  }

  private clearEditor(): void {
    this.closeCaptionPicker();
    this.loginRequest?.abort();
    clearTimeout(this.loginPoll);
    this.read?.abort();
    this.autosave?.destroy();
    this.autosave = null;
    clearTimeout(this.poll);
    this.loadingHistory = false;
    this.moreHistory = false;
    this.attempts = [];
    this.pending = null;
    this.node("[data-publisher-editor]").hidden = true;
    this.node("[data-no-post]").hidden = false;
  }

  destroy(): void {
    this.lifecycle.abort();
    this.clearEditor();
    this.picker.destroy();
    this.captionDialog.remove();
    this.dialog.close();
    this.dialog.remove();
    clearPublisherRecovery();
  }
}
