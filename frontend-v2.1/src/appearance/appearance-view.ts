import { APPEARANCE_PRESETS } from "./appearance-presets";
import type { AppearanceController } from "./appearance-controller";
import type { AppearanceSettings } from "./appearance-types";
import type { VaultSummary } from "../types";

export interface AppearanceViewContext {
  getVault(): VaultSummary | null;
  canEdit: boolean;
  /** Vault 模式：上传背景保存到服务器（跟随仓库），而不是浏览器 IndexedDB。 */
  onUploadBackground(file: File): Promise<void>;
  onRemoveBackground(): Promise<void>;
  onResetAppearance(): Promise<void>;
}

type NumericAppearanceKey = Exclude<{
  [Key in keyof AppearanceSettings]: AppearanceSettings[Key] extends number ? Key : never
}[keyof AppearanceSettings], undefined>;

const RANGE_CONTROLS: readonly {
  key: NumericAppearanceKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  group: "background" | "panel" | "atmosphere";
}[] = [
  { key: "backgroundDarkness", label: "背景压暗", min: 0, max: 80, step: 1, unit: "%", group: "background" },
  { key: "backgroundBlur", label: "背景模糊", min: 0, max: 30, step: 1, unit: "px", group: "background" },
  { key: "backgroundSaturation", label: "背景饱和度", min: 50, max: 160, step: 1, unit: "%", group: "background" },
  { key: "panelOpacity", label: "面板不透明度", min: 20, max: 100, step: 1, unit: "%", group: "panel" },
  { key: "panelBackdropBlur", label: "面板材质模糊", min: 0, max: 32, step: 1, unit: "px", group: "panel" },
  { key: "panelSaturation", label: "面板材质饱和度", min: 80, max: 150, step: 1, unit: "%", group: "panel" },
  { key: "tintStrength", label: "染色强度", min: 0, max: 40, step: 1, unit: "%", group: "atmosphere" },
  { key: "grainStrength", label: "颗粒强度", min: 0, max: 8, step: 0.1, unit: "%", group: "atmosphere" },
  { key: "vignetteStrength", label: "暗角强度", min: 0, max: 70, step: 1, unit: "%", group: "atmosphere" },
  { key: "ambientGlowStrength", label: "环境柔光", min: 0, max: 100, step: 1, unit: "%", group: "atmosphere" },
];

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, character => ({
    "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;",
  })[character] ?? character);
}

function ranges(group: "background" | "panel" | "atmosphere"): string {
  return RANGE_CONTROLS.filter(control => control.group === group).map(control => `
    <label class="appearance-range-row">
      <span>${control.label}</span>
      <input type="range" min="${control.min}" max="${control.max}" step="${control.step}" data-appearance-range="${control.key}">
      <output data-appearance-output="${control.key}"></output>
    </label>
  `).join("");
}

