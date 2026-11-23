import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpatialLightController } from "./spatial-light";

describe("SpatialLightController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.cardMotion;
    delete document.documentElement.dataset.vaultMode;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });

    // Default mock for matchMedia: fine pointer, no reduced motion
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
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.cardMotion;
    delete document.documentElement.dataset.vaultMode;
  });

  it("updates root CSS variables when pointer moves, throttled by requestAnimationFrame", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const controller = new SpatialLightController({ target });

    const pointerMove = new MouseEvent("pointermove", { clientX: 350, clientY: 220 }) as PointerEvent;
    target.dispatchEvent(pointerMove);

    // Before rAF fires, properties not yet updated
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("");

    // Advance rAF
    vi.advanceTimersByTime(20);

    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-x")).toBe("350px");
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-y")).toBe("220px");
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("1");

    controller.destroy();
    target.remove();
  });

  it("sets pointer-active to 0 when pointer leaves target or window blurs", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const controller = new SpatialLightController({ target });

    target.dispatchEvent(new MouseEvent("pointermove", { clientX: 100, clientY: 100 }) as PointerEvent);
    vi.advanceTimersByTime(20);
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("1");

    // Pointer leaves
    target.dispatchEvent(new Event("pointerleave"));
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("0");

    // Re-active on move
    target.dispatchEvent(new MouseEvent("pointermove", { clientX: 150, clientY: 150 }) as PointerEvent);
    vi.advanceTimersByTime(20);
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("1");

    // Window blurs
    window.dispatchEvent(new Event("blur"));
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("0");

    controller.destroy();
    target.remove();
  });

  it("deactivates when document visibility changes to hidden", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const controller = new SpatialLightController({ target });

    target.dispatchEvent(new MouseEvent("pointermove", { clientX: 200, clientY: 200 }) as PointerEvent);
    vi.advanceTimersByTime(20);
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("1");

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("0");

    controller.destroy();
    target.remove();
  });

  it("deactivates immediately when card motion changes to off or immersive mode is active", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const controller = new SpatialLightController({ target });

    target.dispatchEvent(new MouseEvent("pointermove", { clientX: 200, clientY: 200 }) as PointerEvent);
    vi.advanceTimersByTime(20);
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("1");

    // Switch card motion to off
    document.documentElement.dataset.cardMotion = "off";
    await Promise.resolve(); // MutationObserver microtask

    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("0");

    // Subsequent moves do not schedule updates
    target.dispatchEvent(new MouseEvent("pointermove", { clientX: 220, clientY: 220 }) as PointerEvent);
    vi.advanceTimersByTime(20);
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("0");

    controller.destroy();
    target.remove();
  });

  it("deactivates immediately when prefers-reduced-motion media query changes to true", () => {
    const holder: { listener?: (e: { matches: boolean }) => void } = {};
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn((_event: string, cb: (e: { matches: boolean }) => void) => {
        holder.listener = cb;
      }),
      removeEventListener: vi.fn(),
    })));

    const target = document.createElement("div");
    document.body.appendChild(target);

    const controller = new SpatialLightController({ target });

    target.dispatchEvent(new MouseEvent("pointermove", { clientX: 200, clientY: 200 }) as PointerEvent);
    vi.advanceTimersByTime(20);
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("1");

    // Trigger media query change to reduce
    holder.listener?.({ matches: true });

    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("0");

    controller.destroy();
    target.remove();
  });

  it("cancels pending rAF frame and removes CSS properties if destroy is called before frame executes", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const controller = new SpatialLightController({ target });

    target.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 300 }) as PointerEvent);

    // Destroy BEFORE advancing timers
    controller.destroy();

    vi.advanceTimersByTime(50);

    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-x")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-y")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("");

    target.remove();
  });

  it("removes all root CSS properties on destroy or external abort", () => {
    const abortController = new AbortController();
    const target = document.createElement("div");
    document.body.appendChild(target);

    const controller = new SpatialLightController({ target, signal: abortController.signal });

    target.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 300 }) as PointerEvent);
    vi.advanceTimersByTime(20);
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("1");

    abortController.abort();

    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-x")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-y")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--canvas-pointer-active")).toBe("");

    controller.destroy();
    target.remove();
  });
});
