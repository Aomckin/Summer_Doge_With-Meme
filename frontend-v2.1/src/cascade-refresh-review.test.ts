import { afterEach, describe, expect, it, vi } from "vitest";
import { CascadeEntranceController } from "./cascade-entrance";

// Review regression: the real app constructs controllers on an empty grid,
// renders the response, then calls trigger(), before MutationObserver delivery.
describe("refresh cascade integration ordering", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.documentElement.removeAttribute("data-vault-mode");
  });

  it("retains staggered delays across all visible rows when render mutations precede the first frame", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn() })));
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const grid = document.createElement("div");
    document.body.append(grid);
    const controller = new CascadeEntranceController(grid);
    try {
      const cards = Array.from({ length: 18 }, (_, index) => {
        const card = document.createElement("article");
        card.className = "meme-card";
        card.dataset.memeId = String(index + 1);
        const top = 30 + Math.floor(index / 6) * 150;
        const left = 10 + (index % 6) * 100;
        card.getBoundingClientRect = () => ({ top, left, bottom: top + 120, right: left + 90, width: 90, height: 120, x: left, y: top, toJSON() {} });
        grid.append(card);
        return card;
      });
      controller.trigger();
      await Promise.resolve();
      vi.advanceTimersByTime(20);
      expect(cards.every(card => card.dataset.staggerIn === "active")).toBe(true);
      const delays = cards.map(card => parseFloat(card.style.getPropertyValue("--card-stagger-delay")));
      expect(delays[0]).toBe(0);
      expect(delays[6]).toBeGreaterThan(delays[0]);
      expect(delays[12]).toBeGreaterThan(delays[6]);
      expect(delays[17]).toBeLessThanOrEqual(300);
    } finally {
      controller.destroy();
    }
  });
});
