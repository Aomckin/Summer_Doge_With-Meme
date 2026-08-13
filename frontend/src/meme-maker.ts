import { ApiError } from "./api";
import {
  renderMemeCanvas,
  type MemeColor,
  type MemeTextBox,
  type TextBoxMeasurement,
} from "./meme-renderer";
import {
  beginInteraction,
  clientToCanvasPoint,
  hitTestTextBoxes,
  IDLE_INTERACTION,
  updateInteraction,
  type InteractionState,
} from "./meme-maker-interaction";
import type { MemeResponse, TemplateResponse, UploadMemeInput } from "./types";
import { MemeMakerHistory, type MemeMakerHistoryState } from "./meme-maker-history";

interface LoadedTemplateImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose(): void;
}

type MakerBackground =
  | { type: "template"; templateId: number; name: string }
  | { type: "local"; file: File; name: string };

export interface MemeMakerApi {
  listTemplates(): Promise<TemplateResponse[]>;
  uploadMeme(input: UploadMemeInput): Promise<MemeResponse>;
}

export interface MemeMakerOptions {
  onSaved?(meme: MemeResponse): void | Promise<void>;
  loadImage?(url: string): Promise<LoadedTemplateImage>;
  scheduleFrame?(callback: FrameRequestCallback): number;
  cancelFrame?(id: number): void;
}

const staticMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_TEXT_BOXES = 20;

async function loadTemplateImage(url: string): Promise<LoadedTemplateImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("模板图片解码失败"));
      image.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("模板图片尺寸无效");
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function safeFilename(name: string): string {
  const clean = name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/gu, "").trim().replace(/\s+/gu, "-");
  return `${clean || "meme"}-meme.png`;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas toBlob returned null")), "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

let nextTextBoxId = 0;
function createTextBox(fontSize: number, yPercent = 50): MemeTextBox {
  nextTextBoxId += 1;
  return {
    id: `text-box-${nextTextBoxId}`,
    text: "",
    xPercent: 50,
    yPercent,
    widthPercent: yPercent === 15 ? 70 : 60,
    fontSize,
    fillColor: "white",
    strokeWidth: 3,
    strokeColor: "black",
    align: "center",
    fontPreset: "classic",
  };
}

export class MemeMakerController {
  private readonly dialog: HTMLDialogElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly templateSelect: HTMLSelectElement;
  private readonly list: HTMLElement;
  private readonly properties: HTMLFieldSetElement;
  private readonly notice: HTMLElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private templates: TemplateResponse[] = [];
  private image: LoadedTemplateImage | null = null;
  private background: MakerBackground | null = null;
  private textBoxes: MemeTextBox[] = [];
  private selectedTextBoxId: string | null = null;
  private measurements = new Map<string, TextBoxMeasurement>();
  private interaction: InteractionState = IDLE_INTERACTION;
  private loadGeneration = 0;
  private renderFrame: number | null = null;
  private busy = false;
  private defaultFontSize = 56;
  private readonly history = new MemeMakerHistory();
  private pendingHistory: MemeMakerHistoryState | null = null;
  private snapGuideX = false;
  private snapGuideY = false;
  private readonly loadImage: (url: string) => Promise<LoadedTemplateImage>;
  private readonly scheduleFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (id: number) => void;

