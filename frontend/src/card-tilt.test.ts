import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CARD_MOTION_PRESETS,
  CARD_MOTION_PRESET_STORAGE_KEY,
  CARD_SIZE_MOTION,
  applyCardMotionPreset,
  bindCardTilt,
  bindMemeCardTilts,
  cardTiltProfile,
  saveCardMotionPreset,
  storedCardMotionPreset,
} from "./card-tilt";

function createCard(width = 1000, height = 1000, imageCount = 1): HTMLElement {
  const card = document.createElement("article");
  card.className = "meme-card";
  card.dataset.memeId = "meme-1";
  card.dataset.cardWidth = String(width);
  card.dataset.cardHeight = String(height);
  card.dataset.cardImageCount = String(imageCount);
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 200,
    bottom: 100,
    width: 200,
    height: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return card;
}

function flushFrames(frames: FrameRequestCallback[], maximum = 120): number {
  let count = 0;
  while (frames.length > 0 && count < maximum) {
    frames.shift()?.(count * 16);
    count += 1;
  }
  return count;
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("card motion presets", () => {
  it("defines independent values for all five product presets", () => {
    expect(CARD_MOTION_PRESETS).toMatchObject({
      off: { lift: 0, followX: 0, followY: 0, tiltX: 0, tiltY: 0, scale: 1 },
      subtle: { lift: 6, followX: 5, followY: 3, tiltX: 3, tiltY: 4, scale: 1.015, positionLerp: 0.22 },
      normal: { lift: 12, followX: 12, followY: 8, tiltX: 6, tiltY: 8, scale: 1.03, positionLerp: 0.18 },
      strong: { lift: 20, followX: 24, followY: 15, tiltX: 9, tiltY: 12, scale: 1.05, positionLerp: 0.15 },
      drunk: { lift: 30, followX: 40, followY: 25, tiltX: 14, tiltY: 18, scale: 1.075, positionLerp: 0.11 },
    });
  });

  it("defaults invalid storage to normal and persists a valid selection", () => {
    expect(storedCardMotionPreset()).toBe("normal");
    localStorage.setItem(CARD_MOTION_PRESET_STORAGE_KEY, "impossible");
    expect(storedCardMotionPreset()).toBe("normal");
    saveCardMotionPreset("drunk");
    expect(storedCardMotionPreset()).toBe("drunk");
  });
});

describe("card size motion multipliers", () => {
  it("defines the fixed translation and rotation multipliers", () => {
    expect(CARD_SIZE_MOTION).toEqual({
      small: { translation: 0.75, rotation: 0.85 },
      medium: { translation: 1, rotation: 1 },
      large: { translation: 1.5, rotation: 1.2 },
      "extra-large": { translation: 2, rotation: 1.35 },
    });
  });

  it("scales translation fully and rotation conservatively without changing scale", () => {
    const medium = cardTiltProfile(1000, 1000, "normal", "medium")!;
    const large = cardTiltProfile(1000, 1000, "normal", "large")!;
    const extraLarge = cardTiltProfile(1000, 1000, "normal", "extra-large")!;

    expect(large.liftPixels).toBe(medium.liftPixels * 1.5);
    expect(extraLarge.liftPixels).toBe(medium.liftPixels * 2);
    expect(extraLarge.maxFollowX).toBe(medium.maxFollowX * 2);
    expect(extraLarge.maxRotateX).toBeCloseTo(medium.maxRotateX * 1.35);
    expect(extraLarge.scale).toBe(medium.scale);
  });
});

describe("cardTiltProfile", () => {
  it("uses full tilt for common image ratios", () => {
    expect(cardTiltProfile(1000, 1000)?.tiltStrength).toBe(1);
    expect(cardTiltProfile(1600, 900)?.tiltStrength).toBe(1);
    expect(cardTiltProfile(900, 1600)?.tiltStrength).toBe(1);
    expect(cardTiltProfile(1000, 1000)).toMatchObject({
      liftPixels: 12,
      scale: 1.03,
      maxRotateX: 6,
      maxRotateY: 8,
      maxFollowX: 12,
      maxFollowY: 8,
    });
  });

  it("continuously reduces tilt while preserving lift for slender images", () => {
    const medium = cardTiltProfile(1000, 3000)!;
    const long = cardTiltProfile(1000, 10_000)!;
    const extreme = cardTiltProfile(1000, 20_000)!;

    expect(medium.tiltStrength).toBeLessThan(1);
    expect(long.tiltStrength).toBeLessThan(medium.tiltStrength);
    expect(extreme.tiltStrength).toBeLessThan(long.tiltStrength);
    expect(extreme.maxRotateY).toBeGreaterThan(1);
    expect(extreme.maxRotateY).toBeLessThan(2);
    expect(extreme.liftPixels).toBeGreaterThan(7);
    expect(extreme.scale).toBeGreaterThan(1.015);
    expect(extreme.maxFollowX).toBe(3);
    expect(extreme.maxFollowY).toBe(2);
  });

  it("rejects missing or invalid source dimensions", () => {
    expect(cardTiltProfile(0, 100)).toBeNull();
    expect(cardTiltProfile(Number.NaN, 100)).toBeNull();
  });

  it("keeps aspect-ratio protection across presets and makes off completely static", () => {
    const normalDrunk = cardTiltProfile(1000, 1000, "drunk")!;
    const longDrunk = cardTiltProfile(1000, 20_000, "drunk")!;
    const off = cardTiltProfile(1000, 1000, "off")!;

    expect(longDrunk.liftPixels).toBeGreaterThan(18);
    expect(longDrunk.maxRotateY).toBeLessThan(normalDrunk.maxRotateY);
    expect(longDrunk.maxFollowX).toBe(10);
    expect(off).toMatchObject({
      liftPixels: 0,
      scale: 1,
      maxRotateX: 0,
      maxRotateY: 0,
      maxFollowX: 0,
      maxFollowY: 0,
    });
  });
});

describe("bindCardTilt", () => {
  it("lifts, follows with inertia, and returns to rest in two stages", () => {
    vi.useFakeTimers();
    const card = createCard();
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return requestFrame.mock.calls.length;
    });
    const cancelFrame = vi.fn();
    bindCardTilt(card, {
      finePointer: true,
      reducedMotion: false,
      requestFrame,
      cancelFrame,
    });

    card.dispatchEvent(new Event("pointerenter"));
    expect(card.classList.contains("is-card-lifted")).toBe(true);

    card.dispatchEvent(new MouseEvent("pointermove", { clientX: 200, clientY: 0 }));
    expect(frames).toHaveLength(1);
    frames.shift()?.(0);
    expect(card.style.getPropertyValue("--card-tilt-x")).toBe("1.320deg");
    expect(card.style.getPropertyValue("--card-tilt-y")).toBe("1.760deg");
    expect(card.style.getPropertyValue("--card-follow-x")).toBe("2.160px");
    expect(card.style.getPropertyValue("--card-follow-y")).toBe("-1.440px");

    expect(flushFrames(frames)).toBeGreaterThan(1);
    expect(card.style.getPropertyValue("--card-tilt-x")).toBe("6.000deg");
    expect(card.style.getPropertyValue("--card-tilt-y")).toBe("8.000deg");
    expect(card.style.getPropertyValue("--card-follow-x")).toBe("12.000px");
    expect(card.style.getPropertyValue("--card-follow-y")).toBe("-8.000px");
    expect(frames).toHaveLength(0);

    card.dispatchEvent(new Event("pointerleave"));
    expect(card.style.getPropertyValue("--card-follow-x")).toBe("12.000px");
    expect(flushFrames(frames)).toBeGreaterThan(1);
    expect(card.style.getPropertyValue("--card-tilt-x")).toBe("0.000deg");
    expect(card.style.getPropertyValue("--card-follow-x")).toBe("0.000px");
    expect(frames).toHaveLength(0);
    expect(card.classList.contains("is-card-lifted")).toBe(true);
    vi.advanceTimersByTime(180);
    expect(card.classList.contains("is-card-lifted")).toBe(false);
    expect(card.classList.contains("is-card-returning")).toBe(true);
    vi.advanceTimersByTime(300);
    expect(card.classList.contains("is-card-returning")).toBe(false);
    expect(cancelFrame).not.toHaveBeenCalled();
  });

  it("does not bind tilt on coarse pointers, reduced motion, or missing dimensions", () => {
    const coarse = createCard();
    bindCardTilt(coarse, { finePointer: false, reducedMotion: false });
    expect(coarse.dataset.cardTilt).toBeUndefined();

    const reduced = createCard();
    bindCardTilt(reduced, { finePointer: true, reducedMotion: true, preset: "drunk" });
    expect(reduced.dataset.cardTilt).toBeUndefined();

    const missingSize = createCard(0, 0);
    bindCardTilt(missingSize, { finePointer: true, reducedMotion: false });
    expect(missingSize.dataset.cardTilt).toBeUndefined();

  });

  it("binds the full card motion system to multi-image Meme covers", () => {
    const multiImage = createCard(1000, 1000, 3);
    bindCardTilt(multiImage, { finePointer: true, reducedMotion: false });
    expect(multiImage.dataset.cardTilt).toBe("ready");
    multiImage.dispatchEvent(new Event("pointerenter"));
    expect(multiImage.classList.contains("is-card-lifted")).toBe(true);
  });

  it("cancels a pending return when the pointer quickly re-enters", () => {
    vi.useFakeTimers();
    const card = createCard();
    const frames: FrameRequestCallback[] = [];
    bindCardTilt(card, {
      finePointer: true,
      reducedMotion: false,
      requestFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: () => undefined,
    });

    card.dispatchEvent(new Event("pointerenter"));
    card.dispatchEvent(new MouseEvent("pointermove", { clientX: 200, clientY: 0 }));
    frames.shift()?.(0);
    card.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(50);
    card.dispatchEvent(new Event("pointerenter"));
    card.dispatchEvent(new MouseEvent("pointermove", { clientX: 0, clientY: 100 }));
    flushFrames(frames);
    vi.advanceTimersByTime(500);

    expect(card.classList.contains("is-card-lifted")).toBe(true);
    expect(card.classList.contains("is-card-returning")).toBe(false);
    expect(card.style.getPropertyValue("--card-follow-x")).toBe("-12.000px");
    expect(card.style.getPropertyValue("--card-follow-y")).toBe("8.000px");
  });

  it("coalesces pointer moves and reads layout only on entry", () => {
    const card = createCard();
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    bindCardTilt(card, {
      finePointer: true,
      reducedMotion: false,
      requestFrame,
      cancelFrame: () => undefined,
    });

    card.dispatchEvent(new Event("pointerenter"));
    card.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 20 }));
    card.dispatchEvent(new MouseEvent("pointermove", { clientX: 180, clientY: 80 }));

    expect(requestFrame).toHaveBeenCalledOnce();
    expect(card.getBoundingClientRect).toHaveBeenCalledOnce();
    frames.shift()?.(0);
    expect(card.style.getPropertyValue("--card-tilt-y")).toBe("1.408deg");
    expect(card.style.getPropertyValue("--card-follow-x")).toBe("1.728px");
    flushFrames(frames);
    expect(card.style.getPropertyValue("--card-tilt-y")).toBe("6.400deg");
    expect(card.style.getPropertyValue("--card-follow-x")).toBe("9.600px");
    expect(frames).toHaveLength(0);
  });

  it("keeps normal card clicks working", () => {
    const card = createCard();
    const onClick = vi.fn();
    card.addEventListener("click", onClick);
    bindCardTilt(card, {
      finePointer: true,
      reducedMotion: false,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
    });

    card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("bindMemeCardTilts", () => {
  it("binds eligible single- and multi-image cards in the supplied container", () => {
    const container = document.createElement("section");
    container.append(createCard(), createCard(1000, 1000, 2), document.createElement("article"));

    bindMemeCardTilts(container, {
      finePointer: true,
      reducedMotion: false,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
    });

    expect(container.querySelectorAll('[data-card-tilt="ready"]')).toHaveLength(2);
  });

  it("rebinds eligible cards immediately and fully disables the off preset", () => {
    const container = document.createElement("section");
    const card = createCard();
    container.append(card);
    const environment = {
      finePointer: true,
      reducedMotion: false,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
    };

    bindMemeCardTilts(container, { ...environment, preset: "normal" });
    expect(card.style.getPropertyValue("--card-lift-y")).toBe("-12px");
    applyCardMotionPreset(container, "strong", environment);
    expect(container.dataset.cardMotion).toBe("strong");
    expect(card.style.getPropertyValue("--card-lift-y")).toBe("-20px");
    applyCardMotionPreset(container, "off", environment);
    expect(container.dataset.cardMotion).toBe("off");
    expect(card.dataset.cardTilt).toBeUndefined();
  });

  it("rebinds with the current card-size multiplier", () => {
    const container = document.createElement("section");
    container.className = "meme-grid";
    container.dataset.cardSize = "medium";
    const card = createCard();
    container.append(card);
    const environment = {
      finePointer: true,
      reducedMotion: false,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
    };

    bindMemeCardTilts(container, { ...environment, preset: "normal" });
    expect(card.style.getPropertyValue("--card-lift-y")).toBe("-12px");
    container.dataset.cardSize = "extra-large";
    applyCardMotionPreset(container, "normal", environment);
    expect(card.style.getPropertyValue("--card-lift-y")).toBe("-24px");
  });
});
