import {
  cancelEmbeddingJob,
  createEmbeddingJob,
  deleteEmbeddingJob,
  getEmbeddingJob,
  getSemanticIndexStatus,
  listEmbeddingJobItems,
  retryFailedEmbeddingJob,
} from "./api";
import type {
  EmbeddingJobItemPage,
  EmbeddingJobResponse,
  EmbeddingJobScope,
  SemanticIndexStatus,
} from "./types";

export interface SemanticIndexManagerApi {
  getStatus(): Promise<SemanticIndexStatus>;
  createJob(scope: EmbeddingJobScope, maxWorkers: number): Promise<EmbeddingJobResponse>;
  getJob(id: number): Promise<EmbeddingJobResponse>;
  listItems(id: number, offset?: number, limit?: number, status?: string): Promise<EmbeddingJobItemPage>;
  cancelJob(id: number): Promise<EmbeddingJobResponse>;
  retryFailed(id: number): Promise<EmbeddingJobResponse>;
  deleteJob(id: number): Promise<void>;
}

const defaultApi: SemanticIndexManagerApi = {
  getStatus: getSemanticIndexStatus,
  createJob: createEmbeddingJob,
  getJob: getEmbeddingJob,
  listItems: listEmbeddingJobItems,
  cancelJob: cancelEmbeddingJob,
  retryFailed: retryFailedEmbeddingJob,
  deleteJob: deleteEmbeddingJob,
};

const terminal = new Set(["cancelled", "completed", "completed_with_errors", "interrupted", "failed"]);

export class SemanticIndexManager {
  private readonly dialog: HTMLDialogElement;
  private status: SemanticIndexStatus | null = null;
  private job: EmbeddingJobResponse | null = null;
  private failures: EmbeddingJobItemPage | null = null;
  private error: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;

  constructor(
    private readonly openButton: HTMLButtonElement,
    private readonly api: SemanticIndexManagerApi = defaultApi,
    private readonly onIndexChanged: () => void = () => {},
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "settings-dialog semantic-index-dialog";
    this.dialog.dataset.semanticIndexDialog = "";
    document.body.append(this.dialog);
    this.openButton.addEventListener("click", () => void this.open());
    this.dialog.addEventListener("click", (event) => void this.onClick(event));
    this.dialog.addEventListener("change", () => this.render());
    this.dialog.addEventListener("close", () => this.stopPolling());
    this.render();
  }

  async open(): Promise<void> {
    this.error = null;
    if (!this.dialog.open) this.dialog.showModal();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.status = await this.api.getStatus();
      if (this.status.running_job) {
        this.job = await this.api.getJob(this.status.running_job.id);
        this.poll();
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "无法加载语义索引状态";
    }
    this.render();
  }

  private async onClick(event: MouseEvent): Promise<void> {
    const target = (event.target as Element).closest<HTMLElement>("button");
    if (!target || this.busy) return;
    if (target.matches("[data-close-index]")) {
      this.dialog.close();
      return;
    }
    if (target.dataset.createScope) {
      const scope = target.dataset.createScope as EmbeddingJobScope;
      if (scope === "all" && !confirm("确认重建全部 Meme 的语义索引？这会产生 Provider 调用费用。")) return;
      await this.create(scope);
    } else if (target.matches("[data-cancel-index-job]") && this.job) {
      await this.run(() => this.api.cancelJob(this.job!.id));
    } else if (target.matches("[data-retry-index-job]") && this.job) {
      await this.run(() => this.api.retryFailed(this.job!.id));
      this.poll();
    } else if (target.matches("[data-show-index-failures]") && this.job) {
      this.failures = await this.api.listItems(this.job.id, 0, 50, "failed");
      this.render();
    } else if (target.matches("[data-delete-index-job]") && this.job) {
      await this.run(async () => { await this.api.deleteJob(this.job!.id); return null; });
      this.job = null;
      this.failures = null;
      await this.refresh();
    }
  }

  private async create(scope: EmbeddingJobScope): Promise<void> {
    const workers = Number(this.dialog.querySelector<HTMLSelectElement>("[data-index-workers]")?.value || 4);
    await this.run(() => this.api.createJob(scope, workers));
    this.poll();
  }

