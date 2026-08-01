import type {
  CaptionCandidatesResponse,
  CaptionCreatePayload,
  CaptionGeneratePayload,
  CaptionLength,
  CaptionResponse,
  CaptionRewriteAction,
  CaptionRewritePayload,
  CaptionUpdatePayload,
} from "./types";
import { escapeHtml } from "./ui";

export interface CaptionLabApi {
  listCaptions(
    memeId: number,
    signal?: AbortSignal,
  ): Promise<CaptionResponse[]>;
  createCaption(
    memeId: number,
    payload: CaptionCreatePayload,
  ): Promise<CaptionResponse>;
  updateCaption(
    memeId: number,
    captionId: number,
    payload: CaptionUpdatePayload,
  ): Promise<CaptionResponse>;
  deleteCaption(memeId: number, captionId: number): Promise<void>;
  generateCaptions(
    memeId: number,
    payload: CaptionGeneratePayload,
  ): Promise<CaptionCandidatesResponse>;
  rewriteCaption(
    memeId: number,
    payload: CaptionRewritePayload,
  ): Promise<CaptionCandidatesResponse>;
}

interface Draft {
  content: string;
  scene: string;
  tone: string;
  length: CaptionLength | "";
}

interface CaptionLabOptions {
  confirm?: (message: string) => boolean;
  copy?: (value: string) => Promise<void>;
}

const EMPTY_DRAFT: Draft = {
  content: "",
  scene: "",
  tone: "",
  length: "",
};
const CARD_LIMIT = 3;

function cloneDraft(draft: Draft): Draft {
  return { ...draft };
}

