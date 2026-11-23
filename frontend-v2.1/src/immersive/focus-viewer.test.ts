import { afterEach, describe, expect, it, vi } from "vitest";

import type { ImmersiveMediaLoader } from "./immersive-media";
import { ImmersiveFocusViewer } from "./focus-viewer";

const viewers: ImmersiveFocusViewer[] = [];

function fixture(imageCount = 1) {
  document.documentElement.dataset.vaultMode = "immersive";
  const grid = document.createElement("div");
  const item = document.createElement("div");
  item.className = "immersive-layout-item gallery-layout-item";
  item.dataset.immersiveLayoutId = "7";
  const manifest = Array.from({ length: imageCount }, (_, index) => `
    <span data-focus-media data-thumbnail-src="/thumb-${index}.webp"
      data-original-src="/original-${index}.gif" data-width="800" data-height="600"
      data-alt="image ${index + 1}"></span>`).join("");
  item.innerHTML = `<div class="meme-card-physics"><article class="meme-card"
    data-meme-id="7" data-card-width="800" data-card-height="600">
    <button class="meme-card-main" data-open-meme><span class="card-image"><img data-card-image
      data-thumbnail-src="/thumb-0.webp" data-original-src="/original-0.gif"
      src="/original-0.gif"></span></button>
    <template data-focus-media-manifest>${manifest}</template>
  </article></div>`;
  vi.spyOn(item, "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 140, 240, 180),
  );
  grid.append(item);
  document.body.append(grid);
  const media = {
    ensureOriginal: vi.fn(() => Promise.resolve()),
  } as unknown as ImmersiveMediaLoader;
  const viewer = new ImmersiveFocusViewer(grid, media, { duration: 0 });
  viewers.push(viewer);
  return { grid, item, image: item.querySelector<HTMLImageElement>("img")!, media, viewer };
}

afterEach(() => {
  for (const viewer of viewers.splice(0)) viewer.destroy();
  document.body.innerHTML = "";
  delete document.documentElement.dataset.vaultMode;
  delete document.documentElement.dataset.immersiveFocus;
  document.documentElement.style.removeProperty("overflow");
  vi.restoreAllMocks();
});

describe("ImmersiveFocusViewer", () => {
  it("reuses the current image and moves the card into a continuous focus layer", async () => {
    const { grid, item, image, media, viewer } = fixture();
    item.querySelector<HTMLButtonElement>("[data-open-meme]")!.click();
    await Promise.resolve();
    expect(viewer.isOpen()).toBe(true);
    expect(document.documentElement.dataset.immersiveFocus).toBe("open");
    expect(item.parentElement?.classList.contains("immersive-focus-layer")).toBe(true);
    expect(item.querySelector("img")).toBe(image);
    expect(media.ensureOriginal).toHaveBeenCalledWith(item);
    expect(item.style.position).toBe("fixed");
    expect(item.style.width).toMatch(/px$/);

    item.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(viewer.isOpen()).toBe(false);
    expect(item.parentElement).toBe(grid);
    expect(item.querySelector("img")).toBe(image);
  });

  it("shows every image in a multi-image Meme and restores the original card DOM", async () => {
    const { grid, item, image, media, viewer } = fixture(3);
    await viewer.open(item);
    expect(item.querySelectorAll(".immersive-focus-media-stack [data-card-image]")).toHaveLength(3);
    expect(item.querySelector("[data-card-image]")).toBe(image);
    expect(media.ensureOriginal).toHaveBeenCalledWith(item);

    await viewer.close(true);
    expect(item.parentElement).toBe(grid);
    expect(item.querySelector(".immersive-focus-media-stack")).toBeNull();
    expect(item.querySelectorAll("[data-card-image]")).toHaveLength(1);
    expect(item.querySelector("[data-card-image]")).toBe(image);
  });

  it("announces temporary grid detach and restore around focus", async () => {
    const before = vi.fn();
    const after = vi.fn();
    const { grid, item, media, viewer: original } = fixture();
    original.destroy();
    const viewer = new ImmersiveFocusViewer(grid, media, {
      duration: 0,
      onBeforeDetach: before,
      onAfterRestore: after,
    });
    viewers.push(viewer);
    await viewer.open(item);
    expect(before).toHaveBeenCalledWith(item);
    expect(after).not.toHaveBeenCalled();
    await viewer.close(true);
    expect(after).toHaveBeenCalledWith(item);
  });

  it("closes from the dimmed background", async () => {
    const { item, viewer } = fixture();
    await viewer.open(item);
    document.querySelector<HTMLElement>(".immersive-focus-layer")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(viewer.isOpen()).toBe(false);
  });

  it("consumes Escape before the immersive controller can exit", async () => {
    const { item, viewer } = fixture();
    const laterHandler = vi.fn();
    document.addEventListener("keydown", laterHandler, { once: true });
    await viewer.open(item);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(viewer.isOpen()).toBe(false);
    expect(laterHandler).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.vaultMode).toBe("immersive");
  });

  it("does not intercept card clicks in ordinary mode", () => {
    const { item, viewer } = fixture();
    document.documentElement.dataset.vaultMode = "normal";
    item.querySelector<HTMLButtonElement>("[data-open-meme]")!.click();
    expect(viewer.isOpen()).toBe(false);
  });
});