  private async run(action: () => Promise<EmbeddingJobResponse | null>): Promise<void> {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const result = await action();
      if (result) this.job = result;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "操作失败";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private poll(): void {
    this.stopPolling();
    if (!this.dialog.open || !this.job || terminal.has(this.job.status)) return;
    this.timer = setTimeout(async () => {
      try {
        this.job = await this.api.getJob(this.job!.id);
        this.status = await this.api.getStatus();
        if (terminal.has(this.job.status)) this.onIndexChanged();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "任务状态刷新失败";
      }
      this.render();
      this.poll();
    }, 1000);
  }

  private stopPolling(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private render(): void {
    const s = this.status;
    const j = this.job;
    const pending = s ? s.missing_count + s.stale_count : 0;
    this.dialog.innerHTML = `
      <div class="settings-shell semantic-index-shell">
        <header class="settings-header"><div><p class="eyebrow">LOCAL VECTOR INDEX</p><h2>语义索引</h2>
          <p>向量保存在本地 SQLite，搜索由本地 NumPy 完成。</p></div>
          <button class="icon-button" type="button" data-close-index aria-label="关闭">×</button></header>
        ${this.error ? `<p class="form-error" role="alert">${this.escape(this.error)}</p>` : ""}
        <section class="index-stats">
          <div><span>当前模型</span><strong>${this.escape(s?.active_model_id || "未配置")}</strong></div>
          <div><span>维度</span><strong>${s?.dimension ?? 1024}</strong></div>
          <div><span>Meme 总数</span><strong>${s?.total_memes ?? 0}</strong></div>
          <div><span>已就绪</span><strong>${s?.ready_count ?? 0}</strong></div>
          <div><span>待建立</span><strong>${s?.missing_count ?? 0}</strong></div>
          <div><span>已过期</span><strong>${s?.stale_count ?? 0}</strong></div>
          <div><span>失败</span><strong>${s?.failed_count ?? 0}</strong></div>
          <div><span>不兼容</span><strong>${s?.incompatible_count ?? 0}</strong></div>
        </section>
        <section class="index-actions"><p>待处理 ${pending} 个 Meme；预计 API 请求 ${pending} 次，每个 Meme 最多使用前 5 张图片。操作会产生 Provider 调用费用。</p>
          <label>并发数 <select data-index-workers ${this.busy || (j && !terminal.has(j.status)) ? "disabled" : ""}>
            <option>1</option><option>2</option><option selected>4</option><option>8</option></select></label>
          <div class="modal-actions">
            <button class="button button-primary" data-create-scope="missing_or_stale" ${this.busy || (j && !terminal.has(j.status)) ? "disabled" : ""}>建立缺失与过期索引</button>
            <button class="button button-secondary" data-create-scope="all" ${this.busy || (j && !terminal.has(j.status)) ? "disabled" : ""}>重建全部索引</button>
            <button class="button button-secondary" data-create-scope="failed" ${this.busy || (j && !terminal.has(j.status)) ? "disabled" : ""}>重试失败向量</button>
          </div>
        </section>
        ${j ? `<section class="index-job"><h3>任务 #${j.id} · ${this.escape(j.status)}</h3>
          <progress max="${Math.max(1, j.total_count)}" value="${j.processed_count}"></progress>
          <p>${j.processed_count} / ${j.total_count} · 成功 ${j.success_count} · 跳过 ${j.skipped_count} · 失败 ${j.failed_count}</p>
          <p>文本 Token ${j.text_tokens} · 图片 Token ${j.image_tokens} · 总 Token ${j.total_tokens}</p>
          <div class="modal-actions">
            ${!terminal.has(j.status) ? '<button class="button button-danger" data-cancel-index-job>取消任务</button>' : ""}
            ${j.failed_count && terminal.has(j.status) ? '<button class="button button-secondary" data-retry-index-job>重试失败项</button>' : ""}
            ${j.failed_count ? '<button class="button button-secondary" data-show-index-failures>查看失败明细</button>' : ""}
            ${terminal.has(j.status) ? '<button class="button button-ghost" data-delete-index-job>删除任务记录</button>' : ""}
          </div></section>` : ""}
        ${this.failures ? `<section class="index-failures"><h3>失败明细（${this.failures.total}）</h3>${this.failures.items.map(item => `<p>Meme #${item.meme_id}：${this.escape(item.error_message || "未知错误")}</p>`).join("")}</section>` : ""}
      </div>`;
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character));
  }
}
