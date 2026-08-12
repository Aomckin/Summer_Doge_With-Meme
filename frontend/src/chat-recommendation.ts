import type {
  ChatRecommendationInput,
  ChatRecommendationResponse,
  MemeResponse,
} from "./types";
import { escapeHtml } from "./ui";

const QUICK_INTENTS = ["震惊", "无语", "拒绝", "看戏", "阴阳怪气", "破防", "赞同"];

export interface ChatRecommendationApi {
  recommend(input: ChatRecommendationInput): Promise<ChatRecommendationResponse>;
}

export interface ChatRecommendationActions {
  openDetail(meme: MemeResponse): void;
  openViewer(meme: MemeResponse): void;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export class ChatRecommendationController {
  private readonly dialog: HTMLDialogElement;
  private response: ChatRecommendationResponse | null = null;
  private controller: AbortController | null = null;
  private requestGeneration = 0;
  private loading = false;
  private error: string | null = null;

  constructor(
    trigger: HTMLButtonElement,
    private readonly api: ChatRecommendationApi,
    private readonly actions: ChatRecommendationActions,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "modal scene-recommendation-dialog";
    this.dialog.dataset.sceneRecommendationDialog = "";
    this.dialog.innerHTML = `
      <form class="modal-card scene-recommendation-card-shell" data-scene-form>
        <div class="modal-heading">
          <div><p class="eyebrow">SCENE SUMMON</p><h2>场景召唤</h2></div>
          <button class="icon-button" type="button" data-close-scene aria-label="关闭场景召唤">×</button>
        </div>
        <label><span>最近在聊什么？</span>
          <textarea name="context" maxlength="4000" rows="5" placeholder="粘贴最近几句聊天……" required></textarea>
        </label>
        <label><span>你想怎么回应？（可选）</span>
          <input name="response_intent" maxlength="200" placeholder="例如：理直气壮地摆烂">
        </label>
        <div class="scene-intents" aria-label="快捷意图">
          <strong>快捷意图</strong>
          <div>${QUICK_INTENTS.map(intent => `<button class="filter-chip" type="button" data-scene-intent="${intent}">${intent}</button>`).join("")}</div>
        </div>
        <p class="scene-privacy">聊天文本会发送给当前配置的 Embedding Provider 用于语义检索，但不会保存到 Meme Vault 数据库。</p>
        <p class="form-error" data-scene-error role="alert" hidden></p>
        <section class="scene-results" data-scene-results aria-live="polite"></section>
        <div class="modal-actions scene-actions">
          <button class="button button-ghost" type="button" data-close-scene>关闭</button>
          <span data-scene-page></span>
          <button class="button button-secondary" type="button" data-scene-next hidden>再来一批</button>
          <button class="button button-primary" type="submit" data-scene-submit>召唤 Meme</button>
        </div>
      </form>`;
    document.body.append(this.dialog);
    trigger.addEventListener("click", () => this.open());
    this.bind();
  }

  open(): void {
    this.reset();
    this.dialog.showModal();
    this.required<HTMLTextAreaElement>('[name="context"]').focus();
  }

  close(): void {
    this.reset();
    if (this.dialog.open) this.dialog.close();
  }

  private bind(): void {
    this.required<HTMLFormElement>("[data-scene-form]").addEventListener("submit", event => {
      event.preventDefault();
      void this.search(1);
    });
    for (const button of this.dialog.querySelectorAll("[data-close-scene]")) {
      button.addEventListener("click", () => this.close());
    }
    this.dialog.addEventListener("cancel", event => {
      event.preventDefault();
      this.close();
    });
    this.dialog.addEventListener("click", event => {
      const target = event.target as Element;
      const intent = target.closest<HTMLButtonElement>("[data-scene-intent]");
      if (intent) {
        this.required<HTMLInputElement>('[name="response_intent"]').value = intent.dataset.sceneIntent ?? "";
        return;
      }
      if (target.closest("[data-scene-next]")) {
        void this.search((this.response?.page ?? 0) + 1);
        return;
      }
      const result = target.closest<HTMLElement>("[data-scene-meme]");
      if (!result) return;
      const meme = this.response?.items.find(item => item.meme.id === Number(result.dataset.sceneMeme))?.meme;
      if (!meme) return;
      if (target.closest("[data-scene-detail]")) {
        this.close();
        this.actions.openDetail(meme);
      } else if (target.closest("[data-scene-viewer]")) {
        this.close();
        this.actions.openViewer(meme);
      }
    });
  }

  private async search(page: number): Promise<void> {
    const context = this.required<HTMLTextAreaElement>('[name="context"]').value.trim();
    const responseIntent = this.required<HTMLInputElement>('[name="response_intent"]').value.trim();
    if (!context) {
      this.error = "请先粘贴最近几句聊天。";
      this.render();
      return;
    }
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.requestGeneration;
    this.loading = true;
    this.error = null;
    this.render();
    try {
      const response = await this.api.recommend({
        context,
        response_intent: responseIntent || null,
        page,
        signal: controller.signal,
      });
      if (this.controller !== controller || generation !== this.requestGeneration) return;
      this.response = response;
    } catch (error) {
      if (this.controller !== controller || generation !== this.requestGeneration || isAbortError(error)) return;
      this.response = null;
      this.error = error instanceof Error ? error.message : "场景召唤失败，请稍后重试。";
    } finally {
      if (this.controller === controller && generation === this.requestGeneration) {
        this.loading = false;
        this.render();
      }
    }
  }

  private reset(): void {
    this.controller?.abort();
    this.controller = null;
    this.requestGeneration += 1;
    this.loading = false;
    this.error = null;
    this.response = null;
    this.required<HTMLFormElement>("[data-scene-form]").reset();
    this.render();
  }

  private render(): void {
    const error = this.required<HTMLElement>("[data-scene-error]");
    error.hidden = !this.error;
    error.textContent = this.error ?? "";
    const submit = this.required<HTMLButtonElement>("[data-scene-submit]");
    submit.textContent = this.loading ? "召唤中…" : this.response ? "重新召唤" : "召唤 Meme";
    const results = this.required<HTMLElement>("[data-scene-results]");
    if (this.loading) {
      results.innerHTML = '<p class="muted scene-loading">正在检索最合适的 Meme…</p>';
    } else if (this.response && this.response.items.length) {
      results.innerHTML = this.response.items.map(({ meme, score }) => `
        <article class="scene-result-card" data-scene-meme="${meme.id}">
          <button class="scene-result-image" type="button" data-scene-viewer aria-label="查看 ${escapeHtml(meme.title)} 原图">
            <img src="${escapeHtml(meme.thumbnail_url ?? meme.image_url)}" alt="${escapeHtml(meme.title)}">
            ${meme.image_count > 1 ? `<span class="image-count-badge">${meme.image_count}</span>` : ""}
          </button>
          <div class="scene-result-copy">
            <strong>${escapeHtml(meme.title)}</strong>
            <span class="semantic-score">相关度 ${score.toFixed(3)}</span>
            <div class="card-tags">${meme.tags.slice(0, 5).map(tag => `<span class="tag">${escapeHtml(tag.name)}</span>`).join("") || '<span class="muted">无标签</span>'}</div>
          </div>
          <div class="scene-result-actions">
            <button class="button button-ghost" type="button" data-scene-detail>查看详情</button>
            <a class="button button-secondary" href="/api/memes/${meme.id}/download">下载</a>
          </div>
        </article>`).join("");
    } else if (this.response) {
      results.innerHTML = '<p class="muted">当前语义索引中没有可推荐的 Meme。</p>';
    } else {
      results.innerHTML = "";
    }
    const page = this.required<HTMLElement>("[data-scene-page]");
    page.textContent = this.response?.total
      ? `第 ${this.response.page} / ${this.response.total_pages} 批 · 共 ${this.response.total} 个`
      : "";
    const next = this.required<HTMLButtonElement>("[data-scene-next]");
    next.hidden = !this.response || this.response.page >= this.response.total_pages;
    next.disabled = this.loading;
  }

  private required<T extends Element = HTMLElement>(selector: string): T {
    const element = this.dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Missing scene recommendation element ${selector}`);
    return element;
  }
}
