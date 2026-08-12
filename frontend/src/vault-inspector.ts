import type {
  MemeResponse,
  SimilarityInspectionInput,
  SimilarityInspectionPair,
  SimilarityInspectionResponse,
} from "./types";
import { escapeHtml } from "./ui";

export interface VaultInspectorApi {
  inspect(input: SimilarityInspectionInput): Promise<SimilarityInspectionResponse>;
  ignore(memeAId: number, memeBId: number): Promise<unknown>;
  relate(memeId: number, relatedIds: number[]): Promise<MemeResponse[]>;
  merge(targetMemeId: number, sourceMemeId: number): Promise<MemeResponse>;
}

export interface VaultInspectorActions {
  openViewer(meme: MemeResponse): void;
  onMerge(target: MemeResponse, sourceId: number): void | Promise<void>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export class VaultInspectorController {
  private readonly dialog: HTMLDialogElement;
  private response: SimilarityInspectionResponse | null = null;
  private pairs: SimilarityInspectionPair[] = [];
  private index = 0;
  private loading = false;
  private actionBusy = false;
  private error: string | null = null;
  private notice: string | null = null;
  private controller: AbortController | null = null;
  private generation = 0;

  constructor(
    trigger: HTMLButtonElement,
    private readonly api: VaultInspectorApi,
    private readonly actions: VaultInspectorActions,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "modal vault-inspector-dialog";
    this.dialog.dataset.vaultInspectorDialog = "";
    this.dialog.innerHTML = `
      <form class="modal-card vault-inspector-shell" data-inspector-form>
        <div class="modal-heading"><div><p class="eyebrow">VAULT INSPECTOR</p><h2>宝库巡检</h2></div><button class="icon-button" type="button" data-close-inspector aria-label="关闭宝库巡检">×</button></div>
        <div class="inspector-parameters">
          <label>开始 Meme ID<input name="start_meme_id" type="number" min="1" required></label>
          <span>～</span>
          <label>结束 Meme ID<input name="end_meme_id" type="number" min="1" required></label>
          <label>每个 Meme 候选数<input name="top_k" type="number" min="1" max="20" value="5" required></label>
          <label>最低相似度<input name="similarity_threshold" type="number" min="0" max="1" step="0.01" value="0.85" required></label>
          <button class="button button-primary" type="submit" data-start-inspection>开始巡检</button>
        </div>
        <p class="muted inspector-hint">只读取已有 ready 向量，不调用 AI Provider。语义相似度不代表重复概率。</p>
        <p class="inspector-stats" data-inspector-stats></p>
        <p class="form-error" data-inspector-error role="alert" hidden></p>
        <p class="inspector-notice" data-inspector-notice hidden></p>
        <section class="inspector-pair" data-inspector-pair aria-live="polite"></section>
        <div class="modal-actions inspector-navigation">
          <button class="button button-ghost" type="button" data-close-inspector>关闭</button>
          <button class="button button-secondary" type="button" data-previous-pair>上一对</button>
          <span data-pair-position></span>
          <button class="button button-secondary" type="button" data-next-pair>下一对</button>
        </div>
      </form>`;
    document.body.append(this.dialog);
    trigger.addEventListener("click", () => this.open());
    this.bind();
  }

  open(): void {
    this.reset();
    this.dialog.showModal();
  }

  close(): void {
    this.reset();
    if (this.dialog.open) this.dialog.close();
  }

  private bind(): void {
    this.required<HTMLFormElement>("[data-inspector-form]").addEventListener("submit", event => {
      event.preventDefault();
      void this.inspect();
    });
    for (const button of this.dialog.querySelectorAll("[data-close-inspector]")) {
      button.addEventListener("click", () => this.close());
    }
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener("click", event => {
      const target = event.target as Element;
      if (target.closest("[data-previous-pair]")) this.move(-1);
      else if (target.closest("[data-next-pair]")) this.move(1);
      else if (target.closest("[data-view-inspector-meme]")) {
        const side = target.closest<HTMLElement>("[data-inspector-side]")?.dataset.inspectorSide;
        const pair = this.current();
        if (pair) this.actions.openViewer(side === "b" ? pair.meme_b : pair.meme_a);
      } else if (target.closest("[data-ignore-pair]")) void this.ignore();
      else if (target.closest("[data-relate-pair]")) void this.relate();
      else if (target.closest("[data-merge-left]")) void this.merge("left");
      else if (target.closest("[data-merge-right]")) void this.merge("right");
    });
  }

  private async inspect(): Promise<void> {
    const input: SimilarityInspectionInput = {
      start_meme_id: this.number("start_meme_id"),
      end_meme_id: this.number("end_meme_id"),
      top_k: this.number("top_k"),
      similarity_threshold: this.number("similarity_threshold"),
    };
    if (!Number.isInteger(input.start_meme_id) || !Number.isInteger(input.end_meme_id) || input.start_meme_id < 1 || input.end_meme_id < input.start_meme_id || input.end_meme_id - input.start_meme_id + 1 > 1000) {
      this.error = "请输入有效且不超过 1000 个 ID 的 Meme 范围。";
      this.render();
      return;
    }
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    this.loading = true;
    this.error = null;
    this.notice = null;
    this.render();
    try {
      const response = await this.api.inspect({ ...input, signal: controller.signal });
      if (this.controller !== controller || this.generation !== generation) return;
      this.response = response;
      this.pairs = [...response.pairs];
      this.index = 0;
    } catch (error) {
      if (this.controller !== controller || this.generation !== generation || isAbortError(error)) return;
      this.response = null;
      this.pairs = [];
      this.error = error instanceof Error ? error.message : "宝库巡检失败。";
    } finally {
      if (this.controller === controller && this.generation === generation) {
        this.loading = false;
        this.render();
      }
    }
  }

  private async ignore(): Promise<void> {
    const pair = this.current();
    if (!pair || this.actionBusy) return;
    await this.action(async () => {
      await this.api.ignore(pair.meme_a.id, pair.meme_b.id);
      this.removeCurrent();
      this.notice = "已忽略此 Pair，后续巡检不会再次展示。";
    });
  }

  private async relate(): Promise<void> {
    const pair = this.current();
    if (!pair || pair.weak_relation_exists || this.actionBusy) return;
    await this.action(async () => {
      await this.api.relate(pair.meme_a.id, [pair.meme_b.id]);
      this.removeCurrent();
      this.notice = "已建立现有弱关联。";
    });
  }

  private async merge(side: "left" | "right"): Promise<void> {
    const pair = this.current();
    if (!pair || this.actionBusy) return;
    const target = side === "left" ? pair.meme_a : pair.meme_b;
    const source = side === "left" ? pair.meme_b : pair.meme_a;
    const message = `将 Meme #${source.id} 合并至 Meme #${target.id}。\n\nMeme #${target.id} 将作为主 Meme 保留。\nMeme #${source.id} 的图片、标签、Caption 和弱关联将迁移至主 Meme。\n主 Meme 的标题、描述、来源和模板保持不变。\n\nMeme #${source.id} 将被删除，主 Meme 的 Semantic Embedding 将标记为过期。\n此操作当前不提供自动撤销。`;
    if (!window.confirm(message)) return;
    await this.action(async () => {
      const merged = await this.api.merge(target.id, source.id);
      this.pairs = this.pairs.filter(item =>
        ![item.meme_a.id, item.meme_b.id].some(id => id === target.id || id === source.id)
      );
      this.index = Math.min(this.index, Math.max(0, this.pairs.length - 1));
      this.notice = "合并完成。主 Meme 内容已变化，其向量已标记过期。";
      await this.actions.onMerge(merged, source.id);
    });
  }

  private async action(callback: () => Promise<void>): Promise<void> {
    this.actionBusy = true;
    this.error = null;
    this.render();
    try { await callback(); }
    catch (error) { this.error = error instanceof Error ? error.message : "操作失败。"; }
    finally { this.actionBusy = false; this.render(); }
  }

  private removeCurrent(): void {
    this.pairs.splice(this.index, 1);
    this.index = Math.min(this.index, Math.max(0, this.pairs.length - 1));
  }

  private move(offset: number): void {
    if (!this.pairs.length) return;
    this.index = Math.max(0, Math.min(this.pairs.length - 1, this.index + offset));
    this.render();
  }

  private current(): SimilarityInspectionPair | null {
    return this.pairs[this.index] ?? null;
  }

  private reset(): void {
    this.controller?.abort();
    this.controller = null;
    this.generation += 1;
    this.loading = false;
    this.actionBusy = false;
    this.response = null;
    this.pairs = [];
    this.index = 0;
    this.error = null;
    this.notice = null;
    this.required<HTMLFormElement>("[data-inspector-form]").reset();
    this.render();
  }

  private render(): void {
    // 允许用户在巡检进行中用新参数重新提交；旧请求会被 abort + generation 丢弃。
    this.required<HTMLButtonElement>("[data-start-inspection]").disabled = this.actionBusy;
    const error = this.required<HTMLElement>("[data-inspector-error]");
    error.hidden = !this.error; error.textContent = this.error ?? "";
    const notice = this.required<HTMLElement>("[data-inspector-notice]");
    notice.hidden = !this.notice; notice.textContent = this.notice ?? "";
    const stats = this.required<HTMLElement>("[data-inspector-stats]");
    stats.textContent = this.response
      ? `巡检 ${this.response.requested_count} 个 Meme · ${this.response.ready_count} 个拥有有效向量 · ${this.response.missing_or_stale_count} 个缺少或已过期 · 当前剩余 ${this.pairs.length} 组候选`
      : "";
    const container = this.required<HTMLElement>("[data-inspector-pair]");
    const pair = this.current();
    if (this.loading) container.innerHTML = '<p class="muted inspector-empty">正在读取本地语义索引…</p>';
    else if (!pair && this.response) container.innerHTML = '<p class="muted inspector-empty">没有待处理的候选 Pair。</p>';
    else if (!pair) container.innerHTML = "";
    else container.innerHTML = `<div class="inspector-score">语义相似度 ${pair.score.toFixed(3)}</div><div class="inspector-comparison">${this.card(pair.meme_a, "a")}${this.card(pair.meme_b, "b")}</div><div class="inspector-actions"><button class="button button-primary" type="button" data-merge-left ${this.actionBusy ? "disabled" : ""}>保留左侧并合并右侧</button><button class="button button-primary" type="button" data-merge-right ${this.actionBusy ? "disabled" : ""}>保留右侧并合并左侧</button><button class="button button-secondary" type="button" data-relate-pair ${pair.weak_relation_exists || this.actionBusy ? "disabled" : ""}>${pair.weak_relation_exists ? "已有弱关联" : "建立弱关联"}</button><button class="button button-ghost" type="button" data-ignore-pair ${this.actionBusy ? "disabled" : ""}>忽略此对</button></div>`;
    this.required<HTMLElement>("[data-pair-position]").textContent = this.pairs.length ? `${this.index + 1} / ${this.pairs.length}` : "0 / 0";
    this.required<HTMLButtonElement>("[data-previous-pair]").disabled = this.actionBusy || this.index <= 0;
    this.required<HTMLButtonElement>("[data-next-pair]").disabled = this.actionBusy || !this.pairs.length || this.index >= this.pairs.length - 1;
  }

  private card(meme: MemeResponse, side: "a" | "b"): string {
    const images = meme.images.length ? meme.images : [{ image_url: meme.image_url }];
    return `<article class="inspector-meme" data-inspector-side="${side}"><button class="inspector-image-group" type="button" data-view-inspector-meme>${images.map(image => `<img src="${escapeHtml(image.image_url)}" alt="${escapeHtml(meme.title)}">`).join("")}</button><strong>#${meme.id} · ${escapeHtml(meme.title)}</strong><span>模板：${escapeHtml(meme.template?.name ?? "未归类")}</span><div class="card-tags">${meme.tags.map(tag => `<span class="tag">${escapeHtml(tag.name)}</span>`).join("") || '<span class="muted">无标签</span>'}</div></article>`;
  }

  private number(name: string): number {
    return Number(this.required<HTMLInputElement>(`[name="${name}"]`).value);
  }

  private required<T extends Element = HTMLElement>(selector: string): T {
    const element = this.dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Missing vault inspector element ${selector}`);
    return element;
  }
}
