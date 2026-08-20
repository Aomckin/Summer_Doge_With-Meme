import { afterEach, describe, expect, it, vi } from "vitest";

import { DrunkPhysicsController } from "./drunk-physics";

class FakeIntersectionObserver {
  readonly observed: Element[] = [];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.observed.push(target);
  }

  disconnect(): void {
    this.observed.length = 0;
  }

  emit(cards: HTMLElement[]): void {
    this.callback(cards.map(card => ({
      target: card,
      isIntersecting: true,
    } as unknown as IntersectionObserverEntry)), this as unknown as IntersectionObserver);
  }

  hide(cards: HTMLElement[]): void {
    this.callback(cards.map(card => ({
      target: card,
      isIntersecting: false,
    } as unknown as IntersectionObserverEntry)), this as unknown as IntersectionObserver);
  }
}

function createCard(left: number): HTMLElement {
  const card = document.createElement("article");
  card.className = "meme-card";
  card.dataset.memeId = String(left + 1);
  card.dataset.cardTilt = "ready";
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
    left,
    top: 0,
    right: left + 100,
    bottom: 100,
    width: 100,
    height: 100,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
  return card;
}

function numberVariable(card: HTMLElement, name: string): number {
  return Number.parseFloat(card.style.getPropertyValue(name));
}

function setup(random: () => number = () => 0.5) {
  const container = document.createElement("section");
  const frames: FrameRequestCallback[] = [];
  let observer: FakeIntersectionObserver | null = null;
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    frames.push(callback);
    return requestFrame.mock.calls.length;
  });
  const cancelFrame = vi.fn(() => {
    frames.length = 0;
  });
  const controller = new DrunkPhysicsController(container, {
    finePointer: true,
    reducedMotion: false,
    requestFrame,
    cancelFrame,
    random,
    createObserver: callback => {
      observer = new FakeIntersectionObserver(callback);
      return observer;
    },
  });
  return {
    container,
    frames,
    requestFrame,
    cancelFrame,
    controller,
    observer: () => observer!,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("DrunkPhysicsController", () => {
  it("uses one frame loop and attracts only viewport-near cards toward the pointer", () => {
    const harness = setup();
    const near = createCard(0);
    const far = createCard(900);
    harness.container.append(near, far);

    expect(harness.controller.start()).toBe(true);
    expect(harness.frames).toHaveLength(0);
    harness.observer().emit([near, far]);
    expect(harness.frames).toHaveLength(1);

    harness.container.dispatchEvent(new MouseEvent("pointermove", {
      clientX: 200,
      clientY: 50,
      bubbles: true,
    }));
    harness.container.dispatchEvent(new MouseEvent("pointermove", {
      clientX: 210,
      clientY: 50,
      bubbles: true,
    }));
    expect(harness.frames).toHaveLength(1);
    harness.frames.shift()?.(0);

    expect(numberVariable(near, "--card-drunk-x")).toBeGreaterThan(0);
    expect(numberVariable(near, "--card-drunk-lift")).toBeLessThan(0);
    expect(numberVariable(near, "--card-drunk-tilt-y")).toBeGreaterThan(0);
    expect(Math.abs(numberVariable(far, "--card-drunk-x"))).toBeLessThan(0.001);
    expect(harness.frames).toHaveLength(1);
  });

  it("gives cards independent drift and reduces ambient motion on the hovered card", () => {
    const randomValues = [
      0.1, 0.2, 0.3, 0.4, 0.5,
      0.7, 0.8, 0.9, 0.6, 0.4,
    ];
    const harness = setup(() => randomValues.shift() ?? 0.5);
    const normal = createCard(0);
    const hovered = createCard(0);
    hovered.classList.add("is-card-lifted");
    harness.container.append(normal, hovered);
    harness.controller.start();
    harness.observer().emit([normal, hovered]);
    harness.container.dispatchEvent(new MouseEvent("pointermove", {
      clientX: 200,
      clientY: 50,
      bubbles: true,
    }));
    harness.frames.shift()?.(1000);

    expect(normal.style.getPropertyValue("--card-drunk-y"))
      .not.toBe(hovered.style.getPropertyValue("--card-drunk-y"));
    expect(Math.abs(numberVariable(hovered, "--card-drunk-x")))
      .toBeLessThan(Math.abs(numberVariable(normal, "--card-drunk-x")));
  });

  it("smoothly releases attraction and stops frames when no observed cards remain", () => {
    const harness = setup();
    const card = createCard(0);
    harness.container.append(card);
    harness.controller.start();
    harness.observer().emit([card]);
    harness.container.dispatchEvent(new MouseEvent("pointermove", {
      clientX: 200,
      clientY: 50,
      bubbles: true,
    }));
    for (let index = 0; index < 12; index += 1) {
      harness.frames.shift()?.(0);
    }
    const attractedX = numberVariable(card, "--card-drunk-x");

    harness.container.dispatchEvent(new Event("pointerleave"));
    harness.frames.shift()?.(0);
    const releasedX = numberVariable(card, "--card-drunk-x");
    expect(releasedX).toBeGreaterThan(0);
    expect(releasedX).toBeLessThan(attractedX);

    harness.observer().hide([card]);
    expect(harness.frames).toHaveLength(0);
    expect(card.dataset.drunkPhysics).toBeUndefined();
  });

  it("does not start for coarse pointers or reduced-motion users", () => {
    const createObserver = vi.fn();
    const container = document.createElement("section");
    const coarse = new DrunkPhysicsController(container, {
      finePointer: false,
      reducedMotion: false,
      createObserver,
    });
    const reduced = new DrunkPhysicsController(container, {
      finePointer: true,
      reducedMotion: true,
      createObserver,
    });

    expect(coarse.start()).toBe(false);
    expect(reduced.start()).toBe(false);
    expect(createObserver).not.toHaveBeenCalled();
  });

  it("applies card-size translation and rotation multipliers to the gravity field", () => {
    const sample = (size: "medium" | "extra-large") => {
      const harness = setup();
      harness.container.dataset.cardSize = size;
      const card = createCard(0);
      harness.container.append(card);
      harness.controller.start();
      harness.observer().emit([card]);
      harness.container.dispatchEvent(new MouseEvent("pointermove", {
        clientX: 200,
        clientY: 50,
        bubbles: true,
      }));
      harness.frames.shift()?.(0);
      return {
        x: numberVariable(card, "--card-drunk-x"),
        lift: numberVariable(card, "--card-drunk-lift"),
        tiltY: numberVariable(card, "--card-drunk-tilt-y"),
      };
    };

    const medium = sample("medium");
    const extraLarge = sample("extra-large");
    expect(extraLarge.x).toBeCloseTo(medium.x * 2, 2);
    expect(extraLarge.lift).toBeCloseTo(medium.lift * 2, 2);
    expect(extraLarge.tiltY).toBeCloseTo(medium.tiltY * 1.35, 2);
  });
});
