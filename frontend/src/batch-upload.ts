import { ApiError, parseTagInput } from "./api";
import type {
  CreateImportJobInput,
  ImportJobItemResponse,
  ImportJobResponse,
  MemeResponse,
  TemplateResponse,
  UploadMemeInput,
} from "./types";

export type BatchUploadStatus =
  | "pending"
  | "uploading"
  | "success"
  | "skipped"
  | "failed";

interface BatchUploadItem {
  id: number;
  file: File;
  title: string;
  previewUrl: string;
  status: BatchUploadStatus;
  error: string | null;
}

export interface BatchUploadResult {
  success: number;
  skipped: number;
  failed: number;
}

interface BatchUploadOptions {
  uploadMeme(input: UploadMemeInput): Promise<MemeResponse>;
  createImportJob?(input: CreateImportJobInput): Promise<ImportJobResponse>;
  getImportJob?(id: number): Promise<ImportJobResponse>;
  listImportJobItems?(id: number, offset?: number, limit?: number, status?: string): Promise<{ items: ImportJobItemResponse[]; total: number }>;
  cancelImportJob?(id: number): Promise<ImportJobResponse>;
  retryFailedImportJob?(id: number): Promise<ImportJobResponse>;
  deleteImportJob?(id: number): Promise<void>;
  onComplete(result: BatchUploadResult): Promise<void> | void;
  confirmClose?: (message: string) => boolean;
}

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const ACTIVE_IMPORT_STATUSES = new Set(["queued", "running", "cancelling"]);
const IMPORT_JOB_STORAGE_KEY = "meme-vault.active-import-job";
const FAILED_PAGE_SIZE = 25;

