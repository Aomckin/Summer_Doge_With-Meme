import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CascadeEntranceController } from "./cascade-entrance";

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly scrollMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  callback: IntersectionObserverCallback;
  static instances: MockIntersectionObserver[] = [];
  observedElements = new Set<Element>();

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    if (options?.rootMargin) this.rootMargin = options.rootMargin;
    MockIntersectionObserver.instances.push(this);
  }

  observe = vi.fn((el: Element) => {
    this.observedElements.add(el);
  });

  unobserve = vi.fn((el: Element) => {
    this.observedElements.delete(el);
  });

  disconnect = vi.fn(() => {
    this.observedElements.clear();
  });

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function makeIntersectionEntry(
  target: Element,
  isIntersecting = true,
  rect?: Partial<DOMRectReadOnly>,
): IntersectionObserverEntry {
  const defaultRect: DOMRectReadOnly = {
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  };
  return {
    target,
    isIntersecting,
    intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect: defaultRect,
    intersectionRect: defaultRect,
    rootBounds: null,
    time: performance.now(),
  };
}

describe("CascadeEntranceController", () => {
  let grid: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    MockIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-vault-mode");
    delete document.documentElement.dataset.cardMotion;
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
    MockIntersectionObserver.instances = [];
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete document.documentElement.dataset.cardMotion;
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
        case 0: return { top: 100, left: 200, bottom: 200, right: 300, width: 100, height: 100, x: 200, y: 100, toJSON: () => ({}) } as DOMRect;
        case 1: return { top: 10, left: 10, bottom: 90, right: 90, width: 80, height: 80, x: 10, y: 10, toJSON: () => ({}) } as DOMRect;
        case 2: return { top: 10, left: 200, bottom: 90, right: 280, width: 80, height: 80, x: 200, y: 10, toJSON: () => ({}) } as DOMRect;
        case 3: return { top: 100, left: 10, bottom: 200, right: 90, width: 80, height: 100, x: 10, y: 100, toJSON: () => ({}) } as DOMRect;
        default: return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      }
    });

    const controller = new CascadeEntranceController(grid);
    controller.trigger();

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

  it("animates all visible in-viewport cards across multiple rows without arbitrary 12-card cutoff, capping total initial delay at 300ms", () => {
    const cards = createCards(18, (i) => ({
      top: i * 20,
      left: 10,
      bottom: i * 20 + 30,
      right: 100,
      width: 90,
      height: 30,
      x: 10,
      y: i * 20,
      toJSON: () => ({}),
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    const activeCards = cards.filter((c) => c.getAttribute("data-stagger-in") === "active");
    // All 18 visible cards participate
    expect(activeCards.length).toBe(18);

    // Stagger delay on the 18th card is capped at maxTotalDelay (300ms)
    const lastDelayStr = cards[17].style.getPropertyValue("--card-stagger-delay");
    const lastDelay = parseInt(lastDelayStr, 10);
    expect(lastDelay).toBeLessThanOrEqual(300);

    controller.destroy();
  });

  it("observes off-screen cards with IntersectionObserver and staggers them upon scroll arrival", () => {
    const cards = createCards(4, (i) => {
      if (i < 2) {
        // In viewport
        return { top: i * 40 + 10, left: 10, bottom: i * 40 + 40, right: 90, width: 80, height: 30, x: 10, y: i * 40 + 10, toJSON: () => ({}) } as DOMRect;
      }
      // Off screen
      return { top: 1200 + (i - 2) * 50, left: 10, bottom: 1240 + (i - 2) * 50, right: 90, width: 80, height: 30, x: 10, y: 1200 + (i - 2) * 50, toJSON: () => ({}) } as DOMRect;
    });

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    // Cards 0 and 1 in viewport
    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");
    expect(cards[1].getAttribute("data-stagger-in")).toBe("active");

    // Cards 2 and 3 off-screen
    expect(cards[2].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[3].hasAttribute("data-stagger-in")).toBe(false);

    const observer = MockIntersectionObserver.instances[0];
    expect(observer).toBeDefined();
    expect(observer.observe).toHaveBeenCalledWith(cards[2]);
    expect(observer.observe).toHaveBeenCalledWith(cards[3]);

    // Simulate scroll arrival
    observer.callback(
      [makeIntersectionEntry(cards[2], true)],
      observer,
    );

    expect(cards[2].getAttribute("data-stagger-in")).toBe("active");
    expect(observer.unobserve).toHaveBeenCalledWith(cards[2]);

    controller.destroy();
  });

  it("prevents repeating entrance animation when scrolling back up (revealedCards guard)", () => {
    const cards = createCards(2, (i) => {
      if (i === 0) {
        return { top: 10, left: 10, bottom: 50, right: 90, width: 80, height: 40, x: 10, y: 10, toJSON: () => ({}) } as DOMRect;
      }
      return { top: 1200, left: 10, bottom: 1250, right: 90, width: 80, height: 50, x: 10, y: 1200, toJSON: () => ({}) } as DOMRect;
    });

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    const observer = MockIntersectionObserver.instances[0];

    // First arrival
    observer.callback(
      [makeIntersectionEntry(cards[1], true)],
      observer,
    );
    expect(cards[1].getAttribute("data-stagger-in")).toBe("active");

    // Finish animation
    const endEvent = new Event("animationend", { bubbles: true }) as AnimationEvent;
    Object.defineProperty(endEvent, "animationName", { value: "card-cascade-in" });
    cards[1].dispatchEvent(endEvent);
    expect(cards[1].hasAttribute("data-stagger-in")).toBe(false);

    // Re-intersecting should NOT re-trigger entrance
    observer.callback(
      [makeIntersectionEntry(cards[1], true)],
      observer,
    );
    expect(cards[1].hasAttribute("data-stagger-in")).toBe(false);

    // Also trigger() on the same DOM nodes should not re-trigger revealed card
    controller.trigger();
    vi.advanceTimersByTime(20);
    expect(cards[1].hasAttribute("data-stagger-in")).toBe(false);

    controller.destroy();
  });

  it("rejects stale queued observer callbacks from an earlier generation after cancel or retrigger", () => {
    const cards = createCards(2, () => ({
      top: 1200,
      left: 10,
      bottom: 1250,
      right: 90,
      width: 80,
      height: 50,
      x: 10,
      y: 1200,
      toJSON: () => ({}),
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    const staleObserver = MockIntersectionObserver.instances[0];

    // Cancel triggers generation++ and disconnects
    controller.cancel();

    // Now if the stale observer's callback fires from queue, it is ignored
    staleObserver.callback(
      [makeIntersectionEntry(cards[0], true)],
      staleObserver,
    );

    expect(cards[0].hasAttribute("data-stagger-in")).toBe(false);

    controller.destroy();
  });

  it("filters out disconnected or detached cards when intersection callback fires", () => {
    const cards = createCards(2, () => ({
      top: 1200,
      left: 10,
      bottom: 1250,
      right: 90,
      width: 80,
      height: 50,
      x: 10,
      y: 1200,
      toJSON: () => ({}),
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    const observer = MockIntersectionObserver.instances[0];

    // Detach card 0 from DOM
    cards[0].remove();

    observer.callback(
      [makeIntersectionEntry(cards[0], true)],
      observer,
    );

    // Detached card should not receive stagger-in
    expect(cards[0].hasAttribute("data-stagger-in")).toBe(false);
    expect(observer.unobserve).toHaveBeenCalledWith(cards[0]);

    controller.destroy();
  });

  it("cleans up active stagger immediately on focusin or pointerenter", () => {
    const cards = createCards(2, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");
    expect(cards[1].getAttribute("data-stagger-in")).toBe("active");

    // Focusin immediately clears active
    cards[0].dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(cards[0].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[0].style.getPropertyValue("--card-stagger-delay")).toBe("");

    // Pointerenter immediately clears active
    cards[1].dispatchEvent(new Event("pointerenter", { bubbles: true }));
    expect(cards[1].hasAttribute("data-stagger-in")).toBe(false);
    expect(cards[1].style.getPropertyValue("--card-stagger-delay")).toBe("");

    controller.destroy();
  });

  it("handles missing or throwing IntersectionObserver gracefully without error", () => {
    const cards = createCards(2, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect));

    const throwingObserverFn = vi.fn().mockImplementation(() => {
      throw new Error("Observer unavailable");
    });

    const controller = new CascadeEntranceController(grid, {
      createObserver: throwingObserverFn,
    });

    // Should not throw
    expect(() => controller.trigger()).not.toThrow();
    vi.advanceTimersByTime(20);

    // In-viewport cards still animate properly
    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");

    controller.destroy();
  });

  it("MutationObserver automatically discovers appended normal-list cards and observes them", async () => {
    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    // Append new off-screen card to the grid in the DOM
    const newCard = document.createElement("article");
    newCard.className = "meme-card";
    newCard.dataset.memeId = "99";
    newCard.getBoundingClientRect = vi.fn().mockReturnValue({
      top: 2000,
      bottom: 2100,
      left: 10,
      right: 90,
      width: 80,
      height: 100,
      x: 10,
      y: 2000,
      toJSON: () => ({}),
    } as DOMRect);

    grid.append(newCard);

    // Wait for real MutationObserver delivery
    await Promise.resolve();

    const observer = MockIntersectionObserver.instances[0];
    expect(observer).toBeDefined();
    expect(observer.observe).toHaveBeenCalledWith(newCard);

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
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    expect(cards[0].getAttribute("data-stagger-in")).toBe("active");

    // Advance past fallback timeout
    vi.advanceTimersByTime(700);

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
      x: 10,
      y: 10,
      toJSON: () => ({}),
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

  it("cleans up on matching card-cascade-in animationend", () => {
    const cards = createCards(2, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
      x: 10,
      y: 10,
      toJSON: () => ({}),
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

  it("skips cascade animation when document is hidden", () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });

    const cards = createCards(4, () => ({
      top: 10,
      left: 10,
      bottom: 50,
      right: 50,
      width: 40,
      height: 40,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(50);

    for (const card of cards) {
      expect(card.hasAttribute("data-stagger-in")).toBe(false);
    }

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
      x: 10,
      y: 10,
      toJSON: () => ({}),
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
      x: 10,
      y: 10,
      toJSON: () => ({}),
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
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(50);

    for (const card of cards) {
      expect(card.hasAttribute("data-stagger-in")).toBe(false);
    }

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
      x: 10,
      y: 10,
      toJSON: () => ({}),
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

  it("disconnects on document hide and re-arms on document show", () => {
    createCards(2, () => ({
      top: 2000,
      bottom: 2100,
      left: 10,
      right: 100,
      width: 90,
      height: 100,
      x: 10,
      y: 2000,
      toJSON: () => ({}),
    } as DOMRect));

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    const firstObserver = MockIntersectionObserver.instances[0];
    expect(firstObserver).toBeDefined();

    // Hide document
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(firstObserver.disconnect).toHaveBeenCalled();
    expect(document.documentElement.dataset.documentHidden).toBe("true");

    // Show document
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(20);

    expect(document.documentElement.dataset.documentHidden).toBeUndefined();
    const secondObserver = MockIntersectionObserver.instances[1];
    expect(secondObserver).toBeDefined();
    expect(secondObserver).not.toBe(firstObserver);

    controller.destroy();
  });

  it("cancels when reduced-motion becomes true and re-arms when it becomes false", () => {
    createCards(2, () => ({
      top: 2000,
      bottom: 2100,
      left: 10,
      right: 100,
      width: 90,
      height: 100,
      x: 10,
      y: 2000,
      toJSON: () => ({}),
    } as DOMRect));

    let isReduced = false;
    const holder: { listener?: (e: { matches: boolean }) => void } = {};
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return isReduced;
        },
        media: query,
        addEventListener: vi.fn((_event: string, cb: (e: { matches: boolean }) => void) => {
          holder.listener = cb;
        }),
        removeEventListener: vi.fn(),
      })),
    );

    const controller = new CascadeEntranceController(grid);
    controller.trigger();
    vi.advanceTimersByTime(20);

    const firstObserver = MockIntersectionObserver.instances[0];
    expect(firstObserver).toBeDefined();

    // Switch to reduced motion
    isReduced = true;
    holder.listener?.({ matches: true });

    expect(firstObserver.disconnect).toHaveBeenCalled();

    // Switch back to normal motion
    isReduced = false;
    holder.listener?.({ matches: false });
    vi.advanceTimersByTime(20);

    const secondObserver = MockIntersectionObserver.instances[1];
    expect(secondObserver).toBeDefined();
    expect(secondObserver).not.toBe(firstObserver);

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
      x: 10,
      y: 10,
      toJSON: () => ({}),
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
