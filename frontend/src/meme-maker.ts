import { ApiError } from "./api";
import {
  renderMemeCanvas,
  type MemeTextBox,
  type TextBoxMeasurement,
} from "./meme-renderer";
import {
  beginInteraction,
  beginImageInteraction,
  clientToCanvasPoint,
  hitTestTextBoxes,
  IDLE_IMAGE_INTERACTION,
  IDLE_INTERACTION,
  updateImageInteraction,
  updateInteraction,
  type ImageInteractionState,
  type ImageResizeHandle,
  type InteractionState,
} from "./meme-maker-interaction";
import type { MemeResponse, TemplateResponse, UploadMemeInput } from "./types";
import { MemeMakerHistory, type MemeMakerHistoryState } from "./meme-maker-history";
import {
  calculateFillScale,
  calculateFitScale,
  resetBackgroundTransform,
  type MemeAspectPreset,
  type MemeCanvasState,
} from "./meme-background";
import {
  applyImageLayerMode,
  calculateImageLayerFrame,
  createDefaultImageLayer,
  hitTestImageLayers,
  type MemeImageLayer,
  type MemeImageSource,
} from "./meme-image-layer";

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
const MAX_IMAGE_LAYERS = 30;
const MAX_IMAGE_FILE_BYTES = 50 * 1024 * 1024;
type BackgroundInteraction =
  | { type: "idle" }
  | { type: "dragging"; startX: number; startY: number; originalX: number; originalY: number };

const STYLE_FIELDS = ["fontPreset", "fontWeight", "fontSize", "fillColor", "strokeWidth", "strokeColor", "align", "lineHeight", "letterSpacing", "backgroundEnabled", "backgroundColor", "backgroundOpacity", "backgroundPadding", "backgroundRadius", "shadowEnabled", "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY"] as const;
type MemeTextStyle = Pick<MemeTextBox, typeof STYLE_FIELDS[number]>;

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
let nextImageLayerId = 0;
let nextImageSourceId = 0;
function createTextBox(fontSize: number, yPercent = 50): MemeTextBox {
  nextTextBoxId += 1;
  return {
    id: `text-box-${nextTextBoxId}`,
    text: "",
    xPercent: 50,
    yPercent,
    widthPercent: yPercent === 15 ? 70 : 60,
    fontSize,
    fillColor: "#ffffff",
    strokeWidth: 3,
    strokeColor: "#000000",
    align: "center",
    fontPreset: "classic",
    fontWeight: "heavy",
    lineHeight: 1.15,
    letterSpacing: 0,
    backgroundEnabled: false,
    backgroundColor: "#000000",
    backgroundOpacity: 0.7,
    backgroundPadding: 12,
    backgroundRadius: 8,
    shadowEnabled: false,
    shadowColor: "#000000",
    shadowBlur: 4,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
  };
}

