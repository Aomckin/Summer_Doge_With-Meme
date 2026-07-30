import { ApiError, parseTagInput } from "./api";
import type {
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
  onComplete(result: BatchUploadResult): Promise<void> | void;
  confirmClose?: (message: string) => boolean;
}

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

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

        <div class="batch-upload-layout">
          <section class="batch-files-panel" aria-label="待上传图片">
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
  }

  open(templates: TemplateResponse[]): void {
    if (this.running) {
      return;
    }
    this.reset();
    this.setTemplates(templates);
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
      void this.runQueue();
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
    this.statsElement.textContent = this.queue.length
      ? `${processed}/${this.queue.length} · 成功 ${result.success} · 跳过 ${result.skipped} · 失败 ${result.failed} · 待处理 ${pending + uploading}`
      : "等待添加图片";

    for (const control of this.form.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >('[name="tags"], [name="source"], [name="template_id"], [name="batch_files"]')) {
      control.disabled = this.locked;
    }
    this.required<HTMLElement>("[data-batch-drop-zone]").classList.toggle(
      "is-locked",
      this.locked,
    );
    this.clearButton.disabled = this.locked || this.queue.length === 0;
    this.startButton.disabled =
      this.running ||
      !this.canStart();
    this.startButton.textContent =
      this.locked && !this.running && pending > 0 ? "继续上传" : "开始上传";
    this.stopButton.hidden = !this.running;
    this.stopButton.disabled = this.stopRequested;
    this.stopButton.textContent = this.stopRequested
      ? "当前完成后停止…"
      : "停止上传";
    this.retryButton.hidden =
      this.running || !this.queue.some((item) => item.status === "failed");
  }
}
