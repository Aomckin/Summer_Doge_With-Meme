import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FREE_GALLERY_TUNING } from "./occupancy-grid";
import {
  FREE_GALLERY_TUNING_KEY,
  FreeGalleryLayoutTuner,
  normalizeFreeGalleryTuning,
  storedFreeGalleryTuning,
} from "./layout-tuner";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("FreeGalleryLayoutTuner", () => {
  it("normalizes persisted values and rejects corrupt storage", () => {
    expect(normalizeFreeGalleryTuning({ density: 999, edgePadding: -10 })).toMatchObject({
      density: 100,
      edgePadding: 0,
    });
    expect(normalizeFreeGalleryTuning({ density: 1 })).toMatchObject({ density: 70 });
    localStorage.setItem(FREE_GALLERY_TUNING_KEY, "not-json");
    expect(storedFreeGalleryTuning()).toEqual(DEFAULT_FREE_GALLERY_TUNING);
  });

  it("renders all six controls and applies changes without refresh", async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const button = document.createElement("button");
    const panel = document.createElement("aside");
    panel.hidden = true;
    const changes: unknown[] = [];
    const tuner = new FreeGalleryLayoutTuner(button, panel, tuning => changes.push(tuning));
    expect(panel.querySelectorAll("[data-gallery-tuner-field]")).toHaveLength(6);
    button.click();
    expect(panel.hidden).toBe(false);

    const density = panel.querySelector<HTMLInputElement>(
      '[data-gallery-tuner-field="density"]',
    )!;
    density.value = "85";
    density.dispatchEvent(new Event("input", { bubbles: true }));
    callbacks.shift()?.(performance.now());
    expect(changes.at(-1)).toMatchObject({ density: 85 });
    expect(JSON.parse(localStorage.getItem(FREE_GALLERY_TUNING_KEY)!)).toMatchObject({
      density: 85,
    });
    tuner.destroy();
  });

  it("restores defaults from the panel", () => {
    localStorage.setItem(FREE_GALLERY_TUNING_KEY, JSON.stringify({ density: 90 }));
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const button = document.createElement("button");
    const panel = document.createElement("aside");
    const changes: unknown[] = [];
    new FreeGalleryLayoutTuner(button, panel, tuning => changes.push(tuning));
    panel.querySelector<HTMLButtonElement>("[data-gallery-tuner-reset]")!.click();
    callbacks.shift()?.(performance.now());
    expect(changes.at(-1)).toEqual(DEFAULT_FREE_GALLERY_TUNING);
  });
});
