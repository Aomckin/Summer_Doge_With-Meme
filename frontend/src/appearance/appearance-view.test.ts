import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppearanceController } from "./appearance-controller";
import { AppearanceView } from "./appearance-view";
import { LocalAppearanceSettingsStore, type AppearanceAssetStore } from "./appearance-storage";
import { APPEARANCE_STORAGE_KEY } from "./appearance-types";

const emptyAssets: AppearanceAssetStore = {
  getBackgroundImage: async () => null,
  setBackgroundImage: async () => undefined,
  removeBackgroundImage: async () => undefined,
};

beforeEach(() => {
  document.body.innerHTML = `
    <button id="open">外观</button>
    <div data-background></div>
    <dialog id="dialog">
      <button data-reset-appearance>恢复默认</button>
      <button data-close-appearance>关闭</button>
      <div id="content"></div>
    </dialog>`;
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("AppearanceView", () => {
  it("opens independently, applies presets immediately and marks manual input custom", async () => {
    const controller = new AppearanceController({
      root: document.documentElement,
      backgroundElement: document.querySelector<HTMLElement>("[data-background]")!,
      settingsStore: new LocalAppearanceSettingsStore(localStorage),
      assetStore: emptyAssets,
      urlApi: { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined },
      saveDelay: 180,
    });
    new AppearanceView(
      document.querySelector<HTMLButtonElement>("#open")!,
      document.querySelector<HTMLDialogElement>("#dialog")!,
      document.querySelector<HTMLElement>("#content")!,
      controller,
    );

    document.querySelector<HTMLButtonElement>("#open")!.click();
    expect(document.querySelector<HTMLDialogElement>("#dialog")!.open).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-appearance-preset="glass"]')!.click();
    expect(controller.getSettings().presetId).toBe("glass");
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}").presetId).toBe("glass");

    const blur = document.querySelector<HTMLInputElement>('[data-appearance-range="backgroundBlur"]')!;
    blur.value = "19";
    blur.dispatchEvent(new Event("input", { bubbles: true }));
    expect(controller.getSettings()).toMatchObject({ presetId: null, backgroundBlur: 19 });
    expect(document.querySelector<HTMLElement>("[data-appearance-custom]")!.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(180);
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}").backgroundBlur).toBe(19);
  });
});
