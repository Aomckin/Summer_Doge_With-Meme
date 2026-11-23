import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterScrollFadeController } from "./filter-scroll-fade";

describe("FilterScrollFadeController", () => {
  let root: HTMLElement;
  let toolbar: HTMLElement;
  let filterContainer: HTMLElement;
  let scrollContainer: HTMLElement;
  let observeSpy = vi.fn();
  let unobserveSpy = vi.fn();
  let disconnectSpy = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = "";
    observeSpy = vi.fn();
    unobserveSpy = vi.fn();
    disconnectSpy = vi.fn();

    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observeSpy;
        unobserve = unobserveSpy;
        disconnect = disconnectSpy;
      },
    );

    root = document.createElement("div");
    toolbar = document.createElement("div");
    toolbar.className = "library-filter-toolbar";

    filterContainer = document.createElement("div");
    filterContainer.className = "tag-filters";

    scrollContainer = document.createElement("div");
    scrollContainer.className = "filter-chip-scroll";

    for (let i = 0; i < 10; i++) {
      const chip = document.createElement("button");
      chip.className = "filter-chip";
      chip.textContent = `Tag ${i}`;
      scrollContainer.appendChild(chip);
    }

    filterContainer.appendChild(scrollContainer);
    toolbar.appendChild(filterContainer);
    root.appendChild(toolbar);
    document.body.appendChild(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("applies overflow-right when content overflows horizontally with exact attribute value", () => {
    Object.defineProperty(scrollContainer, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(scrollContainer, "scrollWidth", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollLeft", { configurable: true, value: 0 });

    const controller = new FilterScrollFadeController(root);
    controller.updateAll();

    expect(scrollContainer.getAttribute("data-v21-scroll-fade")).toBe("true");
    expect(scrollContainer.getAttribute("data-overflow-right")).toBe("true");
    expect(scrollContainer.hasAttribute("data-overflow-left")).toBe(false);

    controller.destroy();
  });

  it("applies both left and right overflow values when scrolled into the middle", () => {
    Object.defineProperty(scrollContainer, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(scrollContainer, "scrollWidth", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollLeft", { configurable: true, value: 100 });

    const controller = new FilterScrollFadeController(root);
    controller.updateAll();

    expect(scrollContainer.getAttribute("data-v21-scroll-fade")).toBe("true");
    expect(scrollContainer.getAttribute("data-overflow-left")).toBe("true");
    expect(scrollContainer.getAttribute("data-overflow-right")).toBe("true");

    controller.destroy();
  });

  it("applies only left overflow when scrolled to the end", () => {
    Object.defineProperty(scrollContainer, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(scrollContainer, "scrollWidth", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollLeft", { configurable: true, value: 300 });

    const controller = new FilterScrollFadeController(root);
    controller.updateAll();

    expect(scrollContainer.getAttribute("data-v21-scroll-fade")).toBe("true");
    expect(scrollContainer.getAttribute("data-overflow-left")).toBe("true");
    expect(scrollContainer.hasAttribute("data-overflow-right")).toBe(false);

    controller.destroy();
  });

  it("removes fade attributes when content does not overflow", () => {
    Object.defineProperty(scrollContainer, "clientWidth", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollWidth", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollLeft", { configurable: true, value: 0 });

    const controller = new FilterScrollFadeController(root);
    controller.updateAll();

    expect(scrollContainer.hasAttribute("data-v21-scroll-fade")).toBe(false);
    expect(scrollContainer.hasAttribute("data-overflow-left")).toBe(false);
    expect(scrollContainer.hasAttribute("data-overflow-right")).toBe(false);

    controller.destroy();
  });

  it("respects subpixel tolerance threshold of 1.5px", () => {
    Object.defineProperty(scrollContainer, "clientWidth", { configurable: true, value: 499 });
    Object.defineProperty(scrollContainer, "scrollWidth", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollLeft", { configurable: true, value: 0 });

    const controller = new FilterScrollFadeController(root);
    controller.updateAll();

    // 500 - 499 = 1px <= 1.5px tolerance -> treated as no overflow
    expect(scrollContainer.hasAttribute("data-v21-scroll-fade")).toBe(false);

    controller.destroy();
  });

  it("disables fade attributes when parent has data-expanded", () => {
    Object.defineProperty(scrollContainer, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(scrollContainer, "scrollWidth", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollLeft", { configurable: true, value: 50 });

    filterContainer.setAttribute("data-expanded", "true");

    const controller = new FilterScrollFadeController(root);
    controller.updateAll();

    expect(scrollContainer.hasAttribute("data-v21-scroll-fade")).toBe(false);
    expect(scrollContainer.hasAttribute("data-overflow-left")).toBe(false);
    expect(scrollContainer.hasAttribute("data-overflow-right")).toBe(false);

    // Collapsing should restore fade on next update
    filterContainer.removeAttribute("data-expanded");
    controller.updateAll();

    expect(scrollContainer.getAttribute("data-v21-scroll-fade")).toBe("true");

    controller.destroy();
  });

  it("prunes detached old containers and tracks new containers upon refresh", () => {
    vi.useFakeTimers();

    Object.defineProperty(scrollContainer, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(scrollContainer, "scrollWidth", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollLeft", { configurable: true, value: 0 });

    const controller = new FilterScrollFadeController(root);
    controller.updateAll();
    expect(scrollContainer.getAttribute("data-v21-scroll-fade")).toBe("true");

    // Initially observed scrollContainer and its parent filterContainer
    expect(observeSpy).toHaveBeenCalledWith(scrollContainer);
    expect(observeSpy).toHaveBeenCalledWith(filterContainer);

    // Replace the DOM subtree simulating a re-render
    toolbar.innerHTML = "";
    const newFilterContainer = document.createElement("div");
    newFilterContainer.className = "tag-filters";
    const newScrollContainer = document.createElement("div");
    newScrollContainer.className = "filter-chip-scroll";
    Object.defineProperty(newScrollContainer, "clientWidth", { configurable: true, value: 150 });
    Object.defineProperty(newScrollContainer, "scrollWidth", { configurable: true, value: 400 });
    Object.defineProperty(newScrollContainer, "scrollLeft", { configurable: true, value: 50 });
    newFilterContainer.appendChild(newScrollContainer);
    toolbar.appendChild(newFilterContainer);

    // Refresh should clean up old detached elements and track new ones
    controller.refresh();

    // Verify unobserve called on old detached nodes
    expect(unobserveSpy).toHaveBeenCalledWith(scrollContainer);
    expect(unobserveSpy).toHaveBeenCalledWith(filterContainer);

    // Verify observe called on newly mounted nodes
    expect(observeSpy).toHaveBeenCalledWith(newScrollContainer);
    expect(observeSpy).toHaveBeenCalledWith(newFilterContainer);

    // Advance fake timers by 20ms to allow scheduled rAF in refresh() to complete updateAll()
    vi.advanceTimersByTime(20);

    expect(newScrollContainer.getAttribute("data-v21-scroll-fade")).toBe("true");
    expect(newScrollContainer.getAttribute("data-overflow-left")).toBe("true");
    expect(newScrollContainer.getAttribute("data-overflow-right")).toBe("true");

    controller.destroy();
    expect(newScrollContainer.hasAttribute("data-v21-scroll-fade")).toBe(false);
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it("aborts and cleans up when AbortSignal triggers", () => {
    Object.defineProperty(scrollContainer, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(scrollContainer, "scrollWidth", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollLeft", { configurable: true, value: 50 });

    const abortController = new AbortController();
    const controller = new FilterScrollFadeController(root, { signal: abortController.signal });
    controller.updateAll();
    expect(scrollContainer.getAttribute("data-v21-scroll-fade")).toBe("true");

    abortController.abort();
    expect(scrollContainer.hasAttribute("data-v21-scroll-fade")).toBe(false);
    expect(scrollContainer.hasAttribute("data-overflow-left")).toBe(false);
    expect(scrollContainer.hasAttribute("data-overflow-right")).toBe(false);
  });

  it("cleans up attributes and observer on destroy", () => {
    Object.defineProperty(scrollContainer, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(scrollContainer, "scrollWidth", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollLeft", { configurable: true, value: 50 });

    const controller = new FilterScrollFadeController(root);
    controller.updateAll();
    expect(scrollContainer.getAttribute("data-v21-scroll-fade")).toBe("true");

    controller.destroy();
    expect(scrollContainer.hasAttribute("data-v21-scroll-fade")).toBe(false);
    expect(scrollContainer.hasAttribute("data-overflow-left")).toBe(false);
    expect(scrollContainer.hasAttribute("data-overflow-right")).toBe(false);
    expect(disconnectSpy).toHaveBeenCalled();
  });
});
