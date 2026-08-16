import { ApiError } from "./api";
import type { MemeResponse, UploadMemeInput } from "./types";

export type MobileIngestStatus =
  | "idle"
  | "selected"
  | "uploading"
  | "success"
  | "partial_failure"
  | "failure";

interface UploadFailure {
  filename: string;
  message: string;
}

export interface MobileIngestSnapshot {
  status: MobileIngestStatus;
  selectedCount: number;
  completedCount: number;
  successCount: number;
  failures: UploadFailure[];
}

interface MobileIngestOptions {
  uploadMeme(input: UploadMemeInput): Promise<MemeResponse>;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing Mobile Ingest element: ${selector}`);
  return element;
}

function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "").trim();
  return (withoutExtension || "未命名 Meme").slice(0, 255);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function failureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return "图片已存在于主库";
    if (error.status === 413) return "文件超过 10 MB 大小限制";
    if (error.status === 415) return "不是有效图片，或格式不受支持";
    return error.message;
  }
  if (error instanceof TypeError) {
    return "无法连接 Meme Vault，请确认手机仍在同一局域网";
  }
  return error instanceof Error ? error.message : "未知上传错误";
}

export class MobileIngestController {
  private files: File[] = [];
  private status: MobileIngestStatus = "idle";
  private completedCount = 0;
  private successCount = 0;
  private failures: UploadFailure[] = [];
  private notice = "";

  private readonly picker: HTMLInputElement;
  private readonly selectedSummary: HTMLElement;
  private readonly fileList: HTMLUListElement;
  private readonly uploadButton: HTMLButtonElement;
  private readonly result: HTMLElement;
  private readonly resultTitle: HTMLElement;
  private readonly resultDetail: HTMLElement;
  private readonly failureList: HTMLUListElement;
  private readonly continueButton: HTMLButtonElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: MobileIngestOptions,
  ) {
    root.innerHTML = `
      <div class="mobile-shell">
        <header class="mobile-header">
          <div class="mobile-mark" aria-hidden="true">MV</div>
          <div>
            <p class="mobile-eyebrow">Meme Vault</p>
            <h1>Mobile Ingest</h1>
            <p class="mobile-subtitle">从手机投喂 Meme 到主库</p>
          </div>
        </header>

        <form class="mobile-card" data-upload-form novalidate>
          <label class="mobile-picker" for="mobile-files">
            <span class="mobile-picker-icon" aria-hidden="true">＋</span>
            <strong>选择图片</strong>
            <span>从相册一次选择多张</span>
          </label>
          <input
            id="mobile-files"
            class="mobile-file-input"
            name="mobile_files"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
            multiple
          >

          <section class="mobile-selection" aria-labelledby="selection-title">
            <div class="mobile-section-heading">
              <h2 id="selection-title">待上传</h2>
              <span data-selected-summary>尚未选择图片</span>
            </div>
            <ul class="mobile-file-list" data-file-list></ul>
          </section>

          <button class="mobile-upload-button" type="submit" data-upload disabled>上传</button>
        </form>

        <section class="mobile-result" data-result aria-live="polite" hidden>
          <h2 data-result-title></h2>
          <p data-result-detail></p>
          <ul class="mobile-failure-list" data-failure-list></ul>
          <button class="mobile-continue-button" type="button" data-continue hidden>继续投喂</button>
        </section>

