import {
  DEFAULT_FREE_GALLERY_TUNING,
  type FreeGalleryTuning,
} from "./occupancy-grid";

export const FREE_GALLERY_TUNING_KEY = "meme-vault.immersive-gallery-tuning";

type TuningField = keyof FreeGalleryTuning;

const FIELD_CONFIG: ReadonlyArray<{
  key: TuningField;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}> = [
  { key: "density", label: "密度", min: 30, max: 100, step: 1, unit: "%" },
  { key: "whitespaceSize", label: "留白大小", min: 0.35, max: 2.5, step: 0.05, unit: "×" },
  { key: "horizontalFreedom", label: "横向自由度", min: 0, max: 1.5, step: 0.05, unit: "×" },
  { key: "topContour", label: "顶部轮廓", min: 0, max: 2, step: 0.05, unit: "×" },
  { key: "edgePadding", label: "边缘留白", min: 0, max: 120, step: 2, unit: "px" },
  { key: "backgroundParticipation", label: "背景参与感", min: 0, max: 2, step: 0.05, unit: "×" },
];

function clamp(minimum: number, value: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeFreeGalleryTuning(
  value: Partial<Record<TuningField, unknown>>,
): FreeGalleryTuning {
  return Object.fromEntries(FIELD_CONFIG.map(field => {
    const rawCandidate = Number(value[field.key]);
    const candidate = field.key === "density" && rawCandidate > 0 && rawCandidate <= 2
      ? rawCandidate * 70
      : rawCandidate;
    const fallback = DEFAULT_FREE_GALLERY_TUNING[field.key];
    return [field.key, Number.isFinite(candidate)
      ? clamp(field.min, candidate, field.max)
      : fallback];
  })) as unknown as FreeGalleryTuning;
}

export function storedFreeGalleryTuning(): FreeGalleryTuning {
  try {
    const raw = localStorage.getItem(FREE_GALLERY_TUNING_KEY);
    if (!raw) return { ...DEFAULT_FREE_GALLERY_TUNING };
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? normalizeFreeGalleryTuning(parsed as Partial<Record<TuningField, unknown>>)
      : { ...DEFAULT_FREE_GALLERY_TUNING };
  } catch {
    return { ...DEFAULT_FREE_GALLERY_TUNING };
  }
}

function fieldValue(value: number, unit: string): string {
  if (unit === "px") return `${Math.round(value)}px`;
  if (unit === "%") return `${Math.round(value)}%`;
  return `${value.toFixed(2)}×`;
}

export class FreeGalleryLayoutTuner {
  private tuning = storedFreeGalleryTuning();
  private frameId: number | null = null;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly panel: HTMLElement,
    private readonly onChange: (tuning: Readonly<FreeGalleryTuning>) => void,
  ) {
    this.render();
    this.button.addEventListener("click", this.toggle);
    this.panel.addEventListener("input", this.handleInput);
    this.panel.addEventListener("click", this.handleClick);
    this.onChange(this.value);
  }

  get value(): FreeGalleryTuning {
    return { ...this.tuning };
  }

  destroy(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.button.removeEventListener("click", this.toggle);
    this.panel.removeEventListener("input", this.handleInput);
    this.panel.removeEventListener("click", this.handleClick);
  }

  private render(): void {
    this.panel.innerHTML = `
      <header class="gallery-tuner-header">
        <div><strong>Free Gallery 炼丹炉</strong><span>拖动后实时重排</span></div>
        <button type="button" data-gallery-tuner-close aria-label="关闭调参面板">×</button>
      </header>
      <div class="gallery-tuner-fields">
        ${FIELD_CONFIG.map(field => `
          <label class="gallery-tuner-field">
            <span>${field.label}<output data-gallery-tuner-output="${field.key}">${fieldValue(this.tuning[field.key], field.unit)}</output></span>
            <input type="range" min="${field.min}" max="${field.max}" step="${field.step}"
              value="${this.tuning[field.key]}" data-gallery-tuner-field="${field.key}"
              aria-label="${field.label}">
          </label>`).join("")}
      </div>
      <footer class="gallery-tuner-actions">
        <button type="button" data-gallery-tuner-reset>恢复默认</button>
        <button type="button" data-gallery-tuner-copy>复制参数</button>
      </footer>`;
  }

  private scheduleChange(): void {
    localStorage.setItem(FREE_GALLERY_TUNING_KEY, JSON.stringify(this.tuning));
    if (this.frameId !== null) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      this.onChange(this.value);
    });
  }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
  }

  private readonly toggle = (): void => {
    this.setOpen(Boolean(this.panel.hidden));
  };

  private readonly handleInput = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const key = input.dataset.galleryTunerField as TuningField | undefined;
    const config = FIELD_CONFIG.find(field => field.key === key);
    if (!key || !config) return;
    const value = clamp(config.min, Number(input.value), config.max);
    this.tuning = { ...this.tuning, [key]: value };
    const output = this.panel.querySelector<HTMLOutputElement>(
      `[data-gallery-tuner-output="${key}"]`,
    );
    if (output) output.value = fieldValue(value, config.unit);
    this.scheduleChange();
  };

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-gallery-tuner-close]")) {
      this.setOpen(false);
      return;
    }
    if (target.closest("[data-gallery-tuner-reset]")) {
      this.tuning = { ...DEFAULT_FREE_GALLERY_TUNING };
      this.render();
      this.scheduleChange();
      return;
    }
    const copy = target.closest<HTMLButtonElement>("[data-gallery-tuner-copy]");
    if (!copy) return;
    const payload = JSON.stringify(this.tuning, null, 2);
    void navigator.clipboard?.writeText(payload).then(() => {
      copy.textContent = "已复制";
      setTimeout(() => { copy.textContent = "复制参数"; }, 900);
    });
  };
}
