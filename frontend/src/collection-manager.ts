import { ApiError } from "./api";
import type {
  CollectionDetail,
  CollectionPayload,
  CollectionSummary,
  MemeCollectionsResponse,
  MemeResponse,
} from "./types";
import { escapeHtml, memeCardMarkup } from "./ui";

export interface CollectionApi {
  list(signal?: AbortSignal): Promise<CollectionSummary[]>;
  get(id: number, signal?: AbortSignal): Promise<CollectionDetail>;
  create(payload: CollectionPayload): Promise<CollectionSummary>;
  update(id: number, payload: CollectionPayload): Promise<CollectionSummary>;
  delete(id: number): Promise<void>;
  removeMeme(collectionId: number, memeId: number): Promise<void>;
  getMemberships(memeId: number, signal?: AbortSignal): Promise<MemeCollectionsResponse>;
  replaceMemberships(memeId: number, collectionIds: number[]): Promise<MemeCollectionsResponse>;
}

export interface CollectionActions {
  openDetail(meme: MemeResponse): void;
  openViewer(meme: MemeResponse): void;
  copyMeme?(meme: MemeResponse, button: HTMLButtonElement): Promise<boolean>;
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : "牌组请求失败，请稍后重试。";
}

export class CollectionManagerController {
  private readonly dialog = document.createElement("dialog");
  private readonly membershipDialog = document.createElement("dialog");
  private collections: CollectionSummary[] = [];
  private detail: CollectionDetail | null = null;
  private editingId: number | null = null;
  private busy = false;
  private error: string | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private membershipMeme: MemeResponse | null = null;
  private memberships = new Set<number>();

  constructor(
    opener: HTMLButtonElement,
    private readonly api: CollectionApi,
    private readonly actions: CollectionActions,
  ) {
    this.dialog.className = "settings-dialog collection-dialog";
    this.dialog.dataset.collectionDialog = "";
    this.membershipDialog.className = "settings-dialog membership-dialog";
    this.membershipDialog.dataset.membershipDialog = "";
    document.body.append(this.dialog, this.membershipDialog);
    opener.addEventListener("click", () => void this.open());
    this.dialog.addEventListener("click", event => this.handleManagerClick(event));
    this.dialog.addEventListener("submit", event => this.handleSubmit(event));
    this.membershipDialog.addEventListener("click", event => this.handleMembershipClick(event));
    this.membershipDialog.addEventListener("submit", event => this.handleMembershipSubmit(event));
    for (const current of [this.dialog, this.membershipDialog]) {
      current.addEventListener("close", () => this.abort());
      current.addEventListener("click", event => {
        if (event.target === current) current.close();
      });
    }
  }

  async open(): Promise<void> {
    this.detail = null;
    this.editingId = null;
    this.error = null;
    if (!this.dialog.open) this.dialog.showModal();
    await this.loadList();
  }