export class MemeMakerController {
  private readonly dialog: HTMLDialogElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly templateSelect: HTMLSelectElement;
  private readonly list: HTMLElement;
  private readonly imageLayerList: HTMLElement;
  private readonly properties: HTMLFieldSetElement;
  private readonly imageLayerProperties: HTMLFieldSetElement;
  private readonly notice: HTMLElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private templates: TemplateResponse[] = [];
  private image: LoadedTemplateImage | null = null;
  private background: MakerBackground | null = null;
  private textBoxes: MemeTextBox[] = [];
  private imageLayers: MemeImageLayer[] = [];
  private readonly imageSources = new Map<string, MemeImageSource>();
  private selectedTextBoxId: string | null = null;
  private selectedImageLayerId: string | null = null;
  private cropModeImageLayerId: string | null = null;
  private backgroundVisible = true;
  private measurements = new Map<string, TextBoxMeasurement>();
  private interaction: InteractionState = IDLE_INTERACTION;
  private imageInteraction: ImageInteractionState = IDLE_IMAGE_INTERACTION;
  private backgroundInteraction: BackgroundInteraction = { type: "idle" };
  private canvasState: MemeCanvasState = {
    aspectPreset: "original", outputWidth: 0, outputHeight: 0,
    backgroundScale: 1, backgroundOffsetX: 0, backgroundOffsetY: 0, lockAspectRatio: true, canvasBackgroundColor: "#ffffff",
  };
  private loadGeneration = 0;
  private renderFrame: number | null = null;
  private busy = false;
  private defaultFontSize = 56;
  private readonly history = new MemeMakerHistory();
  private pendingHistory: MemeMakerHistoryState | null = null;
  private snapGuideX = false;
  private snapGuideY = false;
  private styleClipboard: MemeTextStyle | null = null;
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
            <fieldset class="background-framing" data-background-framing disabled><legend>底图取景</legend>
              <label class="maker-check"><input name="background_visible" type="checkbox" checked> 显示底图</label>
              <div class="maker-ratio-control" role="group" aria-label="输出比例">
                <span>输出比例</span>
                <div>${(["original", "1:1", "4:3", "3:4", "16:9"] as const).map(preset => `<button class="button button-secondary" type="button" data-aspect-preset="${preset}">${preset === "original" ? "原图" : preset}</button>`).join("")}</div>
              </div>
              <div class="maker-size-presets" role="group" aria-label="常用输出尺寸">
                ${[[1080,1080],[1080,1350],[1920,1080],[1200,675],[800,800]].map(([w,h]) => `<button class="button button-secondary" type="button" data-output-size="${w}x${h}">${w}×${h}</button>`).join("")}
              </div>
              <div class="maker-output-size"><label><span>宽度</span><input name="output_width" type="number" min="64" max="4096" step="1"></label><label><span>高度</span><input name="output_height" type="number" min="64" max="4096" step="1"></label></div>
              <label class="maker-check"><input name="lock_aspect" type="checkbox" checked> 锁定比例</label>
              <label><span>画布背景色</span><input name="canvas_background_color" type="color" value="#ffffff"></label>
              ${this.rangeMarkup("background_scale", "缩放", 10, 400, "%", ".1")}
              ${this.rangeMarkup("background_x", "背景 X", -200, 200, "%", ".1")}
              ${this.rangeMarkup("background_y", "背景 Y", -200, 200, "%", ".1")}
              <div class="background-framing-actions">
                <button class="button button-secondary" type="button" data-background-fit>适应画布</button>
                <button class="button button-secondary" type="button" data-background-fill>填满画布</button>
                <button class="button button-ghost" type="button" data-background-reset>重置底图</button>
                <button class="button button-secondary" type="button" data-background-to-layer>从底图创建图片层</button>
              </div>
            </fieldset>
            <section class="image-layer-manager" aria-labelledby="image-layer-list-title">
              <div class="text-box-manager-heading"><strong id="image-layer-list-title">图片层</strong><span data-image-layer-count>0 / ${MAX_IMAGE_LAYERS}</span></div>
              <div class="text-box-list image-layer-list" data-image-layer-list role="listbox" aria-label="图片层列表"></div>
              <div class="text-box-actions">
                <label class="button button-secondary maker-file-button">+ 添加图片<input name="image_layers" type="file" multiple accept="image/png,image/jpeg,image/webp" hidden></label>
                <button class="button button-ghost" type="button" data-delete-image-layer>删除当前图片层</button>
              </div>
            </section>
            <fieldset class="image-layer-properties" data-image-layer-properties disabled>
              <legend>当前图片层属性</legend>
              <details class="maker-style-group" open><summary>几何</summary>
                ${this.rangeMarkup("image_x", "Frame X", 0, 100, "%", ".1")}
                ${this.rangeMarkup("image_y", "Frame Y", 0, 100, "%", ".1")}
                ${this.rangeMarkup("image_width", "Frame 宽度", 5, 100, "%", ".1")}
                ${this.rangeMarkup("image_height", "Frame 高度", 5, 100, "%", ".1")}
              </details>
              <details class="maker-style-group" open><summary>裁切</summary>
                ${this.rangeMarkup("image_crop_scale", "Content 缩放", 10, 500, "%", ".1")}
                ${this.rangeMarkup("image_crop_x", "Content X", -500, 500, "%", ".1")}
                ${this.rangeMarkup("image_crop_y", "Content Y", -500, 500, "%", ".1")}
                <label class="maker-check"><input name="image_crop_mode" type="checkbox"> 调整裁切（拖动图片内容）</label>
                <div class="background-framing-actions"><button class="button button-secondary" type="button" data-image-fit>适应框</button><button class="button button-secondary" type="button" data-image-fill>填满框</button><button class="button button-ghost" type="button" data-image-reset-crop>重置裁切</button></div>
              </details>
              <details class="maker-style-group"><summary>操作</summary>
                ${this.rangeMarkup("image_opacity", "透明度", 0, 100, "%", "1")}
                <label><span>替换图片</span><input name="replace_image_layer" type="file" accept="image/png,image/jpeg,image/webp"></label>
                <div class="text-box-property-actions"><button class="button button-secondary" type="button" data-clone-image-layer>复制图片层</button><button class="button button-secondary" type="button" data-image-layer-down>下移一层</button><button class="button button-secondary" type="button" data-image-layer-up>上移一层</button><button class="button button-ghost" type="button" data-delete-image-layer>删除图片层</button></div>
              </details>
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
              <label><span>文字颜色</span><input name="box_fill_color" type="color"></label>
              <label><span>描边颜色</span><input name="box_stroke_color" type="color"></label>
              <label><span>对齐</span><select name="box_align"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
              <label><span>字体</span><select name="box_font_preset"><option value="classic">经典 Meme</option><option value="chinese-bold">中文粗体</option><option value="sans">常规无衬线</option></select></label>
              <label><span>字重</span><select name="box_font_weight"><option value="normal">常规</option><option value="bold">粗体</option><option value="heavy">特粗</option></select></label>
              ${this.rangeMarkup("box_line_height", "行间距", .8, 2, "×", ".05")}
              ${this.rangeMarkup("box_letter_spacing", "字间距", -4, 20, "px", ".5")}
              <details class="maker-style-group"><summary>文本背景框</summary>
                <label class="maker-check"><input name="box_background_enabled" type="checkbox"> 启用背景框</label>
                <label><span>背景颜色</span><input name="box_background_color" type="color"></label>
                ${this.rangeMarkup("box_background_opacity", "透明度", 0, 100, "%", "1")}
                ${this.rangeMarkup("box_background_padding", "Padding", 0, 64, "px", "1")}
                ${this.rangeMarkup("box_background_radius", "圆角", 0, 32, "px", "1")}
              </details>
              <details class="maker-style-group"><summary>文字阴影</summary>
                <label class="maker-check"><input name="box_shadow_enabled" type="checkbox"> 启用文字阴影</label>
                <label><span>阴影颜色</span><input name="box_shadow_color" type="color"></label>
                ${this.rangeMarkup("box_shadow_blur", "模糊", 0, 32, "px", "1")}
                ${this.rangeMarkup("box_shadow_x", "偏移 X", -32, 32, "px", "1")}
                ${this.rangeMarkup("box_shadow_y", "偏移 Y", -32, 32, "px", "1")}
              </details>
              <div class="text-box-property-actions">
                <button class="button button-secondary" type="button" data-clone-text-box>复制文本框</button>
                <button class="button button-secondary" type="button" data-layer-down>下移一层</button>
                <button class="button button-secondary" type="button" data-layer-up>上移一层</button>
                <button class="button button-secondary" type="button" data-copy-text-style>复制样式</button>
                <button class="button button-secondary" type="button" data-paste-text-style>粘贴样式</button>
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
            <small>文字优先选中；图片层可移动、自由 Resize，开启“调整裁切”后拖动图片内容。也可拖入或粘贴静态图片。</small>
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
    this.imageLayerList = this.required("[data-image-layer-list]");
    this.properties = this.required("[data-text-box-properties]");
    this.imageLayerProperties = this.required("[data-image-layer-properties]");
    this.notice = this.required("[data-maker-notice]");
    this.exportButton = this.required("[data-export-maker]");
    this.saveButton = this.required("[data-save-maker]");
    this.bindEvents();
    this.updateUi();
  }

  private rangeMarkup(name: string, label: string, min: number, max: number, unit: string, explicitStep?: string): string {
    const step = explicitStep ?? (name === "box_x" || name === "box_y" || name === "box_width" ? ".1" : "1");
    return `<label class="maker-range-control"><span>${label} <output data-output="${name}">0${unit}</output></span><div><input name="${name}" type="range" min="${min}" max="${max}" step="${step}"><input name="${name}_number" type="number" min="${min}" max="${max}" step="${step}" aria-label="${label}精确值"></div></label>`;
  }

  open(): void { this.reset(); this.dialog.showModal(); void this.loadTemplates(); }

  close(): void {
    this.loadGeneration += 1;
    this.releaseImage();
    if (this.renderFrame !== null) this.cancelFrame(this.renderFrame);
    this.renderFrame = null;
    this.interaction = IDLE_INTERACTION;
    this.imageInteraction = IDLE_IMAGE_INTERACTION;
    this.backgroundInteraction = { type: "idle" };
    this.disposeImageSources();
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
    this.dialog.querySelector("[data-copy-text-style]")?.addEventListener("click", () => this.copySelectedStyle());
    this.dialog.querySelector("[data-paste-text-style]")?.addEventListener("click", () => this.pasteSelectedStyle());
    this.dialog.querySelector("[data-undo]")?.addEventListener("click", () => this.undo());
    this.dialog.querySelector("[data-redo]")?.addEventListener("click", () => this.redo());
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>("[data-aspect-preset]")) {
      button.addEventListener("click", () => this.setAspectPreset(button.dataset.aspectPreset as MemeAspectPreset));
    }
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>("[data-output-size]")) {
      button.addEventListener("click", () => {
        const [width, height] = (button.dataset.outputSize ?? "").split("x").map(Number);
        if (width && height) this.setOutputSize(width, height);
      });
    }
    this.dialog.querySelector("[data-background-fit]")?.addEventListener("click", () => this.applyBackgroundMode("fit"));
    this.dialog.querySelector("[data-background-fill]")?.addEventListener("click", () => this.applyBackgroundMode("fill"));
    this.dialog.querySelector("[data-background-reset]")?.addEventListener("click", () => this.applyBackgroundMode("fill"));
    this.dialog.querySelector("[data-background-to-layer]")?.addEventListener("click", () => void this.addBackgroundAsImageLayer());
    this.dialog.querySelector<HTMLInputElement>('[name="background_visible"]')?.addEventListener("change", event => {
      const before = this.captureHistory(); this.backgroundVisible = (event.currentTarget as HTMLInputElement).checked;
      this.history.record(before, this.captureHistory()); this.updateUi(); this.scheduleRender();
    });
    const framing = this.required<HTMLFieldSetElement>("[data-background-framing]");
    framing.addEventListener("focusin", event => this.beginControlHistory(event.target));
    framing.addEventListener("input", event => this.updateBackgroundFromForm(event.target));
    framing.addEventListener("change", event => this.updateBackgroundFromForm(event.target, true));
    framing.addEventListener("focusout", event => this.commitBackgroundControlHistory(event.target));
    framing.addEventListener("change", event => this.updateOutputSettings(event.target));
    this.list.addEventListener("click", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-text-box-id]");
      if (button?.dataset.textBoxId) this.selectTextBox(button.dataset.textBoxId);
    });
    this.imageLayerList.addEventListener("click", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-image-layer-id]");
      if (button?.dataset.imageLayerId) this.selectImageLayer(button.dataset.imageLayerId);
    });
    this.dialog.querySelector<HTMLInputElement>('[name="image_layers"]')?.addEventListener("change", event => {
      const input = event.currentTarget as HTMLInputElement;
      if (input.files?.length) void this.addImageFiles([...input.files]);
      input.value = "";
    });
    this.dialog.querySelector<HTMLInputElement>('[name="replace_image_layer"]')?.addEventListener("change", event => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0]; if (file) void this.replaceSelectedImageSource(file); input.value = "";
    });
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>("[data-delete-image-layer]")) button.addEventListener("click", () => this.deleteSelectedImageLayer());
    this.dialog.querySelector("[data-clone-image-layer]")?.addEventListener("click", () => this.cloneSelectedImageLayer());
    this.dialog.querySelector("[data-image-layer-up]")?.addEventListener("click", () => this.moveSelectedImageLayer(1));
    this.dialog.querySelector("[data-image-layer-down]")?.addEventListener("click", () => this.moveSelectedImageLayer(-1));
    this.dialog.querySelector("[data-image-fit]")?.addEventListener("click", () => this.applySelectedImageMode("fit"));
    this.dialog.querySelector("[data-image-fill]")?.addEventListener("click", () => this.applySelectedImageMode("fill"));
    this.dialog.querySelector("[data-image-reset-crop]")?.addEventListener("click", () => this.applySelectedImageMode("fill"));
    this.imageLayerProperties.addEventListener("focusin", event => this.beginControlHistory(event.target));
    this.imageLayerProperties.addEventListener("input", event => this.updateSelectedImageFromForm(event.target));
    this.imageLayerProperties.addEventListener("change", event => this.updateSelectedImageFromForm(event.target, true));
    this.imageLayerProperties.addEventListener("focusout", event => this.commitImageControlHistory(event.target));
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
    this.overlay.addEventListener("dragover", event => { if ([...event.dataTransfer?.items ?? []].some(item => item.kind === "file")) event.preventDefault(); });
    this.overlay.addEventListener("drop", event => {
      const files = [...event.dataTransfer?.files ?? []];
      if (!files.length) return;
      event.preventDefault();
      const point = this.eventPoint(event as unknown as PointerEvent);
      void this.addImageFiles(files, { xPercent: point.x / Math.max(1, this.canvas.width) * 100, yPercent: point.y / Math.max(1, this.canvas.height) * 100 });
    });
    this.dialog.addEventListener("paste", event => {
      const files = [...event.clipboardData?.files ?? []].filter(file => file.type.startsWith("image/"));
      if (!files.length) return;
      event.preventDefault(); void this.addImageFiles(files);
    });
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
      this.canvasState = resetBackgroundTransform(loaded.width, loaded.height, this.canvasState.aspectPreset, "fill", this.canvasState);
      this.history.clear(); this.pendingHistory = null;
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
      this.canvasState = resetBackgroundTransform(loaded.width, loaded.height, this.canvasState.aspectPreset, "fill", this.canvasState);
      this.history.clear(); this.pendingHistory = null;
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

  private async loadImageSource(file: File, type: MemeImageSource["type"] = "local"): Promise<MemeImageSource> {
    if (file.type === "image/gif") throw new Error("GIF 图片层暂不支持，请使用静态图片。");
    if (!staticMimeTypes.has(file.type)) throw new Error(`${file.name || "文件"} 不是支持的 PNG、JPEG 或 WEBP 图片。`);
    if (file.size > MAX_IMAGE_FILE_BYTES) throw new Error(`${file.name} 过大，请使用小于 50 MiB 的图片。`);
    const objectUrl = URL.createObjectURL(file);
    try {
      const loaded = await this.loadImage(objectUrl);
      if (!loaded.width || !loaded.height) { loaded.dispose(); throw new Error(`${file.name} 的图片尺寸无效。`); }
      nextImageSourceId += 1;
      return {
        id: `image-source-${nextImageSourceId}`, type, image: loaded.source,
        naturalWidth: loaded.width, naturalHeight: loaded.height, filename: file.name || "粘贴图片",
        dispose: () => { loaded.dispose(); URL.revokeObjectURL(objectUrl); },
      };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }

  private async loadBackgroundImageSource(): Promise<MemeImageSource> {
    if (!this.background || !this.image) throw new Error("请先加载底图。");
    let loaded: LoadedTemplateImage;
    let filename: string;
    let outerObjectUrl: string | null = null;
    if (this.background.type === "local") {
      outerObjectUrl = URL.createObjectURL(this.background.file);
      try { loaded = await this.loadImage(outerObjectUrl); }
      catch (error) { URL.revokeObjectURL(outerObjectUrl); throw error; }
      filename = `[底图副本] ${this.background.file.name}`;
    } else {
      const template = this.selectedTemplate();
      if (!template?.reference_image_url) throw new Error("当前模板参考图不可用。");
      loaded = await this.loadImage(template.reference_image_url);
      filename = `[底图副本] ${this.background.name}`;
    }
    nextImageSourceId += 1;
    return {
      id: `image-source-${nextImageSourceId}`, type: "background", image: loaded.source,
      naturalWidth: loaded.width, naturalHeight: loaded.height, filename,
      dispose: () => { loaded.dispose(); if (outerObjectUrl) URL.revokeObjectURL(outerObjectUrl); },
    };
  }

  private appendImageLayer(source: MemeImageSource, offset = 0, center?: { xPercent: number; yPercent: number }): MemeImageLayer {
    this.imageSources.set(source.id, source);
    nextImageLayerId += 1;
    const layer = createDefaultImageLayer(`image-layer-${nextImageLayerId}`, source, this.canvas.width || this.canvasState.outputWidth, this.canvas.height || this.canvasState.outputHeight, offset);
    if (center) {
      const frameX = Math.min(100 - layer.frameWidth / 2, Math.max(layer.frameWidth / 2, center.xPercent + offset));
      const frameY = Math.min(100 - layer.frameHeight / 2, Math.max(layer.frameHeight / 2, center.yPercent + offset));
      layer.contentX += frameX - layer.frameX; layer.contentY += frameY - layer.frameY;
      layer.frameX = frameX; layer.frameY = frameY;
    }
    this.imageLayers.push(layer);
    return layer;
  }

  private async addImageFiles(files: File[], center?: { xPercent: number; yPercent: number }): Promise<void> {
    if (!this.image) { this.setNotice("请先加载底图，再添加图片层。", true); return; }
    const available = MAX_IMAGE_LAYERS - this.imageLayers.length;
    if (available <= 0) { this.setNotice(`最多只能添加 ${MAX_IMAGE_LAYERS} 个图片层。`, true); return; }
    const before = this.captureHistory();
    const generation = this.loadGeneration;
    const errors: string[] = [];
    let added = 0;
    for (const file of files.slice(0, available)) {
      try {
        const source = await this.loadImageSource(file);
        if (generation !== this.loadGeneration || !this.dialog.open) { source.dispose?.(); break; }
        const layer = this.appendImageLayer(source, added * 2.5, center);
        this.selectedImageLayerId = layer.id; this.selectedTextBoxId = null; added += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${file.name} 无法解码。`);
      }
    }
    if (files.length > available) errors.push(`已达到 ${MAX_IMAGE_LAYERS} 个图片层上限。`);
    if (added) {
      this.history.record(before, this.captureHistory()); this.updateHistoryActions(); this.updateUi(); this.scheduleRender();
    }
    this.setNotice(errors.length ? `${added ? `已添加 ${added} 张。` : ""}${errors.join(" ")}` : `已添加 ${added} 张图片。`, errors.length > 0);
  }

  private async addBackgroundAsImageLayer(): Promise<void> {
    if (!this.image || !this.background) { this.setNotice("请先加载底图。", true); return; }
    if (this.imageLayers.length >= MAX_IMAGE_LAYERS) { this.setNotice(`最多只能添加 ${MAX_IMAGE_LAYERS} 个图片层。`, true); return; }
    const before = this.captureHistory();
    const generation = this.loadGeneration;
    try {
      const source = await this.loadBackgroundImageSource();
      if (generation !== this.loadGeneration || !this.dialog.open) { source.dispose?.(); return; }
      const layer = this.appendImageLayer(source, this.imageLayers.length ? 2.5 : 0);
      this.selectedImageLayerId = layer.id; this.selectedTextBoxId = null;
      this.history.record(before, this.captureHistory()); this.updateHistoryActions(); this.updateUi(); this.scheduleRender();
      this.setNotice("已从底图创建独立图片层。", false);
    } catch { this.setNotice("底图副本加载失败，请重试。", true); }
  }

  private async replaceSelectedImageSource(file: File): Promise<void> {
    const layer = this.selectedImageLayer(); if (!layer) return;
    const before = this.captureHistory();
    const generation = this.loadGeneration;
    try {
      const source = await this.loadImageSource(file);
      if (generation !== this.loadGeneration || !this.dialog.open || !this.imageLayers.includes(layer)) { source.dispose?.(); return; }
      this.imageSources.set(source.id, source);
      layer.sourceId = source.id;
      this.history.record(before, this.captureHistory()); this.updateHistoryActions(); this.updateUi(); this.scheduleRender();
      this.setNotice("图片层来源已替换，Frame 保持不变。", false);
    } catch (error) { this.setNotice(error instanceof Error ? error.message : "替换图片失败。", true); }
  }

  private selectImageLayer(id: string | null): void {
    this.selectedImageLayerId = id && this.imageLayers.some(layer => layer.id === id) ? id : null;
    if (this.selectedImageLayerId) this.selectedTextBoxId = null;
    if (this.cropModeImageLayerId && this.cropModeImageLayerId !== this.selectedImageLayerId) this.cropModeImageLayerId = null;
    this.updateUi(); this.updateOverlay();
  }

  private cloneSelectedImageLayer(): void {
    const selected = this.selectedImageLayer();
    if (!selected || this.imageLayers.length >= MAX_IMAGE_LAYERS) return;
    const before = this.captureHistory(); nextImageLayerId += 1;
    const frameX = Math.min(100 - selected.frameWidth / 2, selected.frameX + 3);
    const frameY = Math.min(100 - selected.frameHeight / 2, selected.frameY + 3);
    const clone = {
      ...selected, id: `image-layer-${nextImageLayerId}`, frameX, frameY,
      contentX: selected.contentX + frameX - selected.frameX,
      contentY: selected.contentY + frameY - selected.frameY,
    };
    this.imageLayers.push(clone); this.selectedImageLayerId = clone.id;
    this.history.record(before, this.captureHistory()); this.updateUi(); this.scheduleRender();
  }

  private deleteSelectedImageLayer(): void {
    const index = this.imageLayers.findIndex(layer => layer.id === this.selectedImageLayerId); if (index < 0) return;
    const before = this.captureHistory(); this.imageLayers.splice(index, 1); this.selectedImageLayerId = null; this.cropModeImageLayerId = null;
    this.history.record(before, this.captureHistory()); this.updateUi(); this.scheduleRender();
  }

  private moveSelectedImageLayer(direction: -1 | 1): void {
    const index = this.imageLayers.findIndex(layer => layer.id === this.selectedImageLayerId); const target = index + direction;
    if (index < 0 || target < 0 || target >= this.imageLayers.length) return;
    const before = this.captureHistory(); [this.imageLayers[index], this.imageLayers[target]] = [this.imageLayers[target], this.imageLayers[index]];
    this.history.record(before, this.captureHistory()); this.updateUi(); this.scheduleRender();
  }

  private applySelectedImageMode(mode: "fit" | "fill"): void {
    const layer = this.selectedImageLayer(); const source = layer ? this.imageSources.get(layer.sourceId) : null;
    if (!layer || !source) return;
    const before = this.captureHistory(); const index = this.imageLayers.indexOf(layer);
    this.imageLayers[index] = applyImageLayerMode(layer, source, this.canvasState.outputWidth, this.canvasState.outputHeight, mode);
    this.history.record(before, this.captureHistory()); this.updateUi(); this.scheduleRender();
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
    const defaults = createTextBox(this.defaultFontSize);
    for (const field of STYLE_FIELDS) (box as unknown as Record<string, unknown>)[field] = defaults[field];
    this.updateUi(); this.scheduleRender(); this.history.record(before, this.captureHistory()); this.updateHistoryActions();
  }

  private copySelectedStyle(): void {
    const box = this.selectedTextBox(); if (!box) return;
    this.styleClipboard = Object.fromEntries(STYLE_FIELDS.map(field => [field, box[field]])) as MemeTextStyle;
    this.updateUi(); this.setNotice("已复制当前文本框样式。", false);
  }

  private pasteSelectedStyle(): void {
    const box = this.selectedTextBox(); if (!box || !this.styleClipboard) return;
    const before = this.captureHistory(); Object.assign(box, this.styleClipboard);
    this.updateUi(); this.scheduleRender(); this.history.record(before, this.captureHistory()); this.updateHistoryActions();
    this.setNotice("样式已粘贴。", false);
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
    if (this.selectedTextBoxId) { this.selectedImageLayerId = null; this.cropModeImageLayerId = null; }
    this.updateUi();
    this.updateOverlay();
  }

  private updateSelectedImageFromForm(target?: EventTarget | null, commit = false): void {
    const layer = this.selectedImageLayer(); if (!layer) return;
    if (target instanceof HTMLInputElement && target.type === "number") {
      if (!target.value.trim() || !Number.isFinite(Number(target.value))) return;
      const range = this.form.elements.namedItem(target.name.replace(/_number$/u, ""));
      if (range instanceof HTMLInputElement) range.value = target.value;
    }
    const originalFrameX = layer.frameX; const originalFrameY = layer.frameY;
    layer.frameWidth = this.numberInput("image_width", 5, 100);
    layer.frameHeight = this.numberInput("image_height", 5, 100);
    layer.frameX = Math.min(100 - layer.frameWidth / 2, Math.max(layer.frameWidth / 2, this.numberInput("image_x", 0, 100)));
    layer.frameY = Math.min(100 - layer.frameHeight / 2, Math.max(layer.frameHeight / 2, this.numberInput("image_y", 0, 100)));
    const fieldName = target instanceof HTMLInputElement ? target.name.replace(/_number$/u, "") : "";
    layer.contentX = this.numberInput("image_crop_x", -500, 500);
    layer.contentY = this.numberInput("image_crop_y", -500, 500);
    if (this.cropModeImageLayerId !== layer.id) {
      if (fieldName === "image_x") layer.contentX += layer.frameX - originalFrameX;
      if (fieldName === "image_y") layer.contentY += layer.frameY - originalFrameY;
    }
    layer.contentScale = this.numberInput("image_crop_scale", 10, 500) / 100;
    layer.opacity = this.numberInput("image_opacity", 0, 100) / 100;
    this.cropModeImageLayerId = this.checkedInput("image_crop_mode") ? layer.id : null;
    this.updateUi(); this.scheduleRender(); if (commit) this.commitHistory();
  }

  private commitImageControlHistory(target: EventTarget | null): void {
    if (target instanceof HTMLInputElement && target.type === "number") {
      const range = this.form.elements.namedItem(target.name.replace(/_number$/u, ""));
      if (range instanceof HTMLInputElement) {
        const parsed = Number(target.value); const value = target.value.trim() && Number.isFinite(parsed) ? Math.min(Number(range.max), Math.max(Number(range.min), parsed)) : Number(range.value);
        range.value = String(value); target.value = String(value); this.updateSelectedImageFromForm(range);
      }
    }
    this.commitHistory();
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
    box.fillColor = this.hexInput("box_fill_color", "#ffffff");
    box.strokeColor = this.hexInput("box_stroke_color", "#000000");
    const align = this.inputValue("box_align");
    box.align = align === "left" || align === "right" ? align : "center";
    const fontPreset = this.inputValue("box_font_preset");
    box.fontPreset = fontPreset === "chinese-bold" || fontPreset === "sans" ? fontPreset : "classic";
    const fontWeight = this.inputValue("box_font_weight"); box.fontWeight = fontWeight === "normal" || fontWeight === "bold" ? fontWeight : "heavy";
    box.lineHeight = this.numberInput("box_line_height", .8, 2);
    box.letterSpacing = this.numberInput("box_letter_spacing", -4, 20);
    box.backgroundEnabled = this.checkedInput("box_background_enabled");
    box.backgroundColor = this.hexInput("box_background_color", "#000000");
    box.backgroundOpacity = this.numberInput("box_background_opacity", 0, 100) / 100;
    box.backgroundPadding = this.numberInput("box_background_padding", 0, 64);
    box.backgroundRadius = this.numberInput("box_background_radius", 0, 32);
    box.shadowEnabled = this.checkedInput("box_shadow_enabled");
    box.shadowColor = this.hexInput("box_shadow_color", "#000000");
    box.shadowBlur = this.numberInput("box_shadow_blur", 0, 32);
    box.shadowOffsetX = this.numberInput("box_shadow_x", -32, 32);
    box.shadowOffsetY = this.numberInput("box_shadow_y", -32, 32);
    this.updateUi();
    this.scheduleRender();
    if (commit) this.commitHistory();
  }

  private setAspectPreset(preset: MemeAspectPreset): void {
    if (!this.image || this.canvasState.aspectPreset === preset) return;
    const before = this.captureHistory();
    this.canvasState = resetBackgroundTransform(this.image.width, this.image.height, preset, "fill", this.canvasState);
    this.updateUi(); this.renderNow();
    this.history.record(before, this.captureHistory()); this.updateHistoryActions();
  }

  private applyBackgroundMode(mode: "fit" | "fill"): void {
    if (!this.image) return;
    const before = this.captureHistory();
    const scale = mode === "fit"
      ? calculateFitScale(this.image.width, this.image.height, this.canvasState.outputWidth, this.canvasState.outputHeight)
      : calculateFillScale(this.image.width, this.image.height, this.canvasState.outputWidth, this.canvasState.outputHeight);
    Object.assign(this.canvasState, { backgroundScale: scale, backgroundOffsetX: 0, backgroundOffsetY: 0 });
    this.updateUi(); this.scheduleRender(); this.history.record(before, this.captureHistory()); this.updateHistoryActions();
  }

  private setOutputSize(width: number, height: number): void {
    if (!this.image) return;
    const before = this.captureHistory();
    this.canvasState.outputWidth = Math.min(4096, Math.max(64, Math.round(width)));
    this.canvasState.outputHeight = Math.min(4096, Math.max(64, Math.round(height)));
    this.canvasState.aspectPreset = "custom";
    this.canvasState.lockAspectRatio = true;
    const scale = calculateFillScale(this.image.width, this.image.height, this.canvasState.outputWidth, this.canvasState.outputHeight);
    Object.assign(this.canvasState, { backgroundScale: scale, backgroundOffsetX: 0, backgroundOffsetY: 0 });
    this.updateUi(); this.renderNow(); this.history.record(before, this.captureHistory()); this.updateHistoryActions();
  }

  private updateOutputSettings(target: EventTarget | null): void {
    if (!this.image || !(target instanceof HTMLInputElement)) return;
    if (!["output_width", "output_height", "lock_aspect", "canvas_background_color"].includes(target.name)) return;
    const before = this.pendingHistory ?? this.captureHistory();
    if (target.name === "lock_aspect") this.canvasState.lockAspectRatio = target.checked;
    else if (target.name === "canvas_background_color") this.canvasState.canvasBackgroundColor = target.value;
    else {
      const oldRatio = this.canvasState.outputWidth / Math.max(1, this.canvasState.outputHeight);
      const value = Math.min(4096, Math.max(64, Math.round(Number(target.value) || 64)));
      if (target.name === "output_width") {
        this.canvasState.outputWidth = value;
        if (this.canvasState.lockAspectRatio) this.canvasState.outputHeight = Math.min(4096, Math.max(64, Math.round(value / oldRatio)));
      } else {
        this.canvasState.outputHeight = value;
        if (this.canvasState.lockAspectRatio) this.canvasState.outputWidth = Math.min(4096, Math.max(64, Math.round(value * oldRatio)));
      }
      this.canvasState.aspectPreset = "custom";
      const scale = calculateFillScale(this.image.width, this.image.height, this.canvasState.outputWidth, this.canvasState.outputHeight);
      Object.assign(this.canvasState, { backgroundScale: scale, backgroundOffsetX: 0, backgroundOffsetY: 0 });
    }
    this.pendingHistory = null; this.updateUi(); this.renderNow(); this.history.record(before, this.captureHistory()); this.updateHistoryActions();
  }

  private updateBackgroundFromForm(target?: EventTarget | null, commit = false): void {
    if (!this.image) return;
    if (target instanceof HTMLInputElement && !["background_scale", "background_scale_number", "background_x", "background_x_number", "background_y", "background_y_number"].includes(target.name)) return;
    if (target instanceof HTMLInputElement && target.type === "number") {
      if (target.value.trim() === "" || !Number.isFinite(Number(target.value))) return;
      const range = this.form.elements.namedItem(target.name.replace(/_number$/u, ""));
      if (range instanceof HTMLInputElement) range.value = target.value;
    }
    this.canvasState.backgroundScale = this.numberInput("background_scale", 10, 400) / 100;
    this.canvasState.backgroundOffsetX = this.numberInput("background_x", -200, 200);
    this.canvasState.backgroundOffsetY = this.numberInput("background_y", -200, 200);
    this.updateUi(); this.scheduleRender();
    if (commit) this.commitHistory();
  }

  private commitBackgroundControlHistory(target: EventTarget | null): void {
    if (target instanceof HTMLInputElement && target.type === "number") {
      const range = this.form.elements.namedItem(target.name.replace(/_number$/u, ""));
      if (range instanceof HTMLInputElement) {
        const min = Number(range.min); const max = Number(range.max); const parsed = Number(target.value);
        const value = target.value.trim() && Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : Number(range.value);
        range.value = String(value); target.value = String(value); this.updateBackgroundFromForm(range);
      }
    }
    this.commitHistory();
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.image) return;
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>("[data-resize-handle]");
    const imageHandle = target.closest<HTMLElement>("[data-image-resize-handle]");
    const imageFrameMove = target.closest<HTMLElement>("[data-image-frame-move]");
    const point = this.eventPoint(event);
    const id = imageHandle || imageFrameMove ? null : handle
      ? target.closest<HTMLElement>("[data-selected-box]")?.dataset.selectedBox ?? null
      : hitTestTextBoxes(this.textBoxes, this.measurements, point);
    if (id) {
      this.selectTextBox(id); const box = this.selectedTextBox(); if (!box) return;
      this.beginHistory();
      const type = handle?.dataset.resizeHandle === "left" ? "resizing-left" : handle?.dataset.resizeHandle === "right" ? "resizing-right" : "dragging";
      this.interaction = beginInteraction(type, box, point);
      this.overlay.setPointerCapture?.(event.pointerId); event.preventDefault(); return;
    }
    const imageId = imageHandle?.closest<HTMLElement>("[data-selected-image-layer]")?.dataset.selectedImageLayer
      ?? imageFrameMove?.closest<HTMLElement>("[data-selected-image-layer]")?.dataset.selectedImageLayer
      ?? hitTestImageLayers(this.imageLayers, point.x, point.y, this.canvas.width, this.canvas.height);
    if (imageId) {
      this.selectImageLayer(imageId); const layer = this.selectedImageLayer(); if (!layer) return;
      this.beginHistory();
      this.imageInteraction = imageHandle
        ? beginImageInteraction("resizing", layer, point, imageHandle.dataset.imageResizeHandle as ImageResizeHandle)
        : imageFrameMove ? beginImageInteraction("moving-frame", layer, point)
        : beginImageInteraction(this.cropModeImageLayerId === layer.id ? "cropping" : "moving", layer, point);
      this.overlay.setPointerCapture?.(event.pointerId); event.preventDefault(); return;
    }
    this.selectTextBox(null); this.selectImageLayer(null);
    this.beginHistory();
    this.backgroundInteraction = { type: "dragging", startX: event.clientX, startY: event.clientY, originalX: this.canvasState.backgroundOffsetX, originalY: this.canvasState.backgroundOffsetY };
    this.overlay.classList.add("is-dragging-background"); this.overlay.setPointerCapture?.(event.pointerId); event.preventDefault();
  }

  private pointerMove(event: PointerEvent): void {
    if (!this.image) return;
    if (this.backgroundInteraction.type === "dragging") {
      const rect = this.canvas.getBoundingClientRect();
      this.canvasState.backgroundOffsetX = this.backgroundInteraction.originalX + (event.clientX - this.backgroundInteraction.startX) / Math.max(1, rect.width) * 100;
      this.canvasState.backgroundOffsetY = this.backgroundInteraction.originalY + (event.clientY - this.backgroundInteraction.startY) / Math.max(1, rect.height) * 100;
      this.updateUi(); this.scheduleRender(); event.preventDefault(); return;
    }
    if (this.imageInteraction.type !== "idle") {
      const updated = updateImageInteraction(this.imageInteraction, this.eventPoint(event), this.canvas.width, this.canvas.height);
      const index = updated ? this.imageLayers.findIndex(layer => layer.id === updated.id) : -1;
      if (updated && index >= 0) {
        this.imageLayers[index] = updated;
        this.snapGuideX = (this.imageInteraction.type === "moving" || this.imageInteraction.type === "moving-frame") && updated.frameX === 50;
        this.snapGuideY = (this.imageInteraction.type === "moving" || this.imageInteraction.type === "moving-frame") && updated.frameY === 50;
        this.updateUi(); this.scheduleRender();
      }
      event.preventDefault(); return;
    }
    if (this.interaction.type === "idle") return;
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
    if (this.backgroundInteraction.type === "dragging") {
      this.backgroundInteraction = { type: "idle" };
      this.overlay.classList.remove("is-dragging-background");
      this.commitHistory(); this.overlay.releasePointerCapture?.(event.pointerId); event.preventDefault(); return;
    }
    if (this.imageInteraction.type !== "idle") {
      this.imageInteraction = IDLE_IMAGE_INTERACTION; this.snapGuideX = false; this.snapGuideY = false;
      this.commitHistory(); this.updateOverlay(); this.overlay.releasePointerCapture?.(event.pointerId); event.preventDefault(); return;
    }
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
    if (modifier && event.key.toLowerCase() === "d") { event.preventDefault(); this.selectedImageLayerId ? this.cloneSelectedImageLayer() : this.cloneSelectedTextBox(); return; }
    if (event.key === "Delete") { event.preventDefault(); this.selectedImageLayerId ? this.deleteSelectedImageLayer() : this.deleteSelectedTextBox(); return; }
    if (event.key === "Escape" && this.cropModeImageLayerId) { event.preventDefault(); event.stopPropagation(); this.cropModeImageLayerId = null; this.updateUi(); this.updateOverlay(); return; }
    if (event.key === "Escape" && (this.selectedTextBoxId || this.selectedImageLayerId)) { event.preventDefault(); event.stopPropagation(); this.selectTextBox(null); this.selectImageLayer(null); return; }
    const imageLayer = this.selectedImageLayer();
    if (imageLayer && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      if (event.repeat) { event.preventDefault(); return; }
      const before = this.captureHistory(); const step = event.shiftKey ? 2 : 0.5;
      const originalFrameX = imageLayer.frameX; const originalFrameY = imageLayer.frameY;
      if (event.key === "ArrowLeft") imageLayer.frameX = Math.max(imageLayer.frameWidth / 2, imageLayer.frameX - step);
      if (event.key === "ArrowRight") imageLayer.frameX = Math.min(100 - imageLayer.frameWidth / 2, imageLayer.frameX + step);
      if (event.key === "ArrowUp") imageLayer.frameY = Math.max(imageLayer.frameHeight / 2, imageLayer.frameY - step);
      if (event.key === "ArrowDown") imageLayer.frameY = Math.min(100 - imageLayer.frameHeight / 2, imageLayer.frameY + step);
      imageLayer.contentX += imageLayer.frameX - originalFrameX; imageLayer.contentY += imageLayer.frameY - originalFrameY;
      event.preventDefault(); this.updateUi(); this.scheduleRender(); this.history.record(before, this.captureHistory()); this.updateHistoryActions(); return;
    }
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
      this.measurements = renderMemeCanvas(this.canvas, this.image.source, this.textBoxes, this.image.width, this.image.height, this.canvasState, this.imageLayers, this.imageSources, this.backgroundVisible);
      this.required("[data-resolution]").textContent = `${this.canvasState.outputWidth} × ${this.canvasState.outputHeight} PNG`;
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
    if (!this.image) return;
    const selectedImage = this.selectedImageLayer();
    if (selectedImage) {
      const frame = calculateImageLayerFrame(selectedImage, this.canvasState.outputWidth, this.canvasState.outputHeight);
      const selection = document.createElement("div");
      selection.className = `meme-image-layer-selection${this.cropModeImageLayerId === selectedImage.id ? " is-cropping" : ""}`;
      selection.dataset.selectedImageLayer = selectedImage.id;
      selection.style.left = `${frame.x / this.canvasState.outputWidth * 100}%`;
      selection.style.top = `${frame.y / this.canvasState.outputHeight * 100}%`;
      selection.style.width = `${selectedImage.frameWidth}%`; selection.style.height = `${selectedImage.frameHeight}%`;
      for (const corner of ["nw", "ne", "sw", "se"] as const) {
        const handle = document.createElement("button"); handle.type = "button";
        handle.className = `meme-image-layer-handle is-${corner}`; handle.dataset.imageResizeHandle = corner;
        handle.setAttribute("aria-label", `从 ${corner} 角调整图片层大小`); selection.append(handle);
      }
      if (this.cropModeImageLayerId === selectedImage.id) {
        const frameMove = document.createElement("button"); frameMove.type = "button"; frameMove.className = "meme-image-frame-move";
        frameMove.dataset.imageFrameMove = ""; frameMove.textContent = "拖动 Frame"; frameMove.setAttribute("aria-label", "移动裁切 Frame，不移动图片内容"); selection.append(frameMove);
      }
      this.overlay.append(selection); return;
    }
    if (!this.selectedTextBoxId) return;
    const bounds = this.measurements.get(this.selectedTextBoxId)?.bounds;
    if (!bounds) return;
    const selection = document.createElement("div");
    selection.className = "meme-text-box-selection";
    selection.dataset.selectedBox = this.selectedTextBoxId;
    selection.style.left = `${bounds.left / this.canvasState.outputWidth * 100}%`;
    selection.style.top = `${bounds.top / this.canvasState.outputHeight * 100}%`;
    selection.style.width = `${bounds.width / this.canvasState.outputWidth * 100}%`;
    selection.style.height = `${bounds.height / this.canvasState.outputHeight * 100}%`;
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
    const imageLayer = this.selectedImageLayer();
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
      this.setInput("box_font_weight", box.fontWeight);
      this.syncRange("box_line_height", box.lineHeight, "×");
      this.syncRange("box_letter_spacing", box.letterSpacing, "px");
      this.setChecked("box_background_enabled", box.backgroundEnabled);
      this.setInput("box_background_color", box.backgroundColor);
      this.syncRange("box_background_opacity", box.backgroundOpacity * 100, "%");
      this.syncRange("box_background_padding", box.backgroundPadding, "px");
      this.syncRange("box_background_radius", box.backgroundRadius, "px");
      this.setChecked("box_shadow_enabled", box.shadowEnabled);
      this.setInput("box_shadow_color", box.shadowColor);
      this.syncRange("box_shadow_blur", box.shadowBlur, "px");
      this.syncRange("box_shadow_x", box.shadowOffsetX, "px");
      this.syncRange("box_shadow_y", box.shadowOffsetY, "px");
      this.setOutput("box_font_size", `${Math.round(box.fontSize)}px`);
      this.setOutput("box_x", `${this.displayPercent(box.xPercent)}%`);
      this.setOutput("box_y", `${this.displayPercent(box.yPercent)}%`);
      this.setOutput("box_width", `${this.displayPercent(box.widthPercent)}%`);
      this.setOutput("box_stroke", `${Math.round(box.strokeWidth)}px`);
    }
    this.imageLayerProperties.disabled = !imageLayer;
    if (imageLayer) {
      this.syncRange("image_x", imageLayer.frameX, "%");
      this.syncRange("image_y", imageLayer.frameY, "%");
      this.syncRange("image_width", imageLayer.frameWidth, "%");
      this.syncRange("image_height", imageLayer.frameHeight, "%");
      this.syncRange("image_crop_scale", imageLayer.contentScale * 100, "%");
      this.syncRange("image_crop_x", imageLayer.contentX, "%");
      this.syncRange("image_crop_y", imageLayer.contentY, "%");
      this.syncRange("image_opacity", imageLayer.opacity * 100, "%");
      this.setChecked("image_crop_mode", this.cropModeImageLayerId === imageLayer.id);
    }
    const framing = this.required<HTMLFieldSetElement>("[data-background-framing]");
    framing.disabled = !this.image;
    const scalePercent = this.canvasState.backgroundScale * 100;
    this.setInput("background_scale", this.displayNumber(scalePercent));
    this.setInput("background_scale_number", this.displayNumber(scalePercent));
    this.setInput("background_x", this.displayNumber(this.canvasState.backgroundOffsetX));
    this.setInput("background_x_number", this.displayNumber(this.canvasState.backgroundOffsetX));
    this.setInput("background_y", this.displayNumber(this.canvasState.backgroundOffsetY));
    this.setInput("background_y_number", this.displayNumber(this.canvasState.backgroundOffsetY));
    this.setOutput("background_scale", `${this.displayNumber(scalePercent)}%`);
    this.setOutput("background_x", `${this.displayNumber(this.canvasState.backgroundOffsetX)}%`);
    this.setOutput("background_y", `${this.displayNumber(this.canvasState.backgroundOffsetY)}%`);
    this.setInput("output_width", this.canvasState.outputWidth || 64);
    this.setInput("output_height", this.canvasState.outputHeight || 64);
    this.setChecked("lock_aspect", this.canvasState.lockAspectRatio);
    this.setInput("canvas_background_color", this.canvasState.canvasBackgroundColor);
    this.setChecked("background_visible", this.backgroundVisible);
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>("[data-aspect-preset]")) {
      button.classList.toggle("is-active", button.dataset.aspectPreset === this.canvasState.aspectPreset);
      button.setAttribute("aria-pressed", String(button.dataset.aspectPreset === this.canvasState.aspectPreset));
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
    const paste = this.dialog.querySelector<HTMLButtonElement>("[data-paste-text-style]");
    if (clone) clone.disabled = !box || this.textBoxes.length >= MAX_TEXT_BOXES;
    if (up) up.disabled = index < 0 || index === this.textBoxes.length - 1;
    if (down) down.disabled = index <= 0;
    if (paste) paste.disabled = !box || !this.styleClipboard;
    const imageIndex = this.imageLayers.findIndex(item => item.id === this.selectedImageLayerId);
    const imageAdd = this.dialog.querySelector<HTMLInputElement>('[name="image_layers"]'); if (imageAdd) imageAdd.disabled = !this.image || this.imageLayers.length >= MAX_IMAGE_LAYERS;
    for (const removeImage of this.dialog.querySelectorAll<HTMLButtonElement>("[data-delete-image-layer]")) removeImage.disabled = !imageLayer;
    const imageClone = this.dialog.querySelector<HTMLButtonElement>("[data-clone-image-layer]"); if (imageClone) imageClone.disabled = !imageLayer || this.imageLayers.length >= MAX_IMAGE_LAYERS;
    const imageUp = this.dialog.querySelector<HTMLButtonElement>("[data-image-layer-up]"); if (imageUp) imageUp.disabled = imageIndex < 0 || imageIndex === this.imageLayers.length - 1;
    const imageDown = this.dialog.querySelector<HTMLButtonElement>("[data-image-layer-down]"); if (imageDown) imageDown.disabled = imageIndex <= 0;
    const fromBackground = this.dialog.querySelector<HTMLButtonElement>("[data-background-to-layer]"); if (fromBackground) fromBackground.disabled = !this.image || this.imageLayers.length >= MAX_IMAGE_LAYERS;
    this.updateHistoryActions();
  }

  private renderList(): void {
    this.renderImageLayerList();
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

  private renderImageLayerList(): void {
    this.imageLayerList.replaceChildren();
    this.imageLayers.forEach((layer, index) => {
      const source = this.imageSources.get(layer.sourceId);
      const button = document.createElement("button"); button.type = "button"; button.dataset.imageLayerId = layer.id;
      button.setAttribute("role", "option"); button.setAttribute("aria-selected", String(layer.id === this.selectedImageLayerId));
      button.className = layer.id === this.selectedImageLayerId ? "is-selected" : "";
      button.textContent = `${index + 1}. ${source?.filename ?? "图片来源不可用"}`; this.imageLayerList.append(button);
    });
    if (!this.imageLayers.length) { const empty = document.createElement("p"); empty.textContent = "还没有图片层"; this.imageLayerList.append(empty); }
    this.required("[data-image-layer-count]").textContent = `${this.imageLayers.length} / ${MAX_IMAGE_LAYERS}`;
  }

  private captureHistory(): MemeMakerHistoryState {
    return {
      textBoxes: this.textBoxes.map(box => ({ ...box })), imageLayers: this.imageLayers.map(layer => ({ ...layer })),
      selectedTextBoxId: this.selectedTextBoxId, selectedImageLayerId: this.selectedImageLayerId,
      title: this.inputValue("title"), canvasState: { ...this.canvasState }, backgroundVisible: this.backgroundVisible,
    };
  }

  private restoreHistory(state: MemeMakerHistoryState): void {
    this.textBoxes = state.textBoxes.map(box => ({ ...box }));
    this.imageLayers = state.imageLayers.map(layer => ({ ...layer }));
    this.selectedTextBoxId = state.selectedTextBoxId && this.textBoxes.some(box => box.id === state.selectedTextBoxId) ? state.selectedTextBoxId : null;
    this.selectedImageLayerId = state.selectedImageLayerId && this.imageLayers.some(layer => layer.id === state.selectedImageLayerId) ? state.selectedImageLayerId : null;
    this.setInput("title", state.title);
    this.canvasState = { ...state.canvasState };
    this.backgroundVisible = state.backgroundVisible; this.cropModeImageLayerId = null;
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
    if (!this.textBoxes.some(box => box.text.trim()) && !this.imageLayers.length) { this.setNotice("请至少输入一段文字或添加一个图片层后再导出或保存。", true); return false; }
    if (requireTitle && !this.inputValue("title").trim()) { this.setNotice("请输入 Meme 标题后再保存。", true); return false; }
    return true;
  }

  private reset(): void {
    this.loadGeneration += 1; this.releaseImage(); this.disposeImageSources(); this.form.reset();
    this.textBoxes = []; this.imageLayers = []; this.selectedTextBoxId = null; this.selectedImageLayerId = null; this.cropModeImageLayerId = null; this.backgroundVisible = true;
    this.measurements.clear(); this.interaction = IDLE_INTERACTION; this.imageInteraction = IDLE_IMAGE_INTERACTION; this.backgroundInteraction = { type: "idle" }; this.background = null;
    this.canvasState = { aspectPreset: "original", outputWidth: 0, outputHeight: 0, backgroundScale: 1, backgroundOffsetX: 0, backgroundOffsetY: 0, lockAspectRatio: true, canvasBackgroundColor: "#ffffff" };
    this.styleClipboard = null;
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
  private selectedImageLayer(): MemeImageLayer | undefined { return this.imageLayers.find(layer => layer.id === this.selectedImageLayerId); }
  private selectedTemplate(): TemplateResponse | undefined { const id = Number(this.templateSelect.value); return this.templates.find(template => template.id === id); }
  private releaseImage(): void { this.image?.dispose(); this.image = null; }
  private disposeImageSources(): void { for (const source of this.imageSources.values()) source.dispose?.(); this.imageSources.clear(); }
  private setNotice(message: string, error = false): void { this.notice.textContent = message; this.notice.classList.toggle("is-error", error); }
  private errorMessage(error: unknown, fallback: string): string { return error instanceof ApiError ? error.message : fallback; }

  private inputValue(name: string): string {
    const field = this.form.elements.namedItem(name);
    return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement ? field.value : "";
  }
  private numberInput(name: string, min: number, max: number): number { return Math.min(max, Math.max(min, Number(this.inputValue(name)))); }
  private hexInput(name: string, fallback: string): string { return /^#[0-9a-f]{6}$/iu.test(this.inputValue(name)) ? this.inputValue(name) : fallback; }
  private checkedInput(name: string): boolean { const field = this.form.elements.namedItem(name); return field instanceof HTMLInputElement && field.checked; }
  private displayPercent(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
  private displayNumber(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
  private setInput(name: string, value: string | number): void {
    const field = this.form.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) field.value = String(value);
  }
  private setChecked(name: string, value: boolean): void { const field = this.form.elements.namedItem(name); if (field instanceof HTMLInputElement) field.checked = value; }
  private syncRange(name: string, value: number, unit: string): void { const shown = this.displayNumber(value); this.setInput(name, shown); this.setInput(`${name}_number`, shown); this.setOutput(name, `${shown}${unit}`); }
  private setOutput(name: string, value: string): void { this.required<HTMLOutputElement>(`[data-output="${name}"]`).value = value; }
  private required<T extends Element = HTMLElement>(selector: string): T {
    const element = this.dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Missing Meme Maker element: ${selector}`);
    return element;
  }
}