        <p class="mobile-footnote">仅用于可信局域网 · 单张图片最大 10 MB</p>
      </div>
    `;

    this.picker = required(root, "#mobile-files");
    this.selectedSummary = required(root, "[data-selected-summary]");
    this.fileList = required(root, "[data-file-list]");
    this.uploadButton = required(root, "[data-upload]");
    this.result = required(root, "[data-result]");
    this.resultTitle = required(root, "[data-result-title]");
    this.resultDetail = required(root, "[data-result-detail]");
    this.failureList = required(root, "[data-failure-list]");
    this.continueButton = required(root, "[data-continue]");

    this.picker.addEventListener("change", () => {
      if (this.status === "uploading") return;
      this.selectFiles([...(this.picker.files ?? [])]);
    });
    required<HTMLFormElement>(root, "[data-upload-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.upload();
    });
    this.continueButton.addEventListener("click", () => this.reset());
    this.syncUi();
  }

  snapshot(): MobileIngestSnapshot {
    return {
      status: this.status,
      selectedCount: this.files.length,
      completedCount: this.completedCount,
      successCount: this.successCount,
      failures: this.failures.map((failure) => ({ ...failure })),
    };
  }

  selectFiles(files: File[]): void {
    if (this.status === "uploading") return;
    this.files = files;
    this.status = files.length ? "selected" : "idle";
    this.completedCount = 0;
    this.successCount = 0;
    this.failures = [];
    this.notice = "";
    this.syncUi();
  }

  async upload(): Promise<void> {
    if (this.status === "uploading") return;
    if (!this.files.length) {
      this.notice = "请先从相册选择至少一张图片。";
      this.syncUi();
      return;
    }

    const files = [...this.files];
    this.status = "uploading";
    this.completedCount = 0;
    this.successCount = 0;
    this.failures = [];
    this.notice = "";
    this.syncUi();

    for (const file of files) {
      try {
        await this.options.uploadMeme({
          file,
          title: titleFromFilename(file.name),
          description: "",
          source: "mobile-ingest",
          tags: [],
          template_id: null,
        });
        this.successCount += 1;
      } catch (error) {
        this.failures.push({ filename: file.name, message: failureMessage(error) });
      } finally {
        this.completedCount += 1;
        this.syncUi();
      }
    }

    this.status = this.failures.length === 0
      ? "success"
      : this.successCount > 0
        ? "partial_failure"
        : "failure";
    this.syncUi();
  }

  reset(): void {
    if (this.status === "uploading") return;
    this.picker.value = "";
    this.files = [];
    this.status = "idle";
    this.completedCount = 0;
    this.successCount = 0;
    this.failures = [];
    this.notice = "";
    this.syncUi();
  }

  private syncUi(): void {
    const uploading = this.status === "uploading";
    this.root.setAttribute("aria-busy", String(uploading));
    this.picker.disabled = uploading;
    this.uploadButton.disabled = uploading || this.files.length === 0;
    this.selectedSummary.textContent = this.files.length
      ? `已选择 ${this.files.length} 张图片`
      : "尚未选择图片";

    this.fileList.replaceChildren();
    for (const file of this.files) {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      const size = document.createElement("span");
      name.textContent = file.name;
      size.textContent = formatBytes(file.size);
      item.append(name, size);
      this.fileList.append(item);
    }

    if (uploading) {
      const current = Math.min(this.completedCount + 1, this.files.length);
      this.uploadButton.textContent = `上传中 ${current} / ${this.files.length}`;
    } else {
      this.uploadButton.textContent = this.files.length ? `上传 ${this.files.length} 张图片` : "上传";
    }

    this.renderResult();
  }

  private renderResult(): void {
    const isResult = ["success", "partial_failure", "failure"].includes(this.status);
    this.result.hidden = !(this.status === "uploading" || isResult || Boolean(this.notice));
    this.result.dataset.status = this.status;
    this.failureList.replaceChildren();
    this.continueButton.hidden = !isResult;

    if (this.notice) {
      this.resultTitle.textContent = "还没有可上传的图片";
      this.resultDetail.textContent = this.notice;
      return;
    }
    if (this.status === "uploading") {
      this.resultTitle.textContent = "正在上传…";
      this.resultDetail.textContent = `已处理 ${this.completedCount} / ${this.files.length} 张，请保持页面开启。`;
      return;
    }
    if (this.status === "success") {
      this.resultTitle.textContent = `✓ ${this.successCount} 张 Meme 已入库`;
      this.resultDetail.textContent = "电脑端刷新主库后即可看到。";
      return;
    }
    if (this.status === "partial_failure") {
      this.resultTitle.textContent = "部分图片未能入库";
      this.resultDetail.textContent = `成功 ${this.successCount} 张，失败 ${this.failures.length} 张。`;
    } else if (this.status === "failure") {
      this.resultTitle.textContent = "本轮上传失败";
      this.resultDetail.textContent = `成功 0 张，失败 ${this.failures.length} 张。`;
    } else {
      this.resultTitle.textContent = "";
      this.resultDetail.textContent = "";
      return;
    }

    for (const failure of this.failures) {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      const message = document.createElement("span");
      name.textContent = failure.filename;
      message.textContent = failure.message;
      item.append(name, message);
      this.failureList.append(item);
    }
  }
}
