import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CascadeEntranceController } from "./cascade-entrance";

describe("CascadeEntranceController", () => {
  let grid: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-vault-mode");
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    grid = document.createElement("div");
    grid.className = "meme-grid";
    document.body.appendChild(grid);

    // Default mock for matchMedia
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function createCards(count: number, geometry: (index: number) => DOMRect): HTMLElement[] {
    const cards: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const card = document.createElement("article");
      card.className = "meme-card";
      card.dataset.memeId = String(i + 1);
      const rect = geometry(i);
      card.getBoundingClientRect = vi.fn().mockReturnValue(rect);
      grid.appendChild(card);
      cards.push(card);
    }
    return cards;
  }

  it("sorts visible cards strictly by top then left and applies staggered delays capped at 300ms", () => {
    // Create 4 cards in a 2x2 masonry pattern:
    // Card 0: top 100, left 200 (bottom right)
    // Card 1: top 10, left 10   (top left)
    // Card 2: top 10, left 200  (top right)
    // Card 3: top 100, left 10  (bottom left)
    const cards = createCards(4, (i) => {
      switch (i) {
        case 0: return { top: 100, left: 200, bottom: 200, right: 300, width: 100, height: 100 } as DOMRect;
        case 1: return { top: 10, left: 10, bottom: 90, right: 90, width: 80, height: 80 } as DOMRect;
        case 2: return { top: 10, left: 200, bottom: 90, right: 280, width: 80, height: 80 } as DOMRect;
        case 3: return { top: 100, left: 10, bottom: 200, right: 90, width: 80, height: 100 } as DOMRect;
        default: return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 } as DOMRect;
      }
    });

    const controller = new CascadeEntranceController(grid);
    controller.trigger();

    // Advance rAF (typically 16ms) without advancing past the 640ms fallback
    vi.advanceTimersByTime(20);

    // Expected visual order:
    // 1st: Card 1 (top 10, left 10)
    // 2nd: Card 2 (top 10, left 200)
    // 3rd: Card 3 (top 100, left 10)
    // 4th: Card 0 (top 100, left 200)
    expect(cards[1].getAttribute("data-stagger-in")).toBe("active");
    expect(cards[1].style.getPropertyValue("--card-stagger-delay")).toBe("0ms");

    expect(cards[2].getAttribute("data-stagger-in")).toBe("active");
    expect(cards[2].style.getPropertyValue("--card-stagger-delay")).toBe("25ms");

    expect(cards[3].getAttribute("data-stagger-in")).toBe("active");
    expect(cards[3].style.getPropertyValue("--card-stagger-delay")).toBe("50ms");

    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");
    expect(cards[0].style.getPropertyValue("--card-stagger-delay")).toBe("75ms");

    controller.destroy();
  });

  it("limits staggered batch to at most 12 cards", () => {
    const cards = createCards(20, (i) => ({
      top: i * 20,
      left: 10,
      bottom: i * 20 + 30,
      right: 100,
      width: 90,
      height: 30,
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    const activeCards = cards.filter(c => c.getAttribute("data-stagger-in") === "active");
    expect(activeCards.length).toBe(12);

    // Cards past the 12th card are not delayed and stay default visible
    expect(cards[12].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[19].hasAttribute("data-stagger-in")).toBe(false);

    controller.destroy();
  });

  it("cleans up active cards via the 640ms fallback timeout if no animation events fire", () => {
    const cards = createCards(3, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");

    // Advance past 640ms fallback timeout
    vi.advanceTimersByTime(650);

    expect(cards[0].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[1].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[2].hasAttribute("data-stagger-in")).toBe(false);

    controller.destroy();
  });

  it("cleans up card when animationcancel fires", () => {
    const cards = createCards(2, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");

    // Dispatch animationcancel
    const cancelEvent = new Event("animationcancel", { bubbles: true }) as AnimationEvent;
    Object.defineProperty(cancelEvent, "animationName", { value: "card-cascade-in" });
    cards[0].dispatchEvent(cancelEvent);

    expect(cards[0].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[0].style.getPropertyValue("--card-stagger-delay")).toBe("");

    controller.destroy();
  });

  it("clears fallback timeout early when all active cards finish animationend", () => {
    const cards = createCards(1, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");

    const endEvent = new Event("animationend", { bubbles: true }) as AnimationEvent;
    Object.defineProperty(endEvent, "animationName", { value: "card-cascade-in" });
    cards[0].dispatchEvent(endEvent);

    expect(cards[0].hasAttribute("data-stagger-in")).toBe(false);

    // Advancing past 640ms should not cause issues because timeout was cleared
    vi.advanceTimersByTime(1000);
    controller.destroy();
  });

  it("skips cascade animation when document is hidden", () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });

    const cards = createCards(4, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(50);

    for (const card of cards) {
      expect(card.hasAttribute("data-stagger-in")).toBe(false);
    }

    controller.destroy();
  });

  it("filters out zero-sized and off-screen cards", () => {
    // Card 0: zero width/height
    // Card 1: off-screen above (bottom <= 0)
    // Card 2: normal visible
    const cards = createCards(3, (i) => {
      switch (i) {
        case 0: return { top: 10, left: 10, bottom: 10, right: 10, width: 0, height: 0 } as DOMRect;
        case 1: return { top: -100, left: 10, bottom: -10, right: 50, width: 40, height: 90 } as DOMRect;
        case 2: return { top: 10, left: 10, bottom: 50, right: 50, width: 40, height: 40 } as DOMRect;
        default: return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 } as DOMRect;
      }
    });

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    expect(cards[0].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[1].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[2].getAttribute("data-stagger-in")).toBe("active");

    controller.destroy();
  });

  it("immediately downgrades to static when prefers-reduced-motion is active", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
    })));

    const cards = createCards(4, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(50);

    for (const card of cards) {
      expect(card.hasAttribute("data-stagger-in")).toBe(false);
    }

    controller.destroy();
  });

  it("immediately downgrades to static when card motion is off", () => {
    grid.dataset.cardMotion = "off";

    const cards = createCards(4, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(50);

    for (const card of cards) {
      expect(card.hasAttribute("data-stagger-in")).toBe(false);
    }

    controller.destroy();
  });

  it("immediately downgrades to static in immersive mode", () => {
    document.documentElement.dataset.vaultMode = "immersive";

    const cards = createCards(4, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(50);

    for (const card of cards) {
      expect(card.hasAttribute("data-stagger-in")).toBe(false);
    }

    controller.destroy();
  });

  it("cleans up on animationend with matching target and animationName", () => {
    const cards = createCards(2, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");

    // Different animation name should be ignored
    const unrelatedEvent = new Event("animationend", { bubbles: true }) as AnimationEvent;
    Object.defineProperty(unrelatedEvent, "animationName", { value: "other-animation" });
    cards[0].dispatchEvent(unrelatedEvent);
    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");

    // Matching card-cascade-in animationend should clean up
    const matchingEvent = new Event("animationend", { bubbles: true }) as AnimationEvent;
    Object.defineProperty(matchingEvent, "animationName", { value: "card-cascade-in" });
    cards[0].dispatchEvent(matchingEvent);

    expect(cards[0].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[0].style.getPropertyValue("--card-stagger-delay")).toBe("");

    controller.destroy();
  });

  it("cancel() immediately clears all stagger attributes and cancels rAF", () => {
    const cards = createCards(3, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");

    controller.cancel();

    expect(cards[0].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[1].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[2].hasAttribute("data-stagger-in")).toBe(false);

    controller.destroy();
  });

  it("cleans up immediately when AbortSignal fires", () => {
    const cards = createCards(2, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
    } as DOMRect));

    const abortController = new AbortController();
    const controller = new CascadeEntranceController(grid, { signal: abortController.signal });
    controller.trigger();
    vi.advanceTimersByTime(20);

    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");

    abortController.abort();
    expect(cards[0].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[1].hasAttribute("data-stagger-in")).toBe(false);
  });
});