  async openMembership(meme: MemeResponse): Promise<void> {
    this.membershipMeme = meme;
    this.error = null;
    this.busy = true;
    if (!this.membershipDialog.open) this.membershipDialog.showModal();
    this.renderMembership();
    const generation = this.beginRequest();
    try {
      const [collections, memberships] = await Promise.all([
        this.api.list(this.request?.signal),
        this.api.getMemberships(meme.id, this.request?.signal),
      ]);
      if (generation !== this.generation || this.membershipMeme?.id !== meme.id) return;
      this.collections = collections;
      this.memberships = new Set(memberships.collection_ids);
      this.error = null;
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = message(error);
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.renderMembership();
      }
    }
  }

  private beginRequest(): number {
    this.request?.abort();
    this.request = new AbortController();
    this.generation += 1;
    return this.generation;
  }

  private abort(): void {
    this.request?.abort();
    this.request = null;
    this.generation += 1;
  }

  private async loadList(): Promise<void> {
    const generation = this.beginRequest();
    this.busy = true;
    this.renderManager();
    try {
      this.collections = await this.api.list(this.request?.signal);
      if (generation !== this.generation) return;
      this.error = null;
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = message(error);
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.renderManager();
      }
    }
  }

  private async openDetail(id: number): Promise<void> {
    const generation = this.beginRequest();
    this.busy = true;
    this.error = null;
    this.renderManager();
    try {
      this.detail = await this.api.get(id, this.request?.signal);
      if (generation !== this.generation) return;
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = message(error);
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.renderManager();
      }
    }
  }

  private renderManager(): void {
    const error = this.error ? `<p class="form-error" role="alert">${escapeHtml(this.error)}</p>` : "";
    if (this.detail) {
      const detail = this.detail;
      this.dialog.innerHTML = `<div class="settings-shell collection-shell">
        <header class="settings-header"><div><p class="eyebrow">DECK CONTENTS</p><h2>${escapeHtml(detail.name)}</h2><p>${escapeHtml(detail.description || "暂无描述")}</p></div><button class="icon-button" type="button" data-close-collections>×</button></header>
        <div class="collection-detail-toolbar"><button class="button button-ghost" type="button" data-back-collections>← 返回牌组</button><strong>${detail.meme_count} 个 Meme</strong></div>
        ${error}
        <div class="collection-grid">${detail.items.length ? detail.items.map(item => `<div class="collection-card">${memeCardMarkup(item.meme, false, "medium", undefined, false)}<div class="collection-card-actions">${item.meme.image_count === 1 ? `<button class="button button-secondary" type="button" data-collection-copy="${item.meme.id}">复制</button>` : ""}<button class="button button-secondary" type="button" data-collection-viewer="${item.meme.id}">原图</button><a class="button button-secondary" href="/api/memes/${item.meme.id}/download">下载</a><button class="button button-danger" type="button" data-remove-collection-meme="${item.meme.id}">从牌组移除</button></div></div>`).join("") : '<div class="collection-empty"><h3>这个牌组还是空的。</h3><p>从 Meme 详情页选择“加入牌组”即可添加。</p></div>'}</div>
      </div>`;
      return;
    }
    const editing = this.editingId === null ? null : this.collections.find(item => item.id === this.editingId);
    this.dialog.innerHTML = `<div class="settings-shell collection-shell">
      <header class="settings-header"><div><p class="eyebrow">DECKS</p><h2>Meme 牌组</h2><p>按自己的使用习惯整理常用 Meme，不影响标签和语义索引。</p></div><button class="icon-button" type="button" data-close-collections>×</button></header>
      ${error}
      ${this.busy ? '<p class="status-line"><span class="spinner"></span>正在加载牌组…</p>' : ""}
      <div class="collection-list">${!this.busy && !this.collections.length ? '<div class="collection-empty"><h3>还没有牌组。</h3><p>把常用 Meme 收进自己的快捷武器栏吧。</p></div>' : this.collections.map(item => `<article class="collection-row"><button type="button" data-open-collection="${item.id}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.description || "暂无描述")}</span><b>${item.meme_count}</b></button><div><button class="button button-ghost" type="button" data-edit-collection="${item.id}">编辑</button><button class="button button-danger" type="button" data-delete-collection="${item.id}">删除</button></div></article>`).join("")}</div>
      <form class="collection-form" data-collection-form><h3>${editing ? "编辑牌组" : "新建牌组"}</h3><label><span>名称</span><input name="name" maxlength="100" required value="${escapeHtml(editing?.name || "")}"></label><label><span>描述（可选）</span><textarea name="description" maxlength="500" rows="3">${escapeHtml(editing?.description || "")}</textarea></label><div class="form-actions">${editing ? '<button class="button button-ghost" type="button" data-cancel-collection-edit>取消</button>' : ""}<button class="button button-primary" type="submit" ${this.busy ? "disabled" : ""}>${editing ? "保存修改" : "+ 新建牌组"}</button></div></form>
    </div>`;
  }

  private renderMembership(): void {
    const meme = this.membershipMeme;
    const error = this.error ? `<p class="form-error" role="alert">${escapeHtml(this.error)}</p>` : "";
    this.membershipDialog.innerHTML = `<form class="settings-shell membership-shell" data-membership-form>
      <header class="settings-header"><div><p class="eyebrow">MEME COLLECTIONS</p><h2>加入牌组</h2><p>${meme ? escapeHtml(meme.title) : ""}</p></div><button class="icon-button" type="button" data-close-memberships>×</button></header>
      ${error}${this.busy ? '<p class="status-line"><span class="spinner"></span>正在加载当前归属…</p>' : ""}
      <div class="membership-list">${!this.busy && !this.collections.length ? '<p class="collection-empty">还没有牌组，请先从顶部“牌组”入口创建。</p>' : this.collections.map(item => `<label><input type="checkbox" value="${item.id}" ${this.memberships.has(item.id) ? "checked" : ""}><span><strong>${escapeHtml(item.name)}</strong><small>${item.meme_count} 个 Meme</small></span></label>`).join("")}</div>
      <div class="form-actions"><button class="button button-ghost" type="button" data-close-memberships>取消</button><button class="button button-primary" type="submit" ${this.busy ? "disabled" : ""}>保存</button></div>
    </form>`;
  }

  private handleManagerClick(event: Event): void {
    const target = event.target as Element;
    if (target.closest("[data-close-collections]")) this.dialog.close();
    else if (target.closest("[data-back-collections]")) { this.detail = null; this.error = null; this.renderManager(); }
    else if (target.closest("[data-cancel-collection-edit]")) { this.editingId = null; this.renderManager(); }
    else if (target.closest("[data-edit-collection]")) { this.editingId = Number(target.closest<HTMLElement>("[data-edit-collection]")?.dataset.editCollection); this.renderManager(); }
    else if (target.closest("[data-open-collection]")) void this.openDetail(Number(target.closest<HTMLElement>("[data-open-collection]")?.dataset.openCollection));
    else if (target.closest("[data-delete-collection]")) void this.deleteCollection(Number(target.closest<HTMLElement>("[data-delete-collection]")?.dataset.deleteCollection));
    else if (target.closest("[data-remove-collection-meme]")) void this.removeMeme(Number(target.closest<HTMLElement>("[data-remove-collection-meme]")?.dataset.removeCollectionMeme));
    else if (target.closest("[data-collection-copy]")) { const button = target.closest<HTMLButtonElement>("[data-collection-copy]"); const meme = this.detail?.items.find(item => item.meme.id === Number(button?.dataset.collectionCopy))?.meme; if (meme && button && this.actions.copyMeme) void this.actions.copyMeme(meme, button); }
    else if (target.closest("[data-collection-viewer]")) { const meme = this.detail?.items.find(item => item.meme.id === Number(target.closest<HTMLElement>("[data-collection-viewer]")?.dataset.collectionViewer))?.meme; if (meme) this.actions.openViewer(meme); }
    else if (target.closest("[data-meme-id]")) { const meme = this.detail?.items.find(item => item.meme.id === Number(target.closest<HTMLElement>("[data-meme-id]")?.dataset.memeId))?.meme; if (meme) { this.actions.openDetail(meme); this.dialog.close(); } }
  }

  private handleSubmit(event: Event): void {
    const form = (event.target as Element).closest<HTMLFormElement>("[data-collection-form]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    void this.saveCollection({ name: String(data.get("name") || ""), description: String(data.get("description") || "") || null });
  }

  private async saveCollection(payload: CollectionPayload): Promise<void> {
    this.busy = true; this.error = null; this.renderManager();
    try {
      if (this.editingId === null) await this.api.create(payload);
      else await this.api.update(this.editingId, payload);
      this.editingId = null;
      await this.loadList();
    } catch (error) { this.busy = false; this.error = message(error); this.renderManager(); }
  }

  private async deleteCollection(id: number): Promise<void> {
    const item = this.collections.find(value => value.id === id);
    if (!item || !confirm(`确定删除牌组「${item.name}」吗？\n牌组中的 Meme 不会被删除，只会删除它们与该牌组的关联。`)) return;
    this.busy = true; this.renderManager();
    try { await this.api.delete(id); this.collections = this.collections.filter(value => value.id !== id); this.error = null; }
    catch (error) { this.error = message(error); }
    finally { this.busy = false; this.renderManager(); }
  }

  private async removeMeme(memeId: number): Promise<void> {
    if (!this.detail) return;
    const collectionId = this.detail.id;
    this.busy = true; this.renderManager();
    try { await this.api.removeMeme(collectionId, memeId); await this.openDetail(collectionId); }
    catch (error) { this.busy = false; this.error = message(error); this.renderManager(); }
  }

  private handleMembershipClick(event: Event): void {
    if ((event.target as Element).closest("[data-close-memberships]")) this.membershipDialog.close();
  }

  private handleMembershipSubmit(event: Event): void {
    const form = (event.target as Element).closest<HTMLFormElement>("[data-membership-form]");
    if (!form || !this.membershipMeme) return;
    event.preventDefault();
    const ids = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map(item => Number(item.value));
    void this.saveMemberships(ids);
  }

  private async saveMemberships(ids: number[]): Promise<void> {
    const meme = this.membershipMeme;
    if (!meme) return;
    this.busy = true; this.error = null; this.renderMembership();
    try {
      const result = await this.api.replaceMemberships(meme.id, ids);
      this.memberships = new Set(result.collection_ids);
      this.membershipDialog.close();
    } catch (error) { this.busy = false; this.error = message(error); this.renderMembership(); }
  }
}