function captionDraft(caption: CaptionResponse): Draft {
  return {
    content: caption.content,
    scene: caption.scene ?? "",
    tone: caption.tone ?? "",
    length: caption.length ?? "",
  };
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "请求失败，请稍后重试。";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export class CaptionLabController {
  private memeId: number | null = null;
  private captions: CaptionResponse[] = [];
  private candidates: string[] = [];
  private draft = cloneDraft(EMPTY_DRAFT);
  private initialDraft = cloneDraft(EMPTY_DRAFT);
  private editingId: number | null = null;
  private loading = false;
  private busy: "save" | "generate" | "rewrite" | "delete" | null = null;
  private error: string | null = null;
  private showAll = false;
  private epoch = 0;
  private requestController: AbortController | null = null;
  private readonly confirmDiscard: (message: string) => boolean;
  private readonly copyText: (value: string) => Promise<void>;

  constructor(
    private readonly panel: HTMLElement,
    private readonly api: CaptionLabApi,
    options: CaptionLabOptions = {},
  ) {
    this.confirmDiscard = options.confirm ?? window.confirm.bind(window);
    this.copyText =
      options.copy ??
      ((value) => {
        if (!navigator.clipboard) {
          return Promise.reject(new Error("当前浏览器不支持剪贴板"));
        }
        return navigator.clipboard.writeText(value);
      });
    this.panel.addEventListener("click", (event) => {
      void this.handleClick(event);
    });
    this.panel.addEventListener("input", (event) => this.handleField(event));
    this.panel.addEventListener("change", (event) => this.handleField(event));
    this.panel.addEventListener(
      "toggle",
      (event) => this.handleToggle(event),
      true,
    );
    this.panel.addEventListener("meme-detail-rendered", () => this.mount());
    window.addEventListener("beforeunload", (event) => {
      if (!this.hasUnsavedDraft()) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  setMeme(memeId: number | null): boolean {
    if (this.memeId === memeId) {
      this.mount();
      return true;
    }
    if (
      this.hasUnsavedDraft() &&
      !this.confirmDiscard("当前文案草稿尚未保存，确定放弃吗？")
    ) {
      return false;
    }
    this.epoch += 1;
    this.requestController?.abort();
    this.requestController = null;
    this.memeId = memeId;
    this.captions = [];
    this.candidates = [];
    this.draft = cloneDraft(EMPTY_DRAFT);
    this.initialDraft = cloneDraft(EMPTY_DRAFT);
    this.editingId = null;
    this.loading = memeId !== null;
    this.busy = null;
    this.error = null;
    this.showAll = false;
    this.mount();
    if (memeId !== null) void this.load(memeId, this.epoch);
    return true;
  }

  clear(): void {
    this.epoch += 1;
    this.requestController?.abort();
    this.requestController = null;
    this.memeId = null;
    this.captions = [];
    this.candidates = [];
    this.draft = cloneDraft(EMPTY_DRAFT);
    this.initialDraft = cloneDraft(EMPTY_DRAFT);
    this.editingId = null;
    this.busy = null;
    this.error = null;
    this.mount();
  }

  mount(): void {
    const host = this.panel.querySelector<HTMLElement>(
      "[data-caption-lab-host]",
    );
    if (!host || this.memeId === null) return;
    this.render(host);
  }

  private async load(memeId: number, epoch: number): Promise<void> {
    const controller = new AbortController();
    this.requestController = controller;
    try {
      const captions = await this.api.listCaptions(
        memeId,
        controller.signal,
      );
      if (this.memeId !== memeId || this.epoch !== epoch) return;
      this.captions = captions;
      this.error = null;
    } catch (error) {
      if (
        controller.signal.aborted ||
        this.memeId !== memeId ||
        this.epoch !== epoch
      ) {
        return;
      }
      this.error = errorText(error);
    } finally {
      if (this.memeId === memeId && this.epoch === epoch) {
        this.loading = false;
        this.mount();
      }
    }
  }

  private hasUnsavedDraft(): boolean {
    return (
      this.draft.content.trim().length > 0 &&
      JSON.stringify(this.draft) !== JSON.stringify(this.initialDraft)
    );
  }

  private resetDraft(): void {
    this.draft = cloneDraft(EMPTY_DRAFT);
    this.initialDraft = cloneDraft(EMPTY_DRAFT);
    this.editingId = null;
    this.error = null;
    this.mount();
  }

  private metadata() {
    return {
      scene: this.draft.scene.trim() || null,
      tone: this.draft.tone.trim() || null,
      length: this.draft.length || null,
    };
  }

  private handleField(event: Event): void {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement) &&
      !(target instanceof HTMLSelectElement)
    ) {
      return;
    }
    if (target.matches("[data-caption-content]")) {
      this.draft.content = target.value;
    } else if (target.matches("[data-caption-scene]")) {
      this.draft.scene = target.value;
    } else if (target.matches("[data-caption-tone]")) {
      this.draft.tone = target.value;
    } else if (target.matches("[data-caption-length]")) {
      this.draft.length = target.value as CaptionLength | "";
    }
  }

  private handleToggle(event: Event): void {
    const details = event.target;
    if (
      !(details instanceof HTMLDetailsElement) ||
      !details.matches("[data-caption-lab]") ||
      details.open ||
      !this.hasUnsavedDraft()
    ) {
      return;
    }
    if (!this.confirmDiscard("文案草稿尚未保存，确定折叠并放弃吗？")) {
      details.open = true;
      return;
    }
    this.resetDraft();
  }

  private async handleClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof Element) || this.memeId === null) return;

    if (target.closest("[data-new-caption]")) {
      if (
        !this.hasUnsavedDraft() ||
        this.confirmDiscard("当前文案草稿尚未保存，确定放弃吗？")
      ) {
        this.resetDraft();
      }
      return;
    }
    if (target.closest("[data-discard-draft]")) {
      if (
        !this.hasUnsavedDraft() ||
        this.confirmDiscard("确定放弃当前修改吗？")
      ) {
        this.resetDraft();
      }
      return;
    }
    if (target.closest("[data-save-draft]")) {
      await this.saveDraft();
      return;
    }
    const edit = target.closest<HTMLElement>("[data-edit-caption]");
    if (edit) {
      if (
        this.hasUnsavedDraft() &&
        !this.confirmDiscard("当前文案草稿尚未保存，确定放弃吗？")
      ) {
        return;
      }
      const caption = this.caption(Number(edit.dataset.editCaption));
      if (caption) {
        this.editingId = caption.id;
        this.draft = captionDraft(caption);
        this.initialDraft = cloneDraft(this.draft);
        this.error = null;
        this.mount();
      }
      return;
    }
    const remove = target.closest<HTMLElement>("[data-delete-caption]");
    if (remove) {
      await this.removeCaption(Number(remove.dataset.deleteCaption));
      return;
    }
    const copy = target.closest<HTMLElement>("[data-copy-caption]");
    if (copy) {
      const value = copy.dataset.copyCaption ?? "";
      try {
        await this.copyText(value);
      } catch (error) {
        this.error = errorText(error);
        this.mount();
      }
      return;
    }
    if (target.closest("[data-generate-captions]")) {
      await this.generate();
      return;
    }
    const rewrite = target.closest<HTMLElement>("[data-rewrite]");
    if (rewrite) {
      await this.rewrite(
        rewrite.dataset.rewrite as CaptionRewriteAction,
      );
      return;
    }
    const use = target.closest<HTMLElement>("[data-use-candidate]");
    if (use) {
      const candidate = this.candidates[Number(use.dataset.useCandidate)];
      if (candidate !== undefined) {
        this.draft.content = candidate;
        this.mount();
      }
      return;
    }
    const save = target.closest<HTMLElement>("[data-save-candidate]");
    if (save) {
      await this.saveCandidate(Number(save.dataset.saveCandidate));
      return;
    }
    if (target.closest("[data-toggle-caption-list]")) {
      this.showAll = !this.showAll;
      this.mount();
    }
  }

  private async saveDraft(): Promise<void> {
    if (this.busy || this.memeId === null) return;
    const content = this.draft.content.trim();
    if (!content) {
      this.error = "请先填写文案正文。";
      this.mount();
      return;
    }
    const memeId = this.memeId;
    const editingId = this.editingId;
    this.busy = "save";
    this.error = null;
    this.mount();
    try {
      const payload = { content, ...this.metadata() };
      const saved =
        editingId === null
          ? await this.api.createCaption(memeId, {
              ...payload,
              source: "manual",
            })
          : await this.api.updateCaption(memeId, editingId, payload);
      if (this.memeId !== memeId) return;
      this.captions = [
        saved,
        ...this.captions.filter((item) => item.id !== saved.id),
      ];
      this.resetDraft();
    } catch (error) {
      if (this.memeId === memeId) this.error = errorText(error);
    } finally {
      if (this.memeId === memeId) {
        this.busy = null;
        this.mount();
      }
    }
  }

  private async saveCandidate(index: number): Promise<void> {
    if (this.busy || this.memeId === null) return;
    const content = this.candidates[index];
    if (content === undefined) return;
    const memeId = this.memeId;
    this.busy = "save";
    this.error = null;
    this.mount();
    try {
      const saved = await this.api.createCaption(memeId, {
        content,
        ...this.metadata(),
        source: "ai",
      });
      if (this.memeId !== memeId) return;
      this.captions = [
        saved,
        ...this.captions.filter((item) => item.id !== saved.id),
      ];
    } catch (error) {
      if (this.memeId === memeId) this.error = errorText(error);
    } finally {
      if (this.memeId === memeId) {
        this.busy = null;
        this.mount();
      }
    }
  }

  private async removeCaption(captionId: number): Promise<void> {
    if (
      this.busy ||
      this.memeId === null ||
      !this.confirmDiscard("确定删除这条文案吗？此操作无法撤销。")
    ) {
      return;
    }
    const memeId = this.memeId;
    this.busy = "delete";
    this.error = null;
    this.mount();
    try {
      await this.api.deleteCaption(memeId, captionId);
      if (this.memeId !== memeId) return;
      this.captions = this.captions.filter((item) => item.id !== captionId);
      if (this.editingId === captionId) this.resetDraft();
    } catch (error) {
      if (this.memeId === memeId) this.error = errorText(error);
    } finally {
      if (this.memeId === memeId) {
        this.busy = null;
        this.mount();
      }
    }
  }

  private async generate(): Promise<void> {
    if (this.busy || this.memeId === null) return;
    const countField = this.panel.querySelector<HTMLSelectElement>(
      "[data-caption-count]",
    );
    const count = Number(countField?.value ?? 5) as 3 | 5 | 8;
    const memeId = this.memeId;
    const epoch = this.epoch;
    this.busy = "generate";
    this.error = null;
    this.mount();
    try {
      const result = await this.api.generateCaptions(memeId, {
        count,
        ...this.metadata(),
      });
      if (this.memeId !== memeId || this.epoch !== epoch) return;
      this.candidates = result.captions;
    } catch (error) {
      if (this.memeId === memeId && this.epoch === epoch) {
        this.error = errorText(error);
      }
    } finally {
      if (this.memeId === memeId && this.epoch === epoch) {
        this.busy = null;
        this.mount();
      }
    }
  }

  private async rewrite(action: CaptionRewriteAction): Promise<void> {
    if (this.busy || this.memeId === null) return;
    const content = this.draft.content.trim();
    if (!content) {
      this.error = "请先填写需要改写的草稿。";
      this.mount();
      return;
    }
    const memeId = this.memeId;
    const epoch = this.epoch;
    this.busy = "rewrite";
    this.error = null;
    this.mount();
    try {
      const result = await this.api.rewriteCaption(memeId, {
        content,
        action,
        ...this.metadata(),
      });
      if (this.memeId !== memeId || this.epoch !== epoch) return;
      this.candidates = result.captions;
    } catch (error) {
      if (this.memeId === memeId && this.epoch === epoch) {
        this.error = errorText(error);
      }
    } finally {
      if (this.memeId === memeId && this.epoch === epoch) {
        this.busy = null;
        this.mount();
      }
    }
  }

  private caption(id: number): CaptionResponse | undefined {
    return this.captions.find((item) => item.id === id);
  }

  private render(host: HTMLElement): void {
    const visible = this.showAll
      ? this.captions
      : this.captions.slice(0, CARD_LIMIT);
    const disabled = this.busy ? "disabled" : "";
    host.innerHTML = `
      <details class="caption-lab" data-caption-lab>
        <summary>
          <span><strong>文案实验室</strong><small>${this.captions.length} 条已保存</small></span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div class="caption-lab-body">
          ${this.loading ? '<p class="caption-status">正在加载文案…</p>' : ""}
          ${this.error ? `<p class="form-error" data-caption-error role="alert">${escapeHtml(this.error)}</p>` : ""}
          <div class="caption-editor">
            <div class="caption-editor-heading">
              <div>
                <p class="eyebrow">${this.editingId === null ? "NEW CAPTION" : `EDIT CAPTION #${this.editingId}`}</p>
                <h3>${this.editingId === null ? "写一条新文案" : "修改已保存文案"}</h3>
              </div>
              <button class="button button-ghost" type="button" data-new-caption ${disabled}>新建文案</button>
            </div>
            <label>
              <span>文案正文</span>
              <textarea data-caption-content rows="4" maxlength="2000" placeholder="输入准备搭配这张 Meme 的文案…">${escapeHtml(this.draft.content)}</textarea>
            </label>
            <div class="caption-fields">
              <label><span>场景</span><input data-caption-scene list="caption-scene-presets" maxlength="100" value="${escapeHtml(this.draft.scene)}" placeholder="群聊 / 工作 / 自定义"></label>
              <label><span>语气</span><input data-caption-tone list="caption-tone-presets" maxlength="100" value="${escapeHtml(this.draft.tone)}" placeholder="吐槽 / 冷幽默 / 自定义"></label>
              <label><span>长度</span>
                <select data-caption-length>
                  <option value="" ${this.draft.length === "" ? "selected" : ""}>不限</option>
                  <option value="short" ${this.draft.length === "short" ? "selected" : ""}>短</option>
                  <option value="medium" ${this.draft.length === "medium" ? "selected" : ""}>中</option>
                  <option value="long" ${this.draft.length === "long" ? "selected" : ""}>长</option>
                </select>
              </label>
            </div>
            <datalist id="caption-scene-presets"><option value="群聊"><option value="工作"><option value="社交媒体"><option value="游戏"></datalist>
            <datalist id="caption-tone-presets"><option value="吐槽"><option value="冷幽默"><option value="夸张"><option value="阴阳怪气"></datalist>
            <div class="caption-actions">
              <button class="button button-primary" type="button" data-save-draft ${disabled}>${this.busy === "save" ? "正在保存…" : this.editingId === null ? "保存文案" : "保存修改"}</button>
              <button class="button button-ghost" type="button" data-discard-draft ${disabled}>放弃修改</button>
            </div>
          </div>
          <div class="caption-ai-tools">
            <div class="caption-ai-generate">
              <label><span>候选数</span><select data-caption-count><option value="3">3</option><option value="5" selected>5</option><option value="8">8</option></select></label>
              <button class="button button-secondary" type="button" data-generate-captions ${disabled}>${this.busy === "generate" ? "生成中…" : "AI 生成灵感"}</button>
            </div>
            <div class="caption-rewrite-actions" aria-label="AI 改写草稿">
              <button type="button" class="button button-ghost" data-rewrite="polish" ${disabled}>润色</button>
              <button type="button" class="button button-ghost" data-rewrite="shorten" ${disabled}>缩短</button>
              <button type="button" class="button button-ghost" data-rewrite="expand" ${disabled}>扩写</button>
              <button type="button" class="button button-ghost" data-rewrite="retone" ${disabled}>换语气</button>
            </div>
          </div>
          ${this.candidateMarkup(disabled)}
          <div class="caption-list">
            <div class="caption-list-heading"><h3>已保存文案</h3><span>${this.captions.length} 条</span></div>
            ${visible.length ? visible.map((caption) => this.cardMarkup(caption, disabled)).join("") : '<p class="caption-empty">还没有保存文案，从上方写下第一条吧。</p>'}
            ${this.captions.length > CARD_LIMIT ? `<button class="button button-ghost caption-list-toggle" type="button" data-toggle-caption-list>${this.showAll ? "收起" : `展开全部 ${this.captions.length} 条`}</button>` : ""}
          </div>
        </div>
      </details>
    `;
  }

  private candidateMarkup(disabled: string): string {
    if (!this.candidates.length) return "";
    return `
      <section class="caption-candidates" aria-label="AI 临时候选">
        <div class="caption-list-heading"><h3>AI 临时候选</h3><small>未保存，切换 Meme 后消失</small></div>
        ${this.candidates
          .map(
            (candidate, index) => `
              <article class="caption-candidate">
                <p>${escapeHtml(candidate)}</p>
                <div>
                  <button class="button button-ghost" type="button" data-copy-caption="${escapeHtml(candidate)}" ${disabled}>复制</button>
                  <button class="button button-secondary" type="button" data-use-candidate="${index}" ${disabled}>替换草稿</button>
                  <button class="button button-primary" type="button" data-save-candidate="${index}" ${disabled}>保存为新文案</button>
                </div>
              </article>
            `,
          )
          .join("")}
      </section>
    `;
  }

  private cardMarkup(caption: CaptionResponse, disabled: string): string {
    const metadata = [
      caption.scene && `场景：${caption.scene}`,
      caption.tone && `语气：${caption.tone}`,
      caption.length &&
        `长度：${{ short: "短", medium: "中", long: "长" }[caption.length]}`,
    ].filter(Boolean);
    return `
      <article class="caption-card">
        <p>${escapeHtml(caption.content)}</p>
        ${metadata.length ? `<div class="caption-meta">${metadata.map((item) => `<span>${escapeHtml(String(item))}</span>`).join("")}</div>` : ""}
        <footer>
          <small>${caption.source === "ai" ? "AI" : "手写"} · ${escapeHtml(formatDate(caption.updated_at))}</small>
          <div>
            <button class="button button-ghost" type="button" data-copy-caption="${escapeHtml(caption.content)}" ${disabled}>复制</button>
            <button class="button button-secondary" type="button" data-edit-caption="${caption.id}" ${disabled}>编辑</button>
            <button class="button button-danger" type="button" data-delete-caption="${caption.id}" ${disabled}>删除</button>
          </div>
        </footer>
      </article>
    `;
  }
}
