import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppearanceController } from "./appearance-controller";
import { APPEARANCE_PRESETS } from "./appearance-presets";
import {
  LocalAppearanceSettingsStore,
  type AppearanceAssetStore,
} from "./appearance-storage";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_SETTINGS,
  type AppearanceSettings,
} from "./appearance-types";

class MemoryAssetStore implements AppearanceAssetStore {
  blob: Blob | null = null;
  failWrite = false;

  async getBackgroundImage(): Promise<Blob | null> { return this.blob; }
  async setBackgroundImage(blob: Blob): Promise<void> {
    if (this.failWrite) throw new Error("write failed");
    this.blob = blob;
  }
  async removeBackgroundImage(): Promise<void> { this.blob = null; }
}

function makeController(assetStore = new MemoryAssetStore()) {
  const background = document.createElement("div");
  const createObjectURL = vi.fn((blob: Blob) => `blob:${blob.size}:${Math.random()}`);
  const revokeObjectURL = vi.fn();
  const controller = new AppearanceController({
    root: document.documentElement,
    backgroundElement: background,
    settingsStore: new LocalAppearanceSettingsStore(localStorage),
    assetStore,
    urlApi: { createObjectURL, revokeObjectURL },
    saveDelay: 180,
  });
  return { controller, background, assetStore, createObjectURL, revokeObjectURL };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("appearance settings", () => {
  it("defines all seven product presets with complete independent settings", () => {
    expect(APPEARANCE_PRESETS.map(item => item.id)).toEqual([
      "default", "clean", "glass", "acrylic", "midnight", "dreamy", "immersive",
    ]);
    for (const preset of APPEARANCE_PRESETS) {
      expect(preset.settings.presetId).toBe(preset.id);
      expect(preset.settings).toHaveProperty("panelBackdropBlur");
      expect(preset.settings).toHaveProperty("ambientGlowStrength");
    }
    expect(Object.fromEntries(APPEARANCE_PRESETS.map(item => [item.id, item.settings.accentColor])))
      .toMatchObject({
        clean: "#7fcb45",
        glass: "#74c7ff",
        acrylic: "#d49a68",
        immersive: "#c7cbc7",
      });
  });

  it("falls back safely from corrupt or out-of-range local storage", () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, "not-json");
    expect(new LocalAppearanceSettingsStore().load()).toEqual(DEFAULT_APPEARANCE_SETTINGS);
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({
      accentColor: "unsafe",
      backgroundBlur: 999,
      panelOpacity: -20,
      tintStrength: 14,
    }));
    expect(new LocalAppearanceSettingsStore().load()).toMatchObject({
      accentColor: DEFAULT_APPEARANCE_SETTINGS.accentColor,
      backgroundBlur: 30,
      panelOpacity: 20,
      tintStrength: 14,
    });
  });

  it("maps settings to independent background and panel CSS variables", async () => {
    const { controller } = makeController();
    await controller.load();
    controller.update({
      accentColor: "#123456",
      backgroundBlur: 17,
      panelBackdropBlur: 29,
      panelOpacity: 45,
      tintColor: "#abcdef",
    });
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--accent")).toBe("#123456");
    expect(style.getPropertyValue("--accent-rgb")).toBe("18 52 86");
    expect(style.getPropertyValue("--appearance-background-blur")).toBe("17px");
    expect(style.getPropertyValue("--appearance-panel-blur")).toBe("29px");
    expect(style.getPropertyValue("--appearance-panel-opacity")).toBe("0.45");
    expect(style.getPropertyValue("--appearance-tint-rgb")).toBe("171 205 239");
    expect(controller.getSettings().presetId).toBeNull();
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(180);
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}"))
      .toMatchObject({ backgroundBlur: 17, panelBackdropBlur: 29, presetId: null });
  });

  it("applies and persists presets immediately", () => {
    const { controller } = makeController();
    const settings = controller.applyPreset("dreamy");
    expect(settings.presetId).toBe("dreamy");
    expect(document.documentElement.dataset.appearancePreset).toBe("dreamy");
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}").presetId).toBe("dreamy");
  });
});

describe("appearance background lifecycle", () => {
  it("stores, restores, replaces and removes background blobs while revoking URLs", async () => {
    const assetStore = new MemoryAssetStore();
    const first = makeController(assetStore);
    await first.controller.setBackgroundImage(new Blob(["first"], { type: "image/png" }));
    const firstUrl = first.controller.getBackgroundUrl();
    expect(first.background.style.backgroundImage).toContain("blob:");

    await first.controller.setBackgroundImage(new Blob(["second"], { type: "image/webp" }));
    expect(first.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    await first.controller.removeBackgroundImage();
    expect(assetStore.blob).toBeNull();
    expect(first.background.style.backgroundImage).toBe("");

    assetStore.blob = new Blob(["restored"], { type: "image/jpeg" });
    const second = makeController(assetStore);
    await second.controller.restoreBackgroundImage();
    expect(second.createObjectURL).toHaveBeenCalledTimes(1);
    expect(second.background.hasAttribute("data-has-custom-background")).toBe(true);
    second.controller.destroy();
    expect(second.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid files and restores the old preview after a failed write", async () => {
    const setup = makeController();
    await expect(setup.controller.setBackgroundImage(new Blob([], { type: "image/png" })))
      .rejects.toThrow("不能为空");
    await expect(setup.controller.setBackgroundImage(new Blob(["x"], { type: "text/plain" })))
      .rejects.toThrow("仅支持");

    await setup.controller.setBackgroundImage(new Blob(["ok"], { type: "image/png" }));
    const oldUrl = setup.controller.getBackgroundUrl();
    setup.assetStore.failWrite = true;
    await expect(setup.controller.setBackgroundImage(new Blob(["new"], { type: "image/png" })))
      .rejects.toThrow("write failed");
    expect(setup.controller.getBackgroundUrl()).toBe(oldUrl);
  });

  it("reset removes the blob, URL and saved custom settings", async () => {
    const setup = makeController();
    setup.controller.update({ backgroundDarkness: 70 } as Partial<AppearanceSettings>);
    await setup.controller.setBackgroundImage(new Blob(["ok"], { type: "image/gif" }));
    await setup.controller.reset();
    expect(setup.assetStore.blob).toBeNull();
    expect(setup.controller.getSettings()).toEqual(DEFAULT_APPEARANCE_SETTINGS);
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}")).toEqual(DEFAULT_APPEARANCE_SETTINGS);
    expect(setup.background.style.backgroundImage).toBe("");
  });
});