export class AppearanceView {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly openButton: HTMLButtonElement,
    private readonly dialog: HTMLDialogElement,
    private readonly content: HTMLElement,
    private readonly controller: AppearanceController,
    private readonly context: AppearanceViewContext | null = null,
  ) {
    this.renderShell();
    this.bindEvents();
    this.unsubscribe = this.controller.subscribe((settings, backgroundUrl) => {
      this.sync(settings, backgroundUrl);
    });
  }

  open(): void {
    if (!this.dialog.open) this.dialog.showModal();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private renderShell(): void {
    this.content.innerHTML = `
      <section class="appearance-section appearance-scope" aria-labelledby="appearance-scope-title">
        <div class="appearance-section-heading">
          <div>
            <h3 id="appearance-scope-title">正在编辑的仓库</h3>
            <p data-appearance-scope>外观属于当前仓库，保存到服务器；切换仓库会同步切换主题。</p>
          </div>
        </div>
      </section>
      <section class="appearance-section appearance-presets" aria-labelledby="appearance-presets-title">
        <div class="appearance-section-heading">
          <div><h3 id="appearance-presets-title">快速预设</h3><p>先选一种气质，再按喜好微调。</p></div>
          <span class="appearance-custom-badge" data-appearance-custom hidden>自定义</span>
        </div>
        <div class="appearance-preset-grid">
          ${APPEARANCE_PRESETS.map(item => `
            <button type="button" data-appearance-preset="${item.id}">
              <strong>${item.name}</strong><span>${item.description}</span>
            </button>
          `).join("")}
        </div>
      </section>

      <section class="appearance-section" aria-labelledby="appearance-colors-title">
        <div class="appearance-section-heading"><div><h3 id="appearance-colors-title">颜色</h3><p>强调色会同步到按钮、焦点与环境柔光。</p></div></div>
        <div class="appearance-color-grid">
          <label><span>强调色</span><span class="appearance-color-control"><input type="color" data-appearance-color="accentColor"><input type="text" maxlength="7" data-appearance-hex="accentColor" aria-label="强调色 Hex"></span></label>
          <label><span>背景染色</span><span class="appearance-color-control"><input type="color" data-appearance-color="tintColor"><input type="text" maxlength="7" data-appearance-hex="tintColor" aria-label="背景染色 Hex"></span></label>
        </div>
      </section>

      <section class="appearance-section appearance-background-section" aria-labelledby="appearance-background-title">
        <div class="appearance-section-heading"><div><h3 id="appearance-background-title">背景</h3><p>${this.context ? "上传的背景保存在服务器、跟随当前仓库；换设备也不会丢。" : "原图保存在当前浏览器的 IndexedDB，不会上传。"}</p></div></div>
        <div class="appearance-background-picker">
          <div class="appearance-background-preview" data-appearance-preview><span>使用默认背景</span></div>
          <div class="appearance-background-actions">
            <label class="button button-secondary appearance-file-button">选择图片<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-appearance-file></label>
            <button class="button button-ghost" type="button" data-appearance-remove-background>移除背景</button>
            <small data-appearance-background-note>${this.context ? "JPG / PNG / WebP / GIF，最大 25 MiB；保存到当前仓库。" : "JPG / PNG / WebP / GIF，最大 25 MiB"}</small>
          </div>
        </div>
        ${ranges("background")}
      </section>

      <section class="appearance-section" aria-labelledby="appearance-panel-title">
        <div class="appearance-section-heading"><div><h3 id="appearance-panel-title">面板材质</h3><p>与背景模糊完全独立，控制主库和详情等内容表面。</p></div></div>
        ${ranges("panel")}
      </section>

      <section class="appearance-section" aria-labelledby="appearance-atmosphere-title">
        <div class="appearance-section-heading"><div><h3 id="appearance-atmosphere-title">氛围</h3><p>轻量叠加染色、颗粒、暗角与环境柔光。</p></div></div>
        ${ranges("atmosphere")}
      </section>
      <p class="form-error appearance-error" role="alert" data-appearance-error hidden></p>
    `;
  }

  private bindEvents(): void {
    this.openButton.addEventListener("click", () => this.open());
    this.dialog.querySelectorAll<HTMLElement>("[data-close-appearance]").forEach(button => {
      button.addEventListener("click", () => this.dialog.close());
    });
    this.dialog.addEventListener("click", event => {
      if (event.target === this.dialog) this.dialog.close();
    });
    this.content.querySelectorAll<HTMLButtonElement>("[data-appearance-preset]").forEach(button => {
      button.addEventListener("click", () => {
        this.controller.applyPreset(button.dataset.appearancePreset as AppearanceSettings["presetId"] & string);
      });
    });
    this.content.querySelectorAll<HTMLInputElement>("[data-appearance-range]").forEach(input => {
      input.addEventListener("input", () => {
        const key = input.dataset.appearanceRange as NumericAppearanceKey;
        this.controller.update({ [key]: input.valueAsNumber });
      });
    });
    this.content.querySelectorAll<HTMLInputElement>("[data-appearance-color]").forEach(input => {
      input.addEventListener("input", () => {
        const key = input.dataset.appearanceColor as "accentColor" | "tintColor";
        this.controller.update({ [key]: input.value });
      });
    });
    this.content.querySelectorAll<HTMLInputElement>("[data-appearance-hex]").forEach(input => {
      const commit = () => {
        if (!/^#[0-9a-f]{6}$/i.test(input.value)) {
          this.sync(this.controller.getSettings(), this.controller.getBackgroundUrl());
          return;
        }
        const key = input.dataset.appearanceHex as "accentColor" | "tintColor";
        this.controller.update({ [key]: input.value.toLowerCase() });
      };
      input.addEventListener("change", commit);
      input.addEventListener("blur", commit);
    });
    const fileInput = this.content.querySelector<HTMLInputElement>("[data-appearance-file]");
    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      this.showError(null);
      try {
        if (this.context) {
          await this.context.onUploadBackground(file);
        } else {
          await this.controller.setBackgroundImage(file);
        }
      } catch (error) {
        this.showError(error instanceof Error ? error.message : "背景图片保存失败");
      } finally {
        fileInput.value = "";
      }
    });
    this.content.querySelector<HTMLButtonElement>("[data-appearance-remove-background]")?.addEventListener("click", async () => {
      this.showError(null);
      try {
        if (this.context) {
          await this.context.onRemoveBackground();
        } else {
          await this.controller.removeBackgroundImage();
        }
      } catch (error) {
        this.showError(error instanceof Error ? error.message : "背景图片移除失败");
      }
    });
    this.dialog.querySelector<HTMLButtonElement>("[data-reset-appearance]")?.addEventListener("click", async () => {
      if (!confirm("恢复默认外观并移除自定义背景？")) return;
      this.showError(null);
      try {
        if (this.context) {
          await this.context.onResetAppearance();
        } else {
          await this.controller.reset();
        }
      } catch (error) {
        this.showError(error instanceof Error ? error.message : "外观重置失败");
      }
    });
  }

  private sync(settings: AppearanceSettings, backgroundUrl: string | null): void {
    const vault = this.context?.getVault() ?? null;
    const scope = this.content.querySelector<HTMLElement>("[data-appearance-scope]");
    if (scope && vault) {
      scope.innerHTML = `正在编辑：<strong>${escapeVaultText(vault.icon || "📦" + " " + vault.name)}</strong>${this.context?.canEdit ? "" : "（访客只读，修改不会保存）"}`;
    }
    for (const control of RANGE_CONTROLS) {
      const input = this.content.querySelector<HTMLInputElement>(`[data-appearance-range="${control.key}"]`);
      const output = this.content.querySelector<HTMLOutputElement>(`[data-appearance-output="${control.key}"]`);
      if (input) input.value = String(settings[control.key]);
      if (output) output.value = `${settings[control.key]}${control.unit}`;
    }
    for (const key of ["accentColor", "tintColor"] as const) {
      const color = this.content.querySelector<HTMLInputElement>(`[data-appearance-color="${key}"]`);
      const hex = this.content.querySelector<HTMLInputElement>(`[data-appearance-hex="${key}"]`);
      if (color) color.value = settings[key];
      if (hex && document.activeElement !== hex) hex.value = settings[key];
    }
    this.content.querySelectorAll<HTMLButtonElement>("[data-appearance-preset]").forEach(button => {
      const active = button.dataset.appearancePreset === settings.presetId;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const custom = this.content.querySelector<HTMLElement>("[data-appearance-custom]");
    if (custom) custom.hidden = settings.presetId !== null;
    const preview = this.content.querySelector<HTMLElement>("[data-appearance-preview]");
    if (preview) {
      preview.style.backgroundImage = backgroundUrl ? `url("${escapeAttribute(backgroundUrl)}")` : "";
      preview.classList.toggle("has-image", Boolean(backgroundUrl));
      preview.innerHTML = backgroundUrl ? "" : "<span>使用默认背景</span>";
    }
    const remove = this.content.querySelector<HTMLButtonElement>("[data-appearance-remove-background]");
    if (remove) remove.disabled = !backgroundUrl;
    if (this.context) {
      // 访客只读：禁用全部编辑控件（预览仍实时跟随服务器主题）。
      this.content.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        "[data-appearance-preset], [data-appearance-range], [data-appearance-color], [data-appearance-hex], [data-appearance-file], [data-appearance-remove-background], [data-reset-appearance]",
      ).forEach(element => { element.disabled = !this.context?.canEdit; });
    }
  }


  private showError(message: string | null): void {
    const error = this.content.querySelector<HTMLElement>("[data-appearance-error]");
    if (!error) return;
    error.hidden = !message;
    error.textContent = message ?? "";
  }
}

function escapeVaultText(value: string): string {
  return value.replace(/[&"<>]/g, character => ({
    "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;",
  })[character] ?? character);
}