const STATUS_LABELS: Record<BatchUploadStatus, string> = {
  pending: "等待中",
  uploading: "上传中",
  success: "成功",
  skipped: "已跳过",
  failed: "失败",
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function titleFromFilename(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "网络请求失败，请稍后重试。";
}

export class BatchUploadController {
  private readonly dialog: HTMLDialogElement;
  private readonly form: HTMLFormElement;
  private readonly fileInput: HTMLInputElement;
  private readonly queueElement: HTMLElement;
  private readonly emptyElement: HTMLElement;
  private readonly statsElement: HTMLElement;
  private readonly messageElement: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly resultElement: HTMLElement;
  private readonly zipInput: HTMLInputElement;
  private mode: "images" | "zip" = "images";
  private zipFile: File | null = null;
  private importJob: ImportJobResponse | null = null;
  private failedItems: ImportJobItemResponse[] = [];
  private failedOffset = 0;
  private failedTotal = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private importCompletionNotified = false;
  private resultTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: BatchUploadItem[] = [];
  private nextId = 0;
  private running = false;
  private stopRequested = false;
  private locked = false;

  constructor(private readonly options: BatchUploadOptions) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "modal batch-upload-dialog";
    this.dialog.dataset.batchDialog = "";
    this.dialog.setAttribute("aria-labelledby", "batch-upload-title");
    this.dialog.innerHTML = `
      <form class="modal-card batch-upload-card" data-batch-form>
        <div class="modal-heading">
          <div>
            <p class="eyebrow">IMAGE UPLOAD</p>
            <h2 id="batch-upload-title">图片上传</h2>
          </div>
          <button class="icon-button" type="button" data-close-batch aria-label="关闭">×</button>
        </div>

        <div class="batch-mode-switch" role="radiogroup" aria-label="上传模式">
          <label><input type="radio" name="upload_mode" value="images" checked> 普通图片</label>
          <label><input type="radio" name="upload_mode" value="zip"> 压缩包导入</label>
        </div>

        <div class="batch-upload-layout">
          <section class="batch-files-panel" aria-label="待上传图片" data-image-panel>
            <div class="batch-drop-zone" data-batch-drop-zone tabindex="0">
              <strong>拖入多张图片</strong>
              <span>或点击选择 JPEG、PNG、WebP、GIF</span>
              <input
                name="batch_files"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                hidden
              >
            </div>
            <div class="batch-queue-toolbar">
              <span data-batch-count>0 张图片</span>
              <button class="button button-ghost" type="button" data-clear-batch>清空全部</button>
            </div>
            <p class="batch-empty" data-batch-empty>还没有选择图片。</p>
            <div class="batch-file-list" data-batch-queue></div>
          </section>
          <section class="batch-files-panel" aria-label="ZIP 压缩包" data-zip-panel hidden>
            <label class="batch-drop-zone batch-zip-picker">
              <strong>选择一个 ZIP 压缩包</strong>
              <span>后端逐项读取，不会在浏览器中生成图片预览</span>
              <input name="zip_archive" type="file" accept=".zip,application/zip">
            </label>
            <article class="batch-zip-summary" data-zip-summary>还没有选择压缩包。</article>
            <div class="batch-failed-list" data-import-failures hidden></div>
            <div class="batch-failure-pages" data-import-pages hidden>
              <button class="button button-ghost" type="button" data-import-prev>上一页</button>
              <span data-import-page-label></span>
              <button class="button button-ghost" type="button" data-import-next>下一页</button>
            </div>
          </section>

          <section class="batch-metadata" aria-label="公共信息">
            <label>
              <span>公共标签</span>
              <input name="tags" type="text" placeholder="funny, reaction">
              <small>使用英文逗号分隔</small>
            </label>
            <label>
              <span>公共模板</span>
              <select name="template_id">
                <option value="">无模板</option>
              </select>
            </label>
            <label>
              <span>公共来源</span>
              <input name="source" type="text" maxlength="500">
            </label>
            <label data-zip-only hidden>
              <span>数据库批次大小</span>
              <input name="chunk_size" type="number" min="1" max="1000" value="100">
              <small>默认每 100 张提交一次</small>
            </label>
            <div class="batch-progress" aria-live="polite">
              <strong>上传进度</strong>
              <span data-batch-stats>等待添加图片</span>
            </div>
            <p class="form-error" data-batch-message role="alert" hidden></p>
          </section>
        </div>

        <div class="modal-actions batch-upload-actions">
          <button class="button button-ghost" type="button" data-close-batch>关闭</button>
          <button class="button button-secondary" type="button" data-retry-batch hidden>重试失败项</button>
          <button class="button button-secondary" type="button" data-stop-batch hidden>停止上传</button>
          <button class="button button-secondary" type="button" data-retry-import hidden>重试 ZIP 失败项</button>
          <button class="button button-secondary" type="button" data-cancel-import hidden>取消导入</button>
          <button class="button button-secondary" type="button" data-new-import hidden>删除任务并新建</button>
          <button class="button button-primary" type="submit" data-start-batch>开始上传</button>
        </div>
      </form>
    `;
    document.body.append(this.dialog);
    this.resultElement = document.createElement("div");
    this.resultElement.className = "batch-result-toast";
    this.resultElement.dataset.batchResult = "";
    this.resultElement.setAttribute("role", "status");
    this.resultElement.setAttribute("aria-live", "polite");
    this.resultElement.hidden = true;
    document.body.append(this.resultElement);

    this.form = this.required("[data-batch-form]");
    this.fileInput = this.required('[name="batch_files"]');
    this.zipInput = this.required('[name="zip_archive"]');
    this.queueElement = this.required("[data-batch-queue]");
    this.emptyElement = this.required("[data-batch-empty]");
    this.statsElement = this.required("[data-batch-stats]");
    this.messageElement = this.required("[data-batch-message]");
    this.startButton = this.required("[data-start-batch]");
    this.stopButton = this.required("[data-stop-batch]");
    this.retryButton = this.required("[data-retry-batch]");
    this.clearButton = this.required("[data-clear-batch]");
    this.bindEvents();
    this.render();
    const storedJobId = Number(localStorage.getItem(IMPORT_JOB_STORAGE_KEY));
    if (storedJobId > 0 && this.options.getImportJob) {
      this.mode = "zip";
      void this.resumeImport(storedJobId);
    }
  }

  open(templates: TemplateResponse[]): void {
    if (!this.importJob && !this.running) {
      this.reset();
    }
    this.setTemplates(templates);
    this.render();
    this.dialog.showModal();
  }

  setTemplates(templates: TemplateResponse[]): void {
    const select = this.required<HTMLSelectElement>('[name="template_id"]');
    const selected = select.value;
    select.innerHTML = [
      '<option value="">无模板</option>',
      ...templates.map(
        (template) =>
          `<option value="${template.id}">${escapeHtml(template.name)}</option>`,
      ),
    ].join("");
    if ([...select.options].some((option) => option.value === selected)) {
      select.value = selected;
    }
  }

  requestClose(): void {
    if (this.mode === "zip" && this.importJob) {
      this.dialog.close();
      return;
    }
    const hasUnfinished = this.queue.some((item) =>
      ["pending", "uploading", "failed"].includes(item.status),
    );
    const confirmClose = this.options.confirmClose ?? window.confirm;
    if (
      hasUnfinished &&
      !confirmClose("仍有未完成的上传任务，确定要关闭吗？")
    ) {
      return;
    }
    if (this.running) {
      this.stopRequested = true;
    }
    this.dialog.close();
  }

  private required<T extends Element>(selector: string): T {
    const element = this.dialog.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing batch upload element: ${selector}`);
    }
    return element;
  }

  private bindEvents(): void {
    const dropZone = this.required<HTMLElement>("[data-batch-drop-zone]");
    dropZone.addEventListener("click", () => {
      if (!this.locked) this.fileInput.click();
    });
    dropZone.addEventListener("keydown", (event) => {
      if (!this.locked && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        this.fileInput.click();
      }
    });
    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!this.locked) dropZone.classList.add("is-dragging");
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("is-dragging");
    });
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
      if (!this.locked) this.addFiles(event.dataTransfer?.files ?? []);
    });
    this.fileInput.addEventListener("change", () => {
      this.addFiles(this.fileInput.files ?? []);
      this.fileInput.value = "";
    });
    for (const radio of this.dialog.querySelectorAll<HTMLInputElement>(
      '[name="upload_mode"]',
    )) {
      radio.addEventListener("change", () => {
        if (this.locked || this.importJob) return;
        this.mode = radio.value === "zip" ? "zip" : "images";
        this.setMessage(null);
        this.render();
      });
    }
    this.zipInput.addEventListener("change", () => {
      const file = this.zipInput.files?.[0] ?? null;
      if (file && !file.name.toLowerCase().endsWith(".zip")) {
        this.zipFile = null;
        this.setMessage("请选择 ZIP 压缩包。");
      } else {
        this.zipFile = file;
        this.setMessage(null);
      }
      this.render();
    });
    this.queueElement.addEventListener("click", (event) => {
      if (this.locked) return;
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "[data-remove-batch-item]",
      );
      if (!button) return;
      this.removeItem(Number(button.dataset.removeBatchItem));
    });
    this.queueElement.addEventListener("input", (event) => {
      if (this.locked) return;
      const input = event.target as HTMLInputElement;
      if (!input.matches("[data-batch-title]")) return;
      const item = this.queue.find(
        (candidate) => candidate.id === Number(input.dataset.batchTitle),
      );
      if (!item) return;
      item.title = input.value;
      input.closest<HTMLElement>("[data-batch-item]")!.dataset.title =
        input.value;
      this.startButton.disabled = !this.canStart();
    });
    this.clearButton.addEventListener("click", () => this.clearQueue());
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.mode === "zip") void this.startImport();
      else void this.runQueue();
    });
    this.stopButton.addEventListener("click", () => {
      this.stopRequested = true;
      this.render();
    });
    this.retryButton.addEventListener("click", () => {
      for (const item of this.queue) {
        if (item.status === "failed") {
          item.status = "pending";
          item.error = null;
        }
      }
      void this.runQueue();
    });
    this.required<HTMLButtonElement>("[data-cancel-import]").addEventListener(
      "click",
      () => void this.cancelImport(),
    );
    this.required<HTMLButtonElement>("[data-retry-import]").addEventListener(
      "click",
      () => void this.retryImport(),
    );
    this.required<HTMLButtonElement>("[data-new-import]").addEventListener(
      "click",
      () => void this.deleteImportAndReset(),
    );
    this.required<HTMLButtonElement>("[data-import-prev]").addEventListener(
      "click",
      () => void this.loadFailurePage(Math.max(0, this.failedOffset - FAILED_PAGE_SIZE)),
    );
    this.required<HTMLButtonElement>("[data-import-next]").addEventListener(
      "click",
      () => void this.loadFailurePage(this.failedOffset + FAILED_PAGE_SIZE),
    );
    for (const button of this.dialog.querySelectorAll("[data-close-batch]")) {
      button.addEventListener("click", () => this.requestClose());
    }
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.requestClose();
    });
  }

  private addFiles(files: Iterable<File>): void {
    let rejected = 0;
    for (const file of files) {
      if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
        rejected += 1;
        continue;
      }
      this.queue.push({
        id: this.nextId++,
        file,
        title: titleFromFilename(file.name),
        previewUrl: URL.createObjectURL(file),
        status: "pending",
        error: null,
      });
    }
    this.setMessage(
      rejected ? `${rejected} 个文件不是支持的图片格式，已忽略。` : null,
    );
    this.render();
  }

  private removeItem(id: number): void {
    const item = this.queue.find((candidate) => candidate.id === id);
    if (item) URL.revokeObjectURL(item.previewUrl);
    this.queue = this.queue.filter((candidate) => candidate.id !== id);
    this.render();
  }

  private clearQueue(): void {
    if (this.locked) return;
    for (const item of this.queue) URL.revokeObjectURL(item.previewUrl);
    this.queue = [];
    this.setMessage(null);
    this.render();
  }

  private reset(): void {
    for (const item of this.queue) URL.revokeObjectURL(item.previewUrl);
    this.queue = [];
    this.nextId = 0;
    this.running = false;
    this.stopRequested = false;
    this.locked = false;
    this.form.reset();
    this.mode = "images";
    this.zipFile = null;
    this.failedItems = [];
    this.failedTotal = 0;
    this.failedOffset = 0;
    this.setMessage(null);
    this.render();
  }

  private metadata(): Omit<UploadMemeInput, "file" | "title"> {
    const tags = this.required<HTMLInputElement>('[name="tags"]').value;
    const source = this.required<HTMLInputElement>('[name="source"]').value;
    const templateId =
      this.required<HTMLSelectElement>('[name="template_id"]').value;
    return {
      description: "",
      source,
      tags: parseTagInput(tags),
      template_id: templateId ? Number(templateId) : null,
    };
  }

  private async startImport(): Promise<void> {
    if (
      !this.zipFile ||
      this.importJob ||
      !this.options.createImportJob ||
      !this.options.getImportJob
    ) return;
    const metadata = this.metadata();
    const chunkSize = Number(
      this.required<HTMLInputElement>('[name="chunk_size"]').value,
    );
    this.locked = true;
    this.setMessage(null);
    this.render();
    try {
      this.importJob = await this.options.createImportJob({
        archive: this.zipFile,
        tags: metadata.tags ?? [],
        template_id: metadata.template_id ?? null,
        source: metadata.source ?? "",
        chunk_size: chunkSize,
      });
      localStorage.setItem(IMPORT_JOB_STORAGE_KEY, String(this.importJob.id));
      this.importCompletionNotified = false;
      this.render();
      this.schedulePoll(0);
    } catch (error) {
      this.locked = false;
      this.setMessage(errorText(error));
      this.render();
    }
  }

  private async resumeImport(jobId: number): Promise<void> {
    try {
      this.importJob = await this.options.getImportJob?.(jobId) ?? null;
      this.locked = Boolean(
        this.importJob && ACTIVE_IMPORT_STATUSES.has(this.importJob.status),
      );
      this.render();
      if (this.importJob && ACTIVE_IMPORT_STATUSES.has(this.importJob.status)) {
        this.schedulePoll();
      } else if (this.importJob?.failed_count) {
        await this.loadFailurePage(0);
      }
    } catch {
      localStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
      this.importJob = null;
      this.locked = false;
      this.render();
    }
  }

  private schedulePoll(delay = 800): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.pollImport(), delay);
  }

  private async pollImport(): Promise<void> {
    if (!this.importJob || !this.options.getImportJob) return;
    try {
      this.importJob = await this.options.getImportJob(this.importJob.id);
      this.locked = ACTIVE_IMPORT_STATUSES.has(this.importJob.status);
      this.setMessage(this.importJob.error_message);
      this.render();
      if (this.locked) {
        this.schedulePoll();
        return;
      }
      if (this.importJob.failed_count > 0) await this.loadFailurePage(0);
      if (
        this.importJob.status === "completed" &&
        !this.importCompletionNotified
      ) {
        this.importCompletionNotified = true;
        await this.options.onComplete({
          success: this.importJob.success_count,
          skipped: this.importJob.skipped_count,
          failed: this.importJob.failed_count,
        });
        const summary = `导入完成：成功 ${this.importJob.success_count}，重复 ${this.importJob.skipped_count}，失败 ${this.importJob.failed_count}。`;
        this.showResult(summary);
      }
      if (this.importJob.failed_count === 0) {
        localStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
      }
    } catch (error) {
      this.setMessage(errorText(error));
      this.schedulePoll(2000);
    }
    this.render();
  }

  private async cancelImport(): Promise<void> {
    if (!this.importJob || !this.options.cancelImportJob) return;
    try {
      this.importJob = await this.options.cancelImportJob(this.importJob.id);
      this.render();
      this.schedulePoll(0);
    } catch (error) {
      this.setMessage(errorText(error));
    }
  }

  private async retryImport(): Promise<void> {
    if (!this.importJob || !this.options.retryFailedImportJob) return;
    try {
      this.importJob = await this.options.retryFailedImportJob(this.importJob.id);
      this.failedItems = [];
      this.failedTotal = 0;
      this.locked = true;
      this.importCompletionNotified = false;
      this.render();
      this.schedulePoll(0);
    } catch (error) {
      this.setMessage(errorText(error));
    }
  }

  private async deleteImportAndReset(): Promise<void> {
    if (!this.importJob || !this.options.deleteImportJob) return;
    try {
      await this.options.deleteImportJob(this.importJob.id);
      localStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
      this.importJob = null;
      this.zipFile = null;
      this.zipInput.value = "";
      this.failedItems = [];
      this.failedTotal = 0;
      this.locked = false;
      this.setMessage(null);
      this.render();
    } catch (error) {
      this.setMessage(errorText(error));
    }
  }

  private async loadFailurePage(offset: number): Promise<void> {
    if (!this.importJob || !this.options.listImportJobItems) return;
    const page = await this.options.listImportJobItems(
      this.importJob.id,
      offset,
      FAILED_PAGE_SIZE,
      "failed",
    );
    this.failedItems = page.items;
    this.failedTotal = page.total;
    this.failedOffset = offset;
    this.render();
  }

  private async runQueue(): Promise<void> {
    if (this.running || !this.canStart()) {
      return;
    }
    this.running = true;
    this.stopRequested = false;
    this.locked = true;
    const metadata = this.metadata();
    this.setMessage(null);
    this.render();

    while (!this.stopRequested) {
      const item = this.queue.find((candidate) => candidate.status === "pending");
      if (!item) break;
      item.status = "uploading";
      this.render();
      try {
        await this.options.uploadMeme({
          file: item.file,
          title: item.title.trim(),
          ...metadata,
        });
        item.status = "success";
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          item.status = "skipped";
          item.error = "图片已存在";
        } else {
          item.status = "failed";
          item.error = errorText(error);
        }
      }
      this.render();
    }

    this.running = false;
    const hasPending = this.queue.some((item) => item.status === "pending");
    const result = this.result();
    if (!hasPending) {
      await this.options.onComplete(result);
      if (result.failed === 0) {
        const summary =
          `上传完成：成功 ${result.success}，跳过 ${result.skipped}，失败 0。`;
        this.setMessage(summary, false);
        this.showResult(summary);
        this.render();
        this.releasePreviews();
        this.dialog.close();
        return;
      }
    }
    this.render();
  }

  private result(): BatchUploadResult {
    return {
      success: this.queue.filter((item) => item.status === "success").length,
      skipped: this.queue.filter((item) => item.status === "skipped").length,
      failed: this.queue.filter((item) => item.status === "failed").length,
    };
  }

  private setMessage(message: string | null, isError = true): void {
    this.messageElement.hidden = !message;
    this.messageElement.textContent = message ?? "";
    this.messageElement.classList.toggle("is-success", !isError && Boolean(message));
  }

  private showResult(message: string): void {
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultElement.textContent = message;
    this.resultElement.hidden = false;
    this.resultTimer = setTimeout(() => {
      this.resultElement.hidden = true;
      this.resultTimer = null;
    }, 4000);
  }

  private releasePreviews(): void {
    for (const item of this.queue) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }

  private canStart(): boolean {
    const pending = this.queue.filter((item) => item.status === "pending");
    return (
      pending.length > 0 &&
      pending.every((item) => item.title.trim().length > 0)
    );
  }

  private render(): void {
    const result = this.result();
    const pending = this.queue.filter((item) => item.status === "pending").length;
    const uploading = this.queue.filter(
      (item) => item.status === "uploading",
    ).length;
    const processed = result.success + result.skipped + result.failed;
    const isZip = this.mode === "zip";
    this.required<HTMLElement>("[data-image-panel]").hidden = isZip;
    this.required<HTMLElement>("[data-zip-panel]").hidden = !isZip;
    this.required<HTMLElement>("[data-zip-only]").hidden = !isZip;
    for (const radio of this.dialog.querySelectorAll<HTMLInputElement>(
      '[name="upload_mode"]',
    )) {
      radio.checked = radio.value === this.mode;
      radio.disabled = Boolean(this.importJob) || this.running;
    }
    const zipSummary = this.required<HTMLElement>("[data-zip-summary]");
    if (this.importJob) {
      zipSummary.innerHTML = `
        <strong>${escapeHtml(this.importJob.original_filename)}</strong>
        <span>任务 #${this.importJob.id} · ${escapeHtml(this.importJob.status)}</span>
        ${this.importJob.current_filename ? `<small>当前：${escapeHtml(this.importJob.current_filename)}</small>` : ""}
      `;
    } else if (this.zipFile) {
      zipSummary.innerHTML = `
        <strong>${escapeHtml(this.zipFile.name)}</strong>
        <span>${(this.zipFile.size / 1024 / 1024).toFixed(2)} MiB</span>
      `;
    } else {
      zipSummary.textContent = "还没有选择压缩包。";
    }
    const failures = this.required<HTMLElement>("[data-import-failures]");
    failures.hidden = !isZip || this.failedTotal === 0;
    failures.innerHTML = this.failedItems.map((item) => `
      <article class="batch-failure-item">
        <strong>${escapeHtml(item.filename)}</strong>
        <small>${escapeHtml(item.error_message ?? "未知错误")}</small>
      </article>
    `).join("");
    const pages = this.required<HTMLElement>("[data-import-pages]");
    pages.hidden = !isZip || this.failedTotal <= FAILED_PAGE_SIZE;
    this.required<HTMLElement>("[data-import-page-label]").textContent =
      this.failedTotal ? `${this.failedOffset + 1}–${Math.min(this.failedOffset + FAILED_PAGE_SIZE, this.failedTotal)} / ${this.failedTotal}` : "";
    this.required<HTMLButtonElement>("[data-import-prev]").disabled = this.failedOffset === 0;
    this.required<HTMLButtonElement>("[data-import-next]").disabled =
      this.failedOffset + FAILED_PAGE_SIZE >= this.failedTotal;
    this.required("[data-batch-count]").textContent =
      `${this.queue.length} 张图片`;
    this.emptyElement.hidden = this.queue.length > 0;
    this.queueElement.innerHTML = this.queue
      .map(
        (item) => `
          <article
            class="batch-file-item"
            data-batch-item
            data-title="${escapeHtml(item.title)}"
            data-status="${item.status}"
          >
            <img src="${escapeHtml(item.previewUrl)}" alt="">
            <div class="batch-file-copy">
              <strong>${escapeHtml(item.file.name)}</strong>
              <label class="batch-title-field">
                <span>标题</span>
                <input
                  type="text"
                  value="${escapeHtml(item.title)}"
                  maxlength="255"
                  data-batch-title="${item.id}"
                  aria-label="${escapeHtml(item.file.name)} 的标题"
                  ${this.locked ? "disabled" : ""}
                >
              </label>
              ${item.error ? `<small>${escapeHtml(item.error)}</small>` : ""}
            </div>
            <span class="batch-status batch-status-${item.status}">${STATUS_LABELS[item.status]}</span>
            <button
              class="icon-button batch-remove"
              type="button"
              data-remove-batch-item="${item.id}"
              aria-label="移除 ${escapeHtml(item.file.name)}"
              ${this.locked ? "disabled" : ""}
            >×</button>
          </article>
        `,
      )
      .join("");
    this.statsElement.textContent = isZip
      ? this.importJob
        ? `${this.importJob.processed_count}/${this.importJob.image_entries} · 成功 ${this.importJob.success_count} · 重复 ${this.importJob.skipped_count} · 失败 ${this.importJob.failed_count}`
        : "等待选择 ZIP"
      : this.queue.length
        ? `${processed}/${this.queue.length} · 成功 ${result.success} · 跳过 ${result.skipped} · 失败 ${result.failed} · 待处理 ${pending + uploading}`
        : "等待添加图片";

    for (const control of this.form.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >('[name="tags"], [name="source"], [name="template_id"], [name="batch_files"], [name="zip_archive"], [name="chunk_size"]')) {
      control.disabled = this.locked;
    }
    this.required<HTMLElement>("[data-batch-drop-zone]").classList.toggle(
      "is-locked",
      this.locked,
    );
    this.clearButton.disabled = this.locked || this.queue.length === 0;
    this.startButton.hidden = isZip && Boolean(this.importJob);
    this.startButton.disabled = isZip
      ? !this.zipFile || this.locked || !this.options.createImportJob
      : this.running || !this.canStart();
    this.startButton.textContent = isZip
      ? "创建导入任务"
      : this.locked && !this.running && pending > 0 ? "继续上传" : "开始上传";
    this.stopButton.hidden = isZip || !this.running;
    this.stopButton.disabled = this.stopRequested;
    this.stopButton.textContent = this.stopRequested
      ? "当前完成后停止…"
      : "停止上传";
    this.retryButton.hidden = isZip || this.running || !this.queue.some((item) => item.status === "failed");
    const cancelImport = this.required<HTMLButtonElement>("[data-cancel-import]");
    cancelImport.hidden = !isZip || !this.importJob || !ACTIVE_IMPORT_STATUSES.has(this.importJob.status);
    cancelImport.disabled = this.importJob?.status === "cancelling";
    const retryImport = this.required<HTMLButtonElement>("[data-retry-import]");
    retryImport.hidden = !isZip || !this.importJob || ACTIVE_IMPORT_STATUSES.has(this.importJob.status) || this.importJob.failed_count === 0;
    const newImport = this.required<HTMLButtonElement>("[data-new-import]");
    newImport.hidden = !isZip || !this.importJob || ACTIVE_IMPORT_STATUSES.has(this.importJob.status);
    newImport.disabled = !this.options.deleteImportJob;
  }
}
