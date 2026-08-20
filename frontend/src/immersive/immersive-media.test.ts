import { afterEach, describe, expect, it, vi } from "vitest";

import { ImmersiveMediaLoader } from "./immersive-media";

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];
  readonly observed = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
    TestIntersectionObserver.instances.push(this);
  }

  observe = (target: Element) => { this.observed.add(target); };
  unobserve = (target: Element) => { this.observed.delete(target); };
  disconnect = () => { this.observed.clear(); };
  takeRecords = () => [];

  intersect(target: Element): void {
    this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function card(id: number, original = `/media/${id}.gif`): HTMLElement {
  const element = document.createElement("article");
  element.className = "meme-card";
  element.dataset.memeId = String(id);
  element.innerHTML = `<img data-card-image data-thumbnail-src="/thumb/${id}.webp"
    data-original-src="${original}" src="/thumb/${id}.webp">`;
  return element;
}

afterEach(() => {
  TestIntersectionObserver.instances = [];
  vi.unstubAllGlobals();
});

describe("ImmersiveMediaLoader", () => {
  it("upgrades only media entering the viewport margin, including GIFs", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const grid = document.createElement("div");
    grid.dataset.cardSize = "small";
    const first = card(1);
    const second = card(2, "/media/2.png");
    grid.append(first, second);
    document.body.append(grid);
    const loadOriginal = vi.fn(() => Promise.resolve());
    const loader = new ImmersiveMediaLoader(grid, { loadOriginal });
    loader.activate();
    const observer = TestIntersectionObserver.instances[0]!;
    const gif = first.querySelector<HTMLImageElement>("img")!;
    observer.intersect(gif);
    await Promise.resolve();
    await Promise.resolve();
    expect(loadOriginal).toHaveBeenCalledWith("/media/1.gif");
    expect(gif.getAttribute("src")).toBe("/media/1.gif");
    expect(gif.dataset.immersiveMediaState).toBe("original-ready");
    expect(second.querySelector("img")?.getAttribute("src")).toBe("/thumb/2.webp");
    loader.destroy();
    grid.remove();
  });

  it("uses original JPG, PNG and WebP sources through the same lazy path", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const grid = document.createElement("div");
    const cards = ["jpg", "png", "webp"].map((extension, index) =>
      card(index + 10, `/media/${index + 10}.${extension}`),
    );
    grid.append(...cards);
    document.body.append(grid);
    const loader = new ImmersiveMediaLoader(grid, { loadOriginal: () => Promise.resolve() });
    loader.activate();
    const observer = TestIntersectionObserver.instances[0]!;
    for (const element of cards) {
      observer.intersect(element.querySelector<HTMLImageElement>("img")!);
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(cards.map(element => element.querySelector("img")?.getAttribute("src"))).toEqual([
      "/media/10.jpg",
      "/media/11.png",
      "/media/12.webp",
    ]);
    loader.destroy();
    grid.remove();
  });

  it("keeps the thumbnail when original loading fails", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const grid = document.createElement("div");
    const element = card(3, "/media/broken.jpg");
    grid.append(element);
    document.body.append(grid);
    const loader = new ImmersiveMediaLoader(grid, {
      loadOriginal: () => Promise.reject(new Error("broken")),
    });
    loader.activate();
    const image = element.querySelector<HTMLImageElement>("img")!;
    TestIntersectionObserver.instances[0]!.intersect(image);
    await Promise.resolve();
    await Promise.resolve();
    expect(image.getAttribute("src")).toBe("/thumb/3.webp");
    expect(image.dataset.immersiveMediaState).toBe("original-error");
    loader.destroy();
    grid.remove();
  });

  it("upgrades every image created for a multi-image focus view", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const grid = document.createElement("div");
    document.body.append(grid);
    const loadOriginal = vi.fn(() => Promise.resolve());
    const loader = new ImmersiveMediaLoader(grid, { loadOriginal });
    loader.activate();
    const focused = document.createElement("div");
    focused.innerHTML = [1, 2, 3].map(id => `<img data-card-image
      data-thumbnail-src="/thumb/${id}.webp" data-original-src="/media/${id}.png"
      src="/thumb/${id}.webp">`).join("");
    document.body.append(focused);
    await loader.ensureOriginal(focused);
    expect(loadOriginal).toHaveBeenCalledTimes(3);
    expect([...focused.querySelectorAll("img")].map(image => image.getAttribute("src"))).toEqual([
      "/media/1.png", "/media/2.png", "/media/3.png",
    ]);
    loader.destroy();
    focused.remove();
    grid.remove();
  });

  it("observes appended cards and restores thumbnails on exit", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const grid = document.createElement("div");
    document.body.append(grid);
    const loader = new ImmersiveMediaLoader(grid, { loadOriginal: () => Promise.resolve() });
    loader.activate();
    const appended = card(4);
    grid.append(appended);
    await Promise.resolve();
    await Promise.resolve();
    const image = appended.querySelector<HTMLImageElement>("img")!;
    expect(TestIntersectionObserver.instances[0]!.observed.has(image)).toBe(true);
    TestIntersectionObserver.instances[0]!.intersect(image);
    await Promise.resolve();
    await Promise.resolve();
    loader.deactivate();
    expect(image.getAttribute("src")).toBe("/thumb/4.webp");
    expect(image.dataset.immersiveMediaState).toBe("thumbnail");
    loader.destroy();
    grid.remove();
  });
});
