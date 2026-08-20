import {
  APPEARANCE_ASSET_STORE,
  APPEARANCE_DATABASE_NAME,
  APPEARANCE_RANGES,
  APPEARANCE_STORAGE_KEY,
  BACKGROUND_IMAGE_KEY,
  DEFAULT_APPEARANCE_SETTINGS,
  type AppearancePresetId,
  type AppearanceSettings,
} from "./appearance-types";
import { APPEARANCE_PRESETS } from "./appearance-presets";

export interface AppearanceAssetStore {
  getBackgroundImage(): Promise<Blob | null>;
  setBackgroundImage(blob: Blob): Promise<void>;
  removeBackgroundImage(): Promise<void>;
}

export interface AppearanceSettingsStore {
  load(): AppearanceSettings;
  save(settings: AppearanceSettings): void;
  clear(): void;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function numberWithin(
  value: unknown,
  fallback: number,
  range: readonly [number, number],
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(range[1], Math.max(range[0], value));
}

export function sanitizeAppearanceSettings(value: unknown): AppearanceSettings {
  const source = value && typeof value === "object"
    ? value as Partial<AppearanceSettings>
    : {};
  const presetIds = new Set(APPEARANCE_PRESETS.map(item => item.id));
  const presetId = source.presetId === null || presetIds.has(source.presetId as AppearancePresetId)
    ? source.presetId ?? null
    : DEFAULT_APPEARANCE_SETTINGS.presetId;
  return {
    presetId,
    accentColor: isHexColor(source.accentColor)
      ? source.accentColor.toLowerCase()
      : DEFAULT_APPEARANCE_SETTINGS.accentColor,
    backgroundDarkness: numberWithin(source.backgroundDarkness, DEFAULT_APPEARANCE_SETTINGS.backgroundDarkness, APPEARANCE_RANGES.backgroundDarkness),
    backgroundBlur: numberWithin(source.backgroundBlur, DEFAULT_APPEARANCE_SETTINGS.backgroundBlur, APPEARANCE_RANGES.backgroundBlur),
    backgroundSaturation: numberWithin(source.backgroundSaturation, DEFAULT_APPEARANCE_SETTINGS.backgroundSaturation, APPEARANCE_RANGES.backgroundSaturation),
    panelOpacity: numberWithin(source.panelOpacity, DEFAULT_APPEARANCE_SETTINGS.panelOpacity, APPEARANCE_RANGES.panelOpacity),
    panelBackdropBlur: numberWithin(source.panelBackdropBlur, DEFAULT_APPEARANCE_SETTINGS.panelBackdropBlur, APPEARANCE_RANGES.panelBackdropBlur),
    panelSaturation: numberWithin(source.panelSaturation, DEFAULT_APPEARANCE_SETTINGS.panelSaturation, APPEARANCE_RANGES.panelSaturation),
    tintColor: isHexColor(source.tintColor)
      ? source.tintColor.toLowerCase()
      : DEFAULT_APPEARANCE_SETTINGS.tintColor,
    tintStrength: numberWithin(source.tintStrength, DEFAULT_APPEARANCE_SETTINGS.tintStrength, APPEARANCE_RANGES.tintStrength),
    grainStrength: numberWithin(source.grainStrength, DEFAULT_APPEARANCE_SETTINGS.grainStrength, APPEARANCE_RANGES.grainStrength),
    vignetteStrength: numberWithin(source.vignetteStrength, DEFAULT_APPEARANCE_SETTINGS.vignetteStrength, APPEARANCE_RANGES.vignetteStrength),
    ambientGlowStrength: numberWithin(source.ambientGlowStrength, DEFAULT_APPEARANCE_SETTINGS.ambientGlowStrength, APPEARANCE_RANGES.ambientGlowStrength),
  };
}

export class LocalAppearanceSettingsStore implements AppearanceSettingsStore {
  constructor(private readonly storage: Storage = localStorage) {}

  load(): AppearanceSettings {
    try {
      const raw = this.storage.getItem(APPEARANCE_STORAGE_KEY);
      return raw ? sanitizeAppearanceSettings(JSON.parse(raw)) : { ...DEFAULT_APPEARANCE_SETTINGS };
    } catch {
      return { ...DEFAULT_APPEARANCE_SETTINGS };
    }
  }

  save(settings: AppearanceSettings): void {
    this.storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
  }

  clear(): void {
    this.storage.removeItem(APPEARANCE_STORAGE_KEY);
  }
}

interface StoredAppearanceAsset {
  key: string;
  blob: Blob;
}

export class IndexedDbAppearanceAssetStore implements AppearanceAssetStore {
  constructor(private readonly factory: IDBFactory = indexedDB) {}

  async getBackgroundImage(): Promise<Blob | null> {
    const record = await this.request<StoredAppearanceAsset | undefined>("readonly", store => store.get(BACKGROUND_IMAGE_KEY));
    return record?.blob instanceof Blob ? record.blob : null;
  }

  async setBackgroundImage(blob: Blob): Promise<void> {
    await this.request("readwrite", store => store.put({ key: BACKGROUND_IMAGE_KEY, blob }));
  }

  async removeBackgroundImage(): Promise<void> {
    await this.request("readwrite", store => store.delete(BACKGROUND_IMAGE_KEY));
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(APPEARANCE_DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(APPEARANCE_ASSET_STORE)) {
          request.result.createObjectStore(APPEARANCE_ASSET_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("无法打开外观资源数据库"));
      request.onblocked = () => reject(new Error("外观资源数据库被其他页面占用"));
    });
  }

  private async request<T = unknown>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(APPEARANCE_ASSET_STORE, mode);
        const request = operation(transaction.objectStore(APPEARANCE_ASSET_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("外观资源读写失败"));
        transaction.onabort = () => reject(transaction.error ?? new Error("外观资源事务已中止"));
      });
    } finally {
      database.close();
    }
  }
}