  constructor(
    private readonly trigger: HTMLButtonElement,
    private readonly api: MemeMakerApi,
    private readonly options: MemeMakerOptions = {},
  ) {
    this.loadImage = options.loadImage ?? loadTemplateImage;
    this.scheduleFrame = options.scheduleFrame ?? (callback => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? (id => cancelAnimationFrame(id));
    this.dialog = document.createElement("dialog");
    this.dialog.className = "modal meme-maker-dialog";
    this.dialog.dataset.memeMakerDialog = "";
    this.dialog.setAttribute("aria-labelledby", "meme-maker-title");
    this.dialog.innerHTML = `
      <form class="modal-card meme-maker-card" data-maker-form method="dialog">
        <header class="modal-heading meme-maker-heading">
          <div><p class="eyebrow">MEME FORGE</p><h2 id="meme-maker-title">Meme 制作器</h2></div>
          <div class="meme-maker-history-actions">
            <button class="button button-secondary" type="button" data-undo title="撤销 Ctrl+Z">撤销</button>
            <button class="button button-secondary" type="button" data-redo title="重做 Ctrl+Y">重做</button>
            <button class="icon-button" type="button" data-close-maker aria-label="关闭 Meme 制作器">×</button>
          </div>
        </header>
        <div class="meme-maker-layout">
          <div class="meme-maker-controls">
            <fieldset class="background-source"><legend>底图来源</legend>
              <div class="maker-choice-row"><label><input name="background_type" type="radio" value="template" checked> 使用模板</label><label><input name="background_type" type="radio" value="local"> 本地图片</label></div>
              <label data-template-source><span>模板</span><select name="template_id"><option value="">正在加载模板…</option></select></label>
              <label data-local-source hidden><span>本地图片</span><input name="local_image" type="file" accept="image/png,image/jpeg,image/webp"></label>
            </fieldset>
            <section class="text-box-manager" aria-labelledby="text-box-list-title">
              <div class="text-box-manager-heading"><strong id="text-box-list-title">文本框</strong><span data-box-count>0 / ${MAX_TEXT_BOXES}</span></div>
              <div class="text-box-list" data-text-box-list role="listbox" aria-label="文本框列表"></div>
              <div class="text-box-actions">
                <button class="button button-secondary" type="button" data-add-text-box>+ 添加文本框</button>
                <button class="button button-ghost" type="button" data-delete-text-box>删除当前文本框</button>
              </div>
            </section>
            <fieldset class="text-box-properties" data-text-box-properties disabled>
              <legend>当前文本框属性</legend>
              <label><span>文字</span><textarea name="box_text" maxlength="500" rows="4"></textarea></label>
              ${this.rangeMarkup("box_font_size", "字号", 12, 300, "px")}
              ${this.rangeMarkup("box_x", "X", 0, 100, "%")}
              ${this.rangeMarkup("box_y", "Y", 0, 100, "%")}
              ${this.rangeMarkup("box_width", "宽度", 10, 100, "%")}
              ${this.rangeMarkup("box_stroke", "描边", 0, 12, "px")}
              <label><span>文字颜色</span><select name="box_fill_color"><option value="white">白</option><option value="black">黑</option></select></label>
              <label><span>描边颜色</span><select name="box_stroke_color"><option value="black">黑</option><option value="white">白</option></select></label>
              <label><span>对齐</span><select name="box_align"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
              <label><span>字体</span><select name="box_font_preset"><option value="classic">经典 Meme</option><option value="chinese-bold">中文粗体</option><option value="sans">常规无衬线</option></select></label>
              <div class="text-box-property-actions">
                <button class="button button-secondary" type="button" data-clone-text-box>复制文本框</button>
                <button class="button button-secondary" type="button" data-layer-down>下移一层</button>
                <button class="button button-secondary" type="button" data-layer-up>上移一层</button>
                <button class="button button-ghost" type="button" data-reset-text-style>重置样式</button>
              </div>
            </fieldset>
          </div>
          <section class="meme-maker-preview" aria-label="Meme 预览">
            <div class="meme-maker-canvas-frame">
              <div class="meme-maker-canvas-stage" data-canvas-stage hidden>
                <canvas data-maker-canvas aria-label="Meme Canvas 预览"></canvas>
                <div class="meme-maker-overlay" data-maker-overlay aria-label="文本框交互层"></div>
              </div>
              <p data-preview-placeholder>请选择一个静态参考图模板</p>
            </div>
            <small data-resolution>导出将保留模板参考图的原始分辨率</small>
            <small>拖动文本框调整位置；左右控制点调整宽度；方向键微调，Shift + 方向键快速移动。</small>
          </section>
        </div>
        <div class="meme-maker-output">
          <label><span>Meme 标题</span><input name="title" type="text" maxlength="255" required></label>
          <p class="meme-maker-notice" data-maker-notice role="status" aria-live="polite"></p>
          <div class="modal-actions">
            <button class="button button-secondary" type="button" data-export-maker>导出 PNG</button>
            <button class="button button-primary" type="button" data-save-maker>保存到 Meme Vault</button>
          </div>
        </div>
      </form>`;
    document.body.append(this.dialog);
    this.form = this.required("[data-maker-form]");
    this.canvas = this.required("[data-maker-canvas]");
    this.overlay = this.required("[data-maker-overlay]");
    this.templateSelect = this.required('[name="template_id"]');
    this.list = this.required("[data-text-box-list]");
    this.properties = this.required("[data-text-box-properties]");
    this.notice = this.required("[data-maker-notice]");
    this.exportButton = this.required("[data-export-maker]");
    this.saveButton = this.required("[data-save-maker]");
    this.bindEvents();
    this.updateUi();
  }

  private rangeMarkup(name: string, label: string, min: number, max: number, unit: string): string {
    const step = name === "box_x" || name === "box_y" || name === "box_width" ? ".1" : "1";
    return `<label class="maker-range-control"><span>${label} <output data-output="${name}">0${unit}</output></span><div><input name="${name}" type="range" min="${min}" max="${max}" step="${step}"><input name="${name}_number" type="number" min="${min}" max="${max}" step="${step}" aria-label="${label}精确值"></div></label>`;
  }

  open(): void { this.reset(); this.dialog.showModal(); void this.loadTemplates(); }

  close(): void {
    this.loadGeneration += 1;
    this.releaseImage();
    if (this.renderFrame !== null) this.cancelFrame(this.renderFrame);
    this.renderFrame = null;
    this.interaction = IDLE_INTERACTION;
    this.history.clear(); this.pendingHistory = null; this.snapGuideX = false; this.snapGuideY = false;
    if (this.dialog.open) this.dialog.close();
  }

  private bindEvents(): void {
    this.trigger.addEventListener("click", () => this.open());
    this.dialog.querySelector("[data-close-maker]")?.addEventListener("click", () => this.close());
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener("click", event => { if (event.target === this.dialog) this.close(); });
    this.templateSelect.addEventListener("change", () => void this.selectTemplate());
    for (const input of this.dialog.querySelectorAll<HTMLInputElement>('[name="background_type"]')) {
      input.addEventListener("change", () => this.switchBackgroundSource());
    }
    this.dialog.querySelector<HTMLInputElement>('[name="local_image"]')?.addEventListener("change", event => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (file) void this.selectLocalImage(file);
    });
    this.dialog.querySelector("[data-add-text-box]")?.addEventListener("click", () => this.addTextBox());
    this.dialog.querySelector("[data-delete-text-box]")?.addEventListener("click", () => this.deleteSelectedTextBox());
    this.dialog.querySelector("[data-clone-text-box]")?.addEventListener("click", () => this.cloneSelectedTextBox());
    this.dialog.querySelector("[data-layer-up]")?.addEventListener("click", () => this.moveSelectedLayer(1));
    this.dialog.querySelector("[data-layer-down]")?.addEventListener("click", () => this.moveSelectedLayer(-1));
    this.dialog.querySelector("[data-reset-text-style]")?.addEventListener("click", () => this.resetSelectedStyle());
    this.dialog.querySelector("[data-undo]")?.addEventListener("click", () => this.undo());
    this.dialog.querySelector("[data-redo]")?.addEventListener("click", () => this.redo());
    this.list.addEventListener("click", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-text-box-id]");
      if (button?.dataset.textBoxId) this.selectTextBox(button.dataset.textBoxId);
    });
    this.properties.addEventListener("focusin", event => this.beginControlHistory(event.target));
    this.properties.addEventListener("input", event => this.updateSelectedFromForm(event.target));
    this.properties.addEventListener("change", event => { this.updateSelectedFromForm(event.target, true); });
    this.properties.addEventListener("focusout", event => this.commitControlHistory(event.target));
    const title = this.form.elements.namedItem("title");
    if (title instanceof HTMLInputElement) {
      title.addEventListener("focus", () => this.beginHistory());
      title.addEventListener("blur", () => this.commitHistory());
    }
    this.overlay.addEventListener("pointerdown", event => this.pointerDown(event));
    this.overlay.addEventListener("pointermove", event => this.pointerMove(event));
    this.overlay.addEventListener("pointerup", event => this.pointerUp(event));
    this.overlay.addEventListener("pointercancel", event => this.pointerUp(event));
    this.dialog.addEventListener("keydown", event => this.handleShortcut(event));
    this.exportButton.addEventListener("click", () => void this.exportPng());
    this.saveButton.addEventListener("click", () => void this.save());
  }

  private async loadTemplates(): Promise<void> {
    this.setNotice("正在加载模板…");
    try {
      this.templates = await this.api.listTemplates();
      if (!this.dialog.open) return;
      this.templateSelect.replaceChildren(new Option("请选择模板", ""));
      for (const template of this.templates) {
        const option = new Option(template.name, String(template.id));
        if (!template.reference_image_url) { option.text = `${template.name}（无参考图）`; option.disabled = true; }
        else if (template.reference_mime_type === "image/gif") { option.text = `${template.name}（GIF 模板暂不支持制作）`; option.disabled = true; }
        else if (!template.reference_mime_type || !staticMimeTypes.has(template.reference_mime_type)) { option.text = `${template.name}（参考图格式不支持）`; option.disabled = true; }
        this.templateSelect.add(option);
      }
      this.setNotice(this.templates.length ? "请选择模板开始制作。" : "还没有可用模板。");
    } catch (error) {
      this.setNotice(this.errorMessage(error, "模板加载失败，请稍后重试。"), true);
      this.templateSelect.innerHTML = '<option value="">模板加载失败</option>';
    }
  }

  private async selectTemplate(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.releaseImage();
    const template = this.selectedTemplate();
    if (!template?.reference_image_url) { this.updatePreview(false); this.updateUi(); return; }
    this.setNotice("正在加载模板参考图…");
    this.updateUi();
    try {
      const loaded = await this.loadImage(template.reference_image_url);
      if (generation !== this.loadGeneration || !this.dialog.open) { loaded.dispose(); return; }
      this.image = loaded;
      this.background = { type: "template", templateId: template.id, name: template.name };
      this.defaultFontSize = Math.min(300, Math.max(12, Math.round(loaded.width * 0.09)));
      if (!this.textBoxes.length) {
        const initial = createTextBox(this.defaultFontSize, 15);
        this.textBoxes = [initial];
        this.selectedTextBoxId = initial.id;
      }
      this.setInput("title", `${template.name} 自制`);
      this.updatePreview(true);
      this.renderNow();
      this.setNotice("模板已加载。拖动画布上的文本框进行排版。", false);
    } catch {
      if (generation !== this.loadGeneration) return;
      this.setNotice("模板图片加载失败，请换一个模板后重试。", true);
      this.updatePreview(false);
    }
    this.updateUi();
  }

  private switchBackgroundSource(): void {
    const local = this.dialog.querySelector<HTMLInputElement>('[name="background_type"]:checked')?.value === "local";
    this.required<HTMLElement>("[data-template-source]").hidden = local;
    this.required<HTMLElement>("[data-local-source]").hidden = !local;
    if (local) {
      this.loadGeneration += 1;
      this.releaseImage(); this.background = null; this.updatePreview(false); this.updateUi();
      this.setNotice("请选择 PNG、JPEG 或 WEBP 本地图片。", false);
    } else {
      const localInput = this.dialog.querySelector<HTMLInputElement>('[name="local_image"]');
      if (localInput) localInput.value = "";
      this.loadGeneration += 1;
      this.releaseImage(); this.background = null; this.updatePreview(false); this.updateUi();
      if (this.templateSelect.value) void this.selectTemplate();
      else this.setNotice("请选择模板开始制作。", false);
    }
  }

  private async selectLocalImage(file: File): Promise<void> {
    if (file.type === "image/gif") { this.setNotice("GIF 底图暂不支持制作。", true); return; }
    if (!staticMimeTypes.has(file.type)) { this.setNotice("请选择 PNG、JPEG 或 WEBP 图片。", true); return; }
    const generation = ++this.loadGeneration;
    this.releaseImage(); this.background = null; this.updatePreview(false); this.updateUi();
    const objectUrl = URL.createObjectURL(file);
    try {
      const loaded = await this.loadImage(objectUrl);
      if (generation !== this.loadGeneration || !this.dialog.open) { loaded.dispose(); URL.revokeObjectURL(objectUrl); return; }
      this.image = {
        ...loaded,
        dispose: () => { loaded.dispose(); URL.revokeObjectURL(objectUrl); },
      };
      this.background = { type: "local", file, name: file.name.replace(/\.[^.]+$/u, "") || "meme" };
      this.defaultFontSize = Math.min(300, Math.max(12, Math.round(loaded.width * 0.09)));
      if (!this.textBoxes.length) {
        const initial = createTextBox(this.defaultFontSize, 15); this.textBoxes = [initial]; this.selectedTextBoxId = initial.id;
      }
      if (!this.inputValue("title").trim()) this.setInput("title", `${this.background.name} 自制`);
      this.updatePreview(true); this.renderNow(); this.updateUi(); this.setNotice("本地底图已加载，仅最终 PNG 会在保存时上传。", false);
    } catch {
      URL.revokeObjectURL(objectUrl);
      if (generation === this.loadGeneration) this.setNotice("本地图片加载失败，请换一张图片。", true);
    }
  }

  private addTextBox(): void {
    if (!this.image) { this.setNotice("请先选择一个可制作的模板。", true); return; }
    if (this.textBoxes.length >= MAX_TEXT_BOXES) { this.setNotice(`最多添加 ${MAX_TEXT_BOXES} 个文本框。`, true); return; }
    const before = this.captureHistory();
    const box = createTextBox(this.defaultFontSize);
    this.textBoxes.push(box);
    this.selectedTextBoxId = box.id;
    this.updateUi();
    this.scheduleRender(); this.history.record(before, this.captureHistory()); this.updateHistoryActions();
  }

  private cloneSelectedTextBox(): void {
    const source = this.selectedTextBox();
    if (!source) return;
    if (this.textBoxes.length >= MAX_TEXT_BOXES) { this.setNotice(`最多添加 ${MAX_TEXT_BOXES} 个文本框。`, true); return; }
    const before = this.captureHistory();
    const clone = createTextBox(source.fontSize);
    Object.assign(clone, source, {
      id: clone.id,
      xPercent: Math.min(100 - source.widthPercent / 2, Math.max(source.widthPercent / 2, source.xPercent + 3)),
      yPercent: Math.min(100, source.yPercent + 3),
    });
    this.textBoxes.push(clone);
    this.selectedTextBoxId = clone.id;
    this.updateUi(); this.scheduleRender(); this.history.record(before, this.captureHistory()); this.updateHistoryActions();
  }

  private moveSelectedLayer(direction: -1 | 1): void {
    const index = this.textBoxes.findIndex(box => box.id === this.selectedTextBoxId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= this.textBoxes.length) return;
    const before = this.captureHistory();
    [this.textBoxes[index], this.textBoxes[next]] = [this.textBoxes[next], this.textBoxes[index]];
    this.updateUi(); this.scheduleRender(); this.history.record(before, this.captureHistory()); this.updateHistoryActions();
  }

  private resetSelectedStyle(): void {
    const box = this.selectedTextBox();
    if (!box) return;
    const before = this.captureHistory();
    Object.assign(box, { fontSize: this.defaultFontSize, fillColor: "white", strokeColor: "black", strokeWidth: 3, align: "center", fontPreset: "classic" });
    this.updateUi(); this.scheduleRender(); this.history.record(before, this.captureHistory()); this.updateHistoryActions();
  }

  private deleteSelectedTextBox(): void {
    const index = this.textBoxes.findIndex(box => box.id === this.selectedTextBoxId);
    if (index < 0) return;
    const before = this.captureHistory();
    this.textBoxes.splice(index, 1);
    this.selectedTextBoxId = this.textBoxes[Math.min(index, this.textBoxes.length - 1)]?.id ?? null;
    this.updateUi();
    this.scheduleRender(); this.history.record(before, this.captureHistory()); this.updateHistoryActions();
  }

  private selectTextBox(id: string | null): void {
    this.selectedTextBoxId = id && this.textBoxes.some(box => box.id === id) ? id : null;
    this.updateUi();
    this.updateOverlay();
  }

  private updateSelectedFromForm(target?: EventTarget | null, commit = false): void {
    const box = this.selectedTextBox();
    if (!box) return;
    if (target instanceof HTMLInputElement && target.type === "number") {
      if (target.value.trim() === "" || !Number.isFinite(Number(target.value))) return;
      const rangeName = target.name.replace(/_number$/u, "");
      const range = this.form.elements.namedItem(rangeName);
      if (range instanceof HTMLInputElement && target.value !== "") range.value = target.value;
    }
    box.text = this.inputValue("box_text");
    box.fontSize = this.numberInput("box_font_size", 12, 300);
    box.yPercent = this.numberInput("box_y", 0, 100);
    box.widthPercent = this.numberInput("box_width", 10, 100);
    const halfWidth = box.widthPercent / 2;
    box.xPercent = Math.min(100 - halfWidth, Math.max(halfWidth, this.numberInput("box_x", 0, 100)));
    box.strokeWidth = this.numberInput("box_stroke", 0, 12);
    box.fillColor = this.colorInput("box_fill_color", "white");
    box.strokeColor = this.colorInput("box_stroke_color", "black");
    const align = this.inputValue("box_align");
    box.align = align === "left" || align === "right" ? align : "center";
    const fontPreset = this.inputValue("box_font_preset");
    box.fontPreset = fontPreset === "chinese-bold" || fontPreset === "sans" ? fontPreset : "classic";
    this.updateUi();
    this.scheduleRender();
    if (commit) this.commitHistory();
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.image) return;
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>("[data-resize-handle]");
    const point = this.eventPoint(event);
    const id = handle
      ? target.closest<HTMLElement>("[data-selected-box]")?.dataset.selectedBox ?? null
      : hitTestTextBoxes(this.textBoxes, this.measurements, point);
    if (!id) { this.selectTextBox(null); return; }
    this.selectTextBox(id);
    const box = this.selectedTextBox();
    if (!box) return;
    this.beginHistory();
    const type = handle?.dataset.resizeHandle === "left" ? "resizing-left"
      : handle?.dataset.resizeHandle === "right" ? "resizing-right" : "dragging";
    this.interaction = beginInteraction(type, box, point);
    this.overlay.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  private pointerMove(event: PointerEvent): void {
    if (!this.image || this.interaction.type === "idle") return;
    const updated = updateInteraction(this.interaction, this.eventPoint(event), this.image.width, this.image.height);
    const index = updated ? this.textBoxes.findIndex(box => box.id === updated.id) : -1;
    if (updated && index >= 0) {
      this.textBoxes[index] = updated;
      this.snapGuideX = this.interaction.type === "dragging" && updated.xPercent === 50;
      this.snapGuideY = this.interaction.type === "dragging" && updated.yPercent === 50;
      this.updateUi();
      this.scheduleRender();
    }
    event.preventDefault();
  }

  private pointerUp(event: PointerEvent): void {
    if (this.interaction.type === "idle") return;
    this.interaction = IDLE_INTERACTION;
    this.snapGuideX = false; this.snapGuideY = false; this.commitHistory(); this.updateOverlay();
    this.overlay.releasePointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  private handleShortcut(event: KeyboardEvent): void {
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
    if (editing) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); return;
    }
    if (modifier && event.key.toLowerCase() === "y") { event.preventDefault(); this.redo(); return; }
    if (modifier && event.key.toLowerCase() === "d") { event.preventDefault(); this.cloneSelectedTextBox(); return; }
    if (event.key === "Delete") { event.preventDefault(); this.deleteSelectedTextBox(); return; }
    if (event.key === "Escape" && this.selectedTextBoxId) { event.preventDefault(); event.stopPropagation(); this.selectTextBox(null); return; }
    const box = this.selectedTextBox();
    if (!box || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (event.repeat) { event.preventDefault(); return; }
    const before = this.captureHistory();
    const step = event.shiftKey ? 2 : 0.5;
    const halfWidth = box.widthPercent / 2;
    if (event.key === "ArrowLeft") box.xPercent = Math.max(halfWidth, box.xPercent - step);
    if (event.key === "ArrowRight") box.xPercent = Math.min(100 - halfWidth, box.xPercent + step);
    if (event.key === "ArrowUp") box.yPercent = Math.max(0, box.yPercent - step);
    if (event.key === "ArrowDown") box.yPercent = Math.min(100, box.yPercent + step);
    event.preventDefault(); this.updateUi(); this.scheduleRender(); this.history.record(before, this.captureHistory()); this.updateHistoryActions();
  }

  private eventPoint(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return clientToCanvasPoint(event.clientX, event.clientY, rect, this.canvas.width, this.canvas.height);
  }

  private scheduleRender(): void {
    if (!this.image || this.renderFrame !== null) return;
    this.renderFrame = this.scheduleFrame(() => { this.renderFrame = null; this.renderNow(); });
  }

  private renderNow(): boolean {
    if (!this.image) return false;
    try {
      this.measurements = renderMemeCanvas(this.canvas, this.image.source, this.textBoxes, this.image.width, this.image.height);
      this.required("[data-resolution]").textContent = `${this.image.width} × ${this.image.height} PNG`;
      this.updateOverlay();
      return true;
    } catch {
      this.setNotice("Canvas 渲染失败，请换一个尺寸较小的模板。", true);
      this.releaseImage(); this.updatePreview(false); this.updateUi();
      return false;
    }
  }

  private updateOverlay(): void {
    this.overlay.replaceChildren();
    if (this.snapGuideX) {
      const guide = document.createElement("div"); guide.className = "meme-snap-guide is-vertical"; guide.dataset.snapGuideX = ""; this.overlay.append(guide);
    }
    if (this.snapGuideY) {
      const guide = document.createElement("div"); guide.className = "meme-snap-guide is-horizontal"; guide.dataset.snapGuideY = ""; this.overlay.append(guide);
    }
    if (!this.image || !this.selectedTextBoxId) return;
    const bounds = this.measurements.get(this.selectedTextBoxId)?.bounds;
    if (!bounds) return;
    const selection = document.createElement("div");
    selection.className = "meme-text-box-selection";
    selection.dataset.selectedBox = this.selectedTextBoxId;
    selection.style.left = `${bounds.left / this.image.width * 100}%`;
    selection.style.top = `${bounds.top / this.image.height * 100}%`;
    selection.style.width = `${bounds.width / this.image.width * 100}%`;
    selection.style.height = `${bounds.height / this.image.height * 100}%`;
    for (const side of ["left", "right"] as const) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `meme-text-box-handle is-${side}`;
      handle.dataset.resizeHandle = side;
      handle.setAttribute("aria-label", `${side === "left" ? "左" : "右"}侧调整文本框宽度`);
      selection.append(handle);
    }
    this.overlay.append(selection);
  }

  private updateUi(): void {
    this.renderList();
    const box = this.selectedTextBox();
    this.properties.disabled = !box;
    if (box) {
      this.setInput("box_text", box.text);
      this.setInput("box_font_size", box.fontSize);
      this.setInput("box_x", this.displayPercent(box.xPercent));
      this.setInput("box_y", this.displayPercent(box.yPercent));
      this.setInput("box_width", this.displayPercent(box.widthPercent));
      this.setInput("box_stroke", box.strokeWidth);
      this.setInput("box_font_size_number", box.fontSize);
      this.setInput("box_x_number", this.displayPercent(box.xPercent));
      this.setInput("box_y_number", this.displayPercent(box.yPercent));
      this.setInput("box_width_number", this.displayPercent(box.widthPercent));
      this.setInput("box_stroke_number", box.strokeWidth);
      this.setInput("box_fill_color", box.fillColor);
      this.setInput("box_stroke_color", box.strokeColor);
      this.setInput("box_align", box.align);
      this.setInput("box_font_preset", box.fontPreset);
      this.setOutput("box_font_size", `${Math.round(box.fontSize)}px`);
      this.setOutput("box_x", `${this.displayPercent(box.xPercent)}%`);
      this.setOutput("box_y", `${this.displayPercent(box.yPercent)}%`);
      this.setOutput("box_width", `${this.displayPercent(box.widthPercent)}%`);
      this.setOutput("box_stroke", `${Math.round(box.strokeWidth)}px`);
    }
    const ready = Boolean(this.image) && !this.busy;
    this.exportButton.disabled = !ready;
    this.saveButton.disabled = !ready;
    this.saveButton.textContent = this.busy ? "正在保存…" : "保存到 Meme Vault";
    const add = this.dialog.querySelector<HTMLButtonElement>("[data-add-text-box]");
    const remove = this.dialog.querySelector<HTMLButtonElement>("[data-delete-text-box]");
    if (add) add.disabled = !this.image || this.textBoxes.length >= MAX_TEXT_BOXES;
    if (remove) remove.disabled = !box;
    const index = this.textBoxes.findIndex(item => item.id === this.selectedTextBoxId);
    const clone = this.dialog.querySelector<HTMLButtonElement>("[data-clone-text-box]");
    const up = this.dialog.querySelector<HTMLButtonElement>("[data-layer-up]");
    const down = this.dialog.querySelector<HTMLButtonElement>("[data-layer-down]");
    if (clone) clone.disabled = !box || this.textBoxes.length >= MAX_TEXT_BOXES;
    if (up) up.disabled = index < 0 || index === this.textBoxes.length - 1;
    if (down) down.disabled = index <= 0;
    this.updateHistoryActions();
  }

  private renderList(): void {
    this.list.replaceChildren();
    this.textBoxes.forEach((box, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.textBoxId = box.id;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(box.id === this.selectedTextBoxId));
      button.className = box.id === this.selectedTextBoxId ? "is-selected" : "";
      const summary = box.text.trim().replace(/\s+/gu, " ").slice(0, 28) || "[空文本框]";
      button.textContent = `${index + 1}. ${summary}`;
      this.list.append(button);
    });
    if (!this.textBoxes.length) {
      const empty = document.createElement("p"); empty.textContent = "还没有文本框"; this.list.append(empty);
    }
    this.required("[data-box-count]").textContent = `${this.textBoxes.length} / ${MAX_TEXT_BOXES}`;
  }

  private captureHistory(): MemeMakerHistoryState {
    return { textBoxes: this.textBoxes.map(box => ({ ...box })), selectedTextBoxId: this.selectedTextBoxId, title: this.inputValue("title") };
  }

  private restoreHistory(state: MemeMakerHistoryState): void {
    this.textBoxes = state.textBoxes.map(box => ({ ...box }));
    this.selectedTextBoxId = state.selectedTextBoxId && this.textBoxes.some(box => box.id === state.selectedTextBoxId) ? state.selectedTextBoxId : null;
    this.setInput("title", state.title);
    this.pendingHistory = null; this.snapGuideX = false; this.snapGuideY = false;
    this.updateUi(); this.scheduleRender();
  }

  private beginHistory(): void { if (!this.pendingHistory) this.pendingHistory = this.captureHistory(); }

  private commitHistory(): void {
    if (!this.pendingHistory) return;
    this.history.record(this.pendingHistory, this.captureHistory());
    this.pendingHistory = null; this.updateHistoryActions();
  }

  private beginControlHistory(target: EventTarget | null): void {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) this.beginHistory();
  }

  private commitControlHistory(target: EventTarget | null): void {
    if (target instanceof HTMLInputElement && target.type === "number") {
      const range = this.form.elements.namedItem(target.name.replace(/_number$/u, ""));
      if (range instanceof HTMLInputElement) {
        const min = Number(range.min); const max = Number(range.max); const parsed = Number(target.value);
        const value = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : Number(range.value);
        range.value = String(value); target.value = String(value); this.updateSelectedFromForm(range);
      }
    }
    this.commitHistory();
  }

  private undo(): void { const state = this.history.undo(this.captureHistory()); if (state) this.restoreHistory(state); this.updateHistoryActions(); }
  private redo(): void { const state = this.history.redo(this.captureHistory()); if (state) this.restoreHistory(state); this.updateHistoryActions(); }
  private updateHistoryActions(): void {
    const undo = this.dialog.querySelector<HTMLButtonElement>("[data-undo]"); const redo = this.dialog.querySelector<HTMLButtonElement>("[data-redo]");
    if (undo) undo.disabled = !this.history.canUndo; if (redo) redo.disabled = !this.history.canRedo;
  }

  private async exportPng(): Promise<void> {
    if (!this.validateOutput(false) || !this.renderNow()) return;
    try {
      const blob = await canvasBlob(this.canvas);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = safeFilename(this.background?.name ?? "meme"); anchor.click();
      URL.revokeObjectURL(url); this.setNotice("PNG 已导出。", false);
    } catch { this.setNotice("图片导出失败，请检查模板图片是否可以正常读取。", true); }
  }

  private async save(): Promise<void> {
    if (!this.validateOutput(true)) return;
    if (!this.background) return;
    this.busy = true; this.updateUi(); this.setNotice("正在保存到 Meme Vault…");
    if (!this.renderNow()) { this.busy = false; this.updateUi(); return; }
    try {
      const blob = await canvasBlob(this.canvas);
      const file = new File([blob], safeFilename(this.background.name), { type: "image/png" });
      const meme = await this.api.uploadMeme({
        file, title: this.inputValue("title").trim(), description: "", source: "meme-maker", tags: [],
        template_id: this.background.type === "template" ? this.background.templateId : null,
      });
      this.setNotice(`已保存为 Meme #${meme.id}`, false);
      try { await this.options.onSaved?.(meme); } catch { /* Upload already succeeded. */ }
    } catch (error) { this.setNotice(this.errorMessage(error, "保存失败，请稍后重试。"), true); }
    finally { this.busy = false; this.updateUi(); }
  }

  private validateOutput(requireTitle: boolean): boolean {
    if (!this.image || !this.background) { this.setNotice("请先选择模板或本地底图。", true); return false; }
    if (!this.textBoxes.some(box => box.text.trim())) { this.setNotice("至少输入一段文字后再导出或保存。", true); return false; }
    if (requireTitle && !this.inputValue("title").trim()) { this.setNotice("请输入 Meme 标题后再保存。", true); return false; }
    return true;
  }

  private reset(): void {
    this.loadGeneration += 1; this.releaseImage(); this.form.reset();
    this.textBoxes = []; this.selectedTextBoxId = null; this.measurements.clear(); this.interaction = IDLE_INTERACTION; this.background = null;
    this.history.clear(); this.pendingHistory = null; this.snapGuideX = false; this.snapGuideY = false;
    this.templateSelect.innerHTML = '<option value="">正在加载模板…</option>';
    this.canvas.width = 0; this.canvas.height = 0; this.updatePreview(false); this.setNotice(""); this.busy = false; this.updateUi();
  }

  private updatePreview(ready: boolean): void {
    this.required<HTMLElement>("[data-canvas-stage]").hidden = !ready;
    this.required<HTMLElement>("[data-preview-placeholder]").hidden = ready;
    if (!ready) { this.overlay.replaceChildren(); this.required("[data-resolution]").textContent = "导出将保留模板参考图的原始分辨率"; }
  }

  private selectedTextBox(): MemeTextBox | undefined { return this.textBoxes.find(box => box.id === this.selectedTextBoxId); }
  private selectedTemplate(): TemplateResponse | undefined { const id = Number(this.templateSelect.value); return this.templates.find(template => template.id === id); }
  private releaseImage(): void { this.image?.dispose(); this.image = null; }
  private setNotice(message: string, error = false): void { this.notice.textContent = message; this.notice.classList.toggle("is-error", error); }
  private errorMessage(error: unknown, fallback: string): string { return error instanceof ApiError ? error.message : fallback; }

  private inputValue(name: string): string {
    const field = this.form.elements.namedItem(name);
    return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement ? field.value : "";
  }
  private numberInput(name: string, min: number, max: number): number { return Math.min(max, Math.max(min, Number(this.inputValue(name)))); }
  private colorInput(name: string, fallback: MemeColor): MemeColor { return this.inputValue(name) === "white" ? "white" : this.inputValue(name) === "black" ? "black" : fallback; }
  private displayPercent(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
  private setInput(name: string, value: string | number): void {
    const field = this.form.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) field.value = String(value);
  }
  private setOutput(name: string, value: string): void { this.required<HTMLOutputElement>(`[data-output="${name}"]`).value = value; }
  private required<T extends Element = HTMLElement>(selector: string): T {
    const element = this.dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Missing Meme Maker element: ${selector}`);
    return element;
  }
}
