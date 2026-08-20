import { findAppearancePreset } from "./appearance-presets";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  MAX_BACKGROUND_IMAGE_BYTES,
  type AppearancePresetId,
  type AppearanceSettings,
} from "./appearance-types";
import {
  IndexedDbAppearanceAssetStore,
  LocalAppearanceSettingsStore,
  type AppearanceAssetStore,
  type AppearanceSettingsStore,
} from "./appearance-storage";

const ALLOWED_BACKGROUND_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

type AppearanceListener = (settings: AppearanceSettings, backgroundUrl: string | null) => void;

export interface AppearanceControllerOptions {
  root?: HTMLElement;
  backgroundElement?: HTMLElement;
  settingsStore?: AppearanceSettingsStore;
  assetStore?: AppearanceAssetStore;
  urlApi?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  saveDelay?: number;
}

class UnavailableAssetStore implements AppearanceAssetStore {
  async getBackgroundImage(): Promise<Blob | null> { return null; }
  async setBackgroundImage(): Promise<void> { throw new Error("当前浏览器不支持背景图片存储"); }
  async removeBackgroundImage(): Promise<void> { return; }
}

function hexToRgb(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function accentInk(value: string): string {
  const [red, green, blue] = hexToRgb(value).map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.46
    ? "#10130b"
    : "#ffffff";
}

export class AppearanceController {
  private settings: AppearanceSettings;
  private backgroundUrl: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<AppearanceListener>();
  private readonly root: HTMLElement;
  private readonly backgroundElement: HTMLElement;
  private readonly settingsStore: AppearanceSettingsStore;
  private readonly assetStore: AppearanceAssetStore;
  private readonly urlApi: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  private readonly saveDelay: number;

  constructor(options: AppearanceControllerOptions = {}) {
    this.root = options.root ?? document.documentElement;
    this.backgroundElement = options.backgroundElement
      ?? document.querySelector<HTMLElement>("[data-appearance-background]")
      ?? document.createElement("div");
    this.settingsStore = options.settingsStore ?? new LocalAppearanceSettingsStore();
    this.assetStore = options.assetStore ?? (
      typeof indexedDB === "undefined"
        ? new UnavailableAssetStore()
        : new IndexedDbAppearanceAssetStore()
    );
    this.urlApi = options.urlApi ?? URL;
    this.saveDelay = options.saveDelay ?? 180;
    this.settings = this.settingsStore.load();
  }

  async load(): Promise<AppearanceSettings> {
    this.settings = this.settingsStore.load();
    this.apply();
    await this.restoreBackgroundImage();
    return this.getSettings();
  }

  apply(): void {
    const settings = this.settings;
    const [accentRed, accentGreen, accentBlue] = hexToRgb(settings.accentColor);
    const [tintRed, tintGreen, tintBlue] = hexToRgb(settings.tintColor);
    const styles: Record<string, string> = {
      "--accent": settings.accentColor,
      "--accent-color": settings.accentColor,
      "--accent-rgb": `${accentRed} ${accentGreen} ${accentBlue}`,
      "--accent-ink": accentInk(settings.accentColor),
      "--focus": settings.accentColor,
      "--appearance-background-darkness": String(settings.backgroundDarkness / 100),
      "--appearance-background-blur": `${settings.backgroundBlur}px`,
      "--appearance-background-saturation": `${settings.backgroundSaturation}%`,
      "--appearance-panel-opacity": String(settings.panelOpacity / 100),
      "--appearance-panel-fallback-opacity": String(Math.max(0.82, settings.panelOpacity / 100)),
      "--appearance-panel-blur": `${settings.panelBackdropBlur}px`,
      "--appearance-panel-saturation": `${settings.panelSaturation}%`,
      "--appearance-tint-rgb": `${tintRed} ${tintGreen} ${tintBlue}`,
      "--appearance-tint-strength": String(settings.tintStrength / 100),
      "--appearance-grain-strength": String(settings.grainStrength / 100),
      "--appearance-vignette-strength": String(settings.vignetteStrength / 100),
      "--appearance-glow-strength": String(settings.ambientGlowStrength / 100),
    };
    for (const [name, value] of Object.entries(styles)) {
      this.root.style.setProperty(name, value);
    }
    this.root.dataset.appearancePreset = settings.presetId ?? "custom";
    this.emit();
  }

  update(patch: Partial<Omit<AppearanceSettings, "presetId">>): AppearanceSettings {
    this.settings = { ...this.settings, ...patch, presetId: null };
    this.apply();
    this.scheduleSave();
    return this.getSettings();
  }

  applyPreset(id: AppearancePresetId): AppearanceSettings {
    const preset = findAppearancePreset(id);
    if (!preset) throw new Error(`未知外观预设：${id}`);
    this.settings = { ...preset.settings };
    this.apply();
    this.save();
    return this.getSettings();
  }

  save(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.settingsStore.save(this.settings);
  }

  async reset(): Promise<AppearanceSettings> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.assetStore.removeBackgroundImage();
    this.replaceBackgroundUrl(null);
    this.settings = { ...DEFAULT_APPEARANCE_SETTINGS };
    this.apply();
    this.settingsStore.save(this.settings);
    return this.getSettings();
  }

  async setBackgroundImage(blob: Blob): Promise<void> {
    this.validateBackgroundImage(blob);
    const nextUrl = this.urlApi.createObjectURL(blob);
    const previousUrl = this.backgroundUrl;
    this.backgroundUrl = nextUrl;
    this.renderBackground();
    this.emit();
    try {
      await this.assetStore.setBackgroundImage(blob);
      if (previousUrl) this.urlApi.revokeObjectURL(previousUrl);
    } catch (error) {
      this.urlApi.revokeObjectURL(nextUrl);
      this.backgroundUrl = previousUrl;
      this.renderBackground();
      this.emit();
      throw error;
    }
  }

  async removeBackgroundImage(): Promise<void> {
    await this.assetStore.removeBackgroundImage();
    this.replaceBackgroundUrl(null);
  }

  async restoreBackgroundImage(): Promise<void> {
    try {
      const blob = await this.assetStore.getBackgroundImage();
      if (blob) {
        this.validateBackgroundImage(blob);
        this.replaceBackgroundUrl(this.urlApi.createObjectURL(blob));
      } else {
        this.replaceBackgroundUrl(null);
      }
    } catch {
      this.replaceBackgroundUrl(null);
    }
  }

  subscribe(listener: AppearanceListener): () => void {
    this.listeners.add(listener);
    listener(this.getSettings(), this.backgroundUrl);
    return () => this.listeners.delete(listener);
  }

  getSettings(): AppearanceSettings {
    return { ...this.settings };
  }

  getBackgroundUrl(): string | null {
    return this.backgroundUrl;
  }

  destroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.settingsStore.save(this.settings);
    }
    this.replaceBackgroundUrl(null);
    this.listeners.clear();
  }

  private validateBackgroundImage(blob: Blob): void {
    if (!blob.size) throw new Error("背景图片不能为空");
    if (blob.size > MAX_BACKGROUND_IMAGE_BYTES) throw new Error("背景图片不能超过 25 MiB");
    if (!ALLOWED_BACKGROUND_TYPES.has(blob.type.toLowerCase())) {
      throw new Error("仅支持 JPG、PNG、WebP 或 GIF 背景图片");
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), this.saveDelay);
  }

  private replaceBackgroundUrl(nextUrl: string | null): void {
    const previousUrl = this.backgroundUrl;
    this.backgroundUrl = nextUrl;
    this.renderBackground();
    if (previousUrl && previousUrl !== nextUrl) this.urlApi.revokeObjectURL(previousUrl);
    this.emit();
  }

  private renderBackground(): void {
    this.backgroundElement.style.backgroundImage = this.backgroundUrl
      ? `url("${this.backgroundUrl.replace(/"/g, "%22")}")`
      : "";
    this.backgroundElement.toggleAttribute("data-has-custom-background", Boolean(this.backgroundUrl));
  }

  private emit(): void {
    const settings = this.getSettings();
    for (const listener of this.listeners) listener(settings, this.backgroundUrl);
  }
}
