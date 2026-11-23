import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImmersiveRandomNavigator } from "./immersive-random";

function makeGrid(ids: number[]): HTMLElement {
  const grid = document.createElement("div");
  for (const id of ids) {
    const card = document.createElement("article");
    card.dataset.memeId = String(id);
    card.scrollIntoView = vi.fn();
    grid.append(card);
  }
  return grid;
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ImmersiveRandomNavigator", () => {
  it("visits mounted loaded memes, scrolls smoothly, and highlights without touching transform", async () => {
    const grid = makeGrid([1, 2]);
    const first = grid.querySelector<HTMLElement>('[data-meme-id="1"]')!;
    first.style.transform = "rotateX(3deg)";
    const navigator = new ImmersiveRandomNavigator(grid, {
      random: () => 0,
      highlightDuration: 900,
    });

    expect(navigator.visit([{ id: 1 }, { id: 2 }])).toBe(1);
    expect(first.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    expect(first.classList.contains("is-immersive-random-target")).toBe(true);
    expect(first.style.transform).toBe("rotateX(3deg)");
    await vi.advanceTimersByTimeAsync(900);
    expect(first.classList.contains("is-immersive-random-target")).toBe(false);
  });

  it("avoids the previous target when multiple mounted candidates exist", () => {
    const grid = makeGrid([1, 2, 3]);
    const navigator = new ImmersiveRandomNavigator(grid, { random: () => 0 });
    expect(navigator.visit([{ id: 1 }, { id: 2 }, { id: 3 }])).toBe(1);
    expect(navigator.visit([{ id: 1 }, { id: 2 }, { id: 3 }])).toBe(2);
    expect(grid.querySelector('[data-meme-id="1"]')?.classList.contains("is-immersive-random-target")).toBe(false);
    expect(grid.querySelector('[data-meme-id="2"]')?.classList.contains("is-immersive-random-target")).toBe(true);
  });

  it("ignores loaded records without mounted cards", () => {
    const grid = makeGrid([2]);
    const navigator = new ImmersiveRandomNavigator(grid, { random: () => 0 });
    expect(navigator.visit([{ id: 1 }, { id: 2 }])).toBe(2);
    expect(navigator.visit([{ id: 9 }])).toBeNull();
  });
});
