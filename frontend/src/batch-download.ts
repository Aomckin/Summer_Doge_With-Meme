import type {
  CreateExportJobInput, ExportJobItemPage, ExportJobItemResponse,
  ExportJobResponse, ExportOrganization,
} from "./types";

const STORAGE_KEY = "meme-vault.last-export-job";
const ACTIVE = new Set(["pending", "running", "cancelling"]);
const READY = new Set(["ready", "completed_with_errors"]);
const PAGE_SIZE = 25;

interface FilterSnapshot { query: string; tags: string[]; templateId: number | null }
export interface BatchDownloadApi {
  createExportJob(input: CreateExportJobInput): Promise<ExportJobResponse>;
  getExportJob(id: number): Promise<ExportJobResponse>;
  listExportJobItems(id: number, offset?: number, limit?: number): Promise<ExportJobItemPage>;
  cancelExportJob(id: number): Promise<ExportJobResponse>;
  deleteExportJob(id: number): Promise<void>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char] ?? char);
}
function size(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export class BatchDownloadController {
  private readonly dialog: HTMLDialogElement;
  private filters: FilterSnapshot = { query: "", tags: [], templateId: null };
  private job: ExportJobResponse | null = null;
  private failures: ExportJobItemResponse[] = [];
  private failureTotal = 0;
  private failureOffset = 0;
  private failuresVisible = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;

  constructor(private readonly api: BatchDownloadApi) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "modal batch-download-dialog";
    this.dialog.dataset.batchDownloadDialog = "";
    this.dialog.innerHTML = `
      <form class="modal-card batch-download-card" data-export-form>
        <div class="modal-heading"><div><p class="eyebrow">BATCH EXPORT</p><h2>批量下载</h2></div><button class="icon-button" type="button" data-close-export>×</button></div>
        <fieldset data-export-settings>
          <legend>导出范围</legend>
          <label><input type="radio" name="scope" value="all" checked> 全部 Meme</label>
          <label><input type="radio" name="scope" value="filtered"> 当前搜索与标签筛选</label>
          <div class="export-filter-summary" data-filter-summary></div>
          <p class="muted">导出的是服务器中所有符合条件的结果，不仅是当前页面已加载内容。</p>
        </fieldset>
        <fieldset data-export-settings><legend>目录组织</legend>
          <label><input type="radio" name="organization" value="flat" checked> 扁平目录（推荐）</label>
          <label><input type="radio" name="organization" value="template"> 按模板分目录</label>
          <label><input type="radio" name="organization" value="tag"> 按标签分目录</label>
          <p class="form-error" data-tag-warning hidden>拥有多个标签的 Meme 会在多个目录中重复写入，可能显著增加 ZIP 大小。</p>
        </fieldset>
        <label data-export-settings><span>ZIP 名称</span><input name="archive_name" value="meme-vault-export" maxlength="255" required></label>
        <label data-export-settings class="check-row"><input type="checkbox" checked disabled> 包含 manifest.json</label>
        <section class="batch-progress" data-export-progress><strong>任务进度</strong><span>尚未创建任务</span></section>
        <div class="batch-failed-list" data-export-failures hidden></div>
        <div class="batch-failure-pages" data-export-pages hidden><button type="button" class="button button-ghost" data-export-prev>上一页</button><span data-export-page></span><button type="button" class="button button-ghost" data-export-next>下一页</button></div>
        <p class="form-error" data-export-error hidden></p>
        <div class="modal-actions">
          <button class="button button-ghost" type="button" data-close-export>关闭</button>
          <button class="button button-secondary" type="button" data-cancel-export hidden>取消任务</button>
          <a class="button button-primary" data-download-export hidden>下载 ZIP</a>
          <button class="button button-secondary" type="button" data-toggle-export-failures hidden>查看失败明细</button>
          <button class="button button-danger" type="button" data-delete-export hidden>删除任务</button>
          <button class="button button-primary" type="submit" data-start-export>开始导出</button>
        </div>
      </form>`;
    document.body.append(this.dialog);
    this.bind();
  }

  open(filters: FilterSnapshot): void {
    this.filters = { query: filters.query, tags: [...filters.tags], templateId: filters.templateId };
    this.render();
    this.dialog.showModal();
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (!this.job && stored > 0) void this.resume(stored);
    else if (this.job && ACTIVE.has(this.job.status)) this.schedule(0);
  }

  private bind(): void {
    for (const button of this.dialog.querySelectorAll("[data-close-export]")) button.addEventListener("click", () => this.close());
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); });
    this.required<HTMLFormElement>("[data-export-form]").addEventListener("submit", event => { event.preventDefault(); void this.start(); });
    this.dialog.addEventListener("change", () => this.render());
    this.required("[data-cancel-export]").addEventListener("click", () => void this.cancel());
    this.required("[data-delete-export]").addEventListener("click", () => void this.remove());
    this.required("[data-toggle-export-failures]").addEventListener("click", () => {
      this.failuresVisible = !this.failuresVisible;
      if (this.failuresVisible && this.job && this.failures.length === 0) void this.loadFailures(0);
      this.render();
    });
    this.required("[data-export-prev]").addEventListener("click", () => void this.loadFailures(Math.max(0, this.failureOffset - PAGE_SIZE)));
    this.required("[data-export-next]").addEventListener("click", () => void this.loadFailures(this.failureOffset + PAGE_SIZE));
  }

  private close(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; this.dialog.close(); }
  private required<T extends Element = HTMLElement>(selector: string): T {
    const element = this.dialog.querySelector<T>(selector); if (!element) throw new Error(`Missing export element ${selector}`); return element;
  }
  private async start(): Promise<void> {
    if (this.busy || this.job) return;
    this.busy = true; this.error(null); this.render();
    const scope = this.required<HTMLInputElement>('[name="scope"]:checked').value as "all" | "filtered";
    const organization = this.required<HTMLInputElement>('[name="organization"]:checked').value as ExportOrganization;
    try {
      this.job = await this.api.createExportJob({
        scope, query: scope === "filtered" ? this.filters.query || null : null,
        tags: scope === "filtered" ? [...this.filters.tags] : [],
        template_id: scope === "filtered" ? this.filters.templateId : null,
        organization, include_manifest: true,
        archive_name: this.required<HTMLInputElement>('[name="archive_name"]').value.trim(),
      });
      localStorage.setItem(STORAGE_KEY, String(this.job.id)); this.schedule(0);
    } catch (error) { this.error(error instanceof Error ? error.message : "创建导出任务失败"); }
    finally { this.busy = false; this.render(); }
  }

  private async resume(id: number): Promise<void> {
    try {
      this.job = await this.api.getExportJob(id);
      if (this.job.status === "expired") { this.job = null; localStorage.removeItem(STORAGE_KEY); }
      this.render(); if (this.job && ACTIVE.has(this.job.status)) this.schedule();
    }
    catch { localStorage.removeItem(STORAGE_KEY); }
  }
  private schedule(delay = 900): void { if (this.timer) clearTimeout(this.timer); if (this.dialog.open) this.timer = setTimeout(() => void this.poll(), delay); }
  private async poll(): Promise<void> {
    if (!this.job || !this.dialog.open) return;
    try { this.job = await this.api.getExportJob(this.job.id); this.render(); if (ACTIVE.has(this.job.status)) this.schedule(); }
    catch (error) { this.error(error instanceof Error ? error.message : "读取任务失败"); this.schedule(2000); }
  }
  private async cancel(): Promise<void> { if (!this.job) return; try { this.job = await this.api.cancelExportJob(this.job.id); this.render(); this.schedule(0); } catch (e) { this.error(e instanceof Error ? e.message : "取消失败"); } }
  private async remove(): Promise<void> { if (!this.job) return; try { await this.api.deleteExportJob(this.job.id); this.job = null; this.failures = []; this.failureTotal = 0; localStorage.removeItem(STORAGE_KEY); this.render(); } catch (e) { this.error(e instanceof Error ? e.message : "删除失败"); } }
  private async loadFailures(offset: number): Promise<void> { if (!this.job) return; const page = await this.api.listExportJobItems(this.job.id, offset, PAGE_SIZE); this.failures = page.items; this.failureTotal = page.total; this.failureOffset = offset; this.render(); }
  private error(message: string | null): void { const node = this.required<HTMLElement>("[data-export-error]"); node.hidden = !message; node.textContent = message ?? ""; }

  private render(): void {
    const org = this.required<HTMLInputElement>('[name="organization"]:checked').value;
    this.required<HTMLElement>("[data-tag-warning]").hidden = org !== "tag";
    this.required<HTMLElement>("[data-filter-summary]").innerHTML = `<strong>搜索：</strong>${escapeHtml(this.filters.query || "无")}<br><strong>标签：</strong>${escapeHtml(this.filters.tags.join(", ") || "无")}`;
    const progress = this.required<HTMLElement>("[data-export-progress]");
    progress.innerHTML = this.job ? `<strong>状态：${escapeHtml(this.job.status)}</strong><span>Meme ${this.job.processed_memes}/${this.job.total_memes} · 图片 ${this.job.processed_images}/${this.job.total_images}</span><span>成功 ${this.job.success_count} · 跳过 ${this.job.skipped_count} · 失败 ${this.job.failed_count}</span><span>当前：${escapeHtml(this.job.current_filename ?? "—")}</span><span>预计 ${size(this.job.estimated_bytes)} · ZIP ${size(this.job.archive_size)}</span>` : "<strong>任务进度</strong><span>尚未创建任务</span>";
    const active = Boolean(this.job && ACTIVE.has(this.job.status));
    for (const control of this.dialog.querySelectorAll<HTMLInputElement>("[data-export-settings] input")) control.disabled = Boolean(this.job) || this.busy;
    this.required<HTMLButtonElement>("[data-start-export]").hidden = Boolean(this.job);
    this.required<HTMLButtonElement>("[data-cancel-export]").hidden = !active;
    const download = this.required<HTMLAnchorElement>("[data-download-export]");
    download.hidden = !this.job || !READY.has(this.job.status); download.href = this.job ? `/api/export-jobs/${this.job.id}/download` : "";
    this.required<HTMLButtonElement>("[data-delete-export]").hidden = !this.job || active;
    const toggleFailures = this.required<HTMLButtonElement>("[data-toggle-export-failures]");
    toggleFailures.hidden = !this.job || this.job.failed_count + this.job.skipped_count === 0;
    toggleFailures.textContent = this.failuresVisible ? "隐藏失败明细" : "查看失败明细";
    const failures = this.required<HTMLElement>("[data-export-failures]"); failures.hidden = !this.failuresVisible || this.failureTotal === 0;
    failures.innerHTML = this.failures.map(item => `<article class="batch-failure-item"><strong>${escapeHtml(item.archive_filename ?? `Meme ${item.meme_id}`)}</strong><small>${escapeHtml(item.error_message ?? item.status)}</small></article>`).join("");
    const pages = this.required<HTMLElement>("[data-export-pages]"); pages.hidden = !this.failuresVisible || this.failureTotal <= PAGE_SIZE;
    this.required<HTMLElement>("[data-export-page]").textContent = this.failureTotal ? `${this.failureOffset + 1}–${Math.min(this.failureOffset + PAGE_SIZE, this.failureTotal)} / ${this.failureTotal}` : "";
  }
}
