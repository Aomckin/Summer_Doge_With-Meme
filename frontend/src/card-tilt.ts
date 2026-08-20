import type { MemeCardSize } from "./types";
import { DrunkPhysicsController } from "./drunk-physics";
import { CARD_SIZE_MOTION } from "./card-motion-config";

export { CARD_SIZE_MOTION } from "./card-motion-config";

export interface CardTiltProfile {
  slenderness: number;
  tiltStrength: number;
  liftPixels: number;
  scale: number;
  maxRotateX: number;
  maxRotateY: number;
  maxFollowX: number;
  maxFollowY: number;
}

export type CardMotionPresetName = "off" | "subtle" | "normal" | "strong" | "drunk";

export interface CardMotionPreset {
  lift: number;
  followX: number;
  followY: number;
  tiltX: number;
  tiltY: number;
  scale: number;
  positionLerp: number;
  rotationLerp: number;
}

export const CARD_MOTION_PRESET_STORAGE_KEY = "meme-vault.card-motion-preset";

export const CARD_MOTION_PRESETS: Readonly<Record<CardMotionPresetName, CardMotionPreset>> = {
  off: { lift: 0, followX: 0, followY: 0, tiltX: 0, tiltY: 0, scale: 1, positionLerp: 0.18, rotationLerp: 0.22 },
  subtle: { lift: 6, followX: 5, followY: 3, tiltX: 3, tiltY: 4, scale: 1.015, positionLerp: 0.22, rotationLerp: 0.26 },
  normal: { lift: 12, followX: 12, followY: 8, tiltX: 6, tiltY: 8, scale: 1.03, positionLerp: 0.18, rotationLerp: 0.22 },
  strong: { lift: 20, followX: 24, followY: 15, tiltX: 9, tiltY: 12, scale: 1.05, positionLerp: 0.15, rotationLerp: 0.19 },
  drunk: { lift: 30, followX: 40, followY: 25, tiltX: 14, tiltY: 18, scale: 1.075, positionLerp: 0.11, rotationLerp: 0.15 },
};

export interface CardTiltEnvironment {
  finePointer?: boolean;
  reducedMotion?: boolean;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  preset?: CardMotionPresetName;
  cardSize?: MemeCardSize;
}

const RETURN_ROTATION_MS = 180;
const RETURN_LIFT_MS = 300;
const POSITION_EPSILON = 0.02;
const ROTATION_EPSILON = 0.02;
const boundCards = new WeakMap<HTMLElement, () => void>();
const drunkControllers = new WeakMap<HTMLElement, DrunkPhysicsController>();

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function isCardMotionPresetName(value: string | null): value is CardMotionPresetName {
  return value === "off" || value === "subtle" || value === "normal"
    || value === "strong" || value === "drunk";
}

export function storedCardMotionPreset(storage: Pick<Storage, "getItem"> = localStorage): CardMotionPresetName {
  const value = storage.getItem(CARD_MOTION_PRESET_STORAGE_KEY);
  return isCardMotionPresetName(value) ? value : "normal";
}

export function saveCardMotionPreset(
  preset: CardMotionPresetName,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(CARD_MOTION_PRESET_STORAGE_KEY, preset);
}

export function cardTiltProfile(
  width: number,
  height: number,
  presetName: CardMotionPresetName = "normal",
  cardSize: MemeCardSize = "medium",
): CardTiltProfile | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const ratio = width / height;
  const slenderness = Math.max(ratio, 1 / ratio);
  const tiltStrength = slenderness <= 2
    ? 1
    : clamp(1 / (1 + 0.35 * (slenderness - 2)), 0.08, 1);
  const translationStrength = Math.pow(tiltStrength, 1.5);
  const liftStrength = 0.55 + tiltStrength * 0.45;
  const scaleStrength = 0.5 + tiltStrength * 0.5;
  const preset = CARD_MOTION_PRESETS[presetName];
  const sizeMotion = CARD_SIZE_MOTION[cardSize];

  return {
    slenderness,
    tiltStrength,
    liftPixels: preset.lift * sizeMotion.translation * liftStrength,
    scale: 1 + (preset.scale - 1) * scaleStrength,
    maxRotateX: preset.tiltX * sizeMotion.rotation * tiltStrength,
    maxRotateY: preset.tiltY * sizeMotion.rotation * tiltStrength,
    maxFollowX: preset.followX * sizeMotion.translation * Math.max(0.25, translationStrength),
    maxFollowY: preset.followY * sizeMotion.translation * Math.max(0.25, translationStrength),
  };
}

function mediaMatches(query: string): boolean {
  return typeof matchMedia === "function" && matchMedia(query).matches;
}

export function bindCardTilt(
  card: HTMLElement,
  environment: CardTiltEnvironment = {},
): () => void {
  if (card.dataset.cardTilt === "ready") {
    return () => undefined;
  }

  const width = Number(card.dataset.cardWidth);
  const height = Number(card.dataset.cardHeight);
  const presetName = environment.preset ?? storedCardMotionPreset();
  const preset = CARD_MOTION_PRESETS[presetName];
  const cardSize = environment.cardSize ?? card.closest<HTMLElement>(".meme-grid")?.dataset.cardSize;
  const resolvedCardSize: MemeCardSize = cardSize === "small" || cardSize === "large"
    || cardSize === "extra-large" ? cardSize : "medium";
  const profile = cardTiltProfile(width, height, presetName, resolvedCardSize);
  const finePointer = environment.finePointer
    ?? mediaMatches("(hover: hover) and (pointer: fine)");
  const reducedMotion = environment.reducedMotion
    ?? mediaMatches("(prefers-reduced-motion: reduce)");

  if (!profile || presetName === "off" || !finePointer || reducedMotion) {
    return () => undefined;
  }

  const requestFrame = environment.requestFrame ?? requestAnimationFrame.bind(globalThis);
  const cancelFrame = environment.cancelFrame ?? cancelAnimationFrame.bind(globalThis);
  let bounds: DOMRect | null = null;
  let frame: number | null = null;
  let returnTimer: ReturnType<typeof setTimeout> | null = null;
  let latestX = 0;
  let latestY = 0;
  let currentX = 0;
  let currentY = 0;
  let currentRotateX = 0;
  let currentRotateY = 0;
  let targetX = 0;
  let targetY = 0;
  let targetRotateX = 0;
  let targetRotateY = 0;

  card.dataset.cardTilt = "ready";
  card.style.setProperty("--card-lift-y", `${-profile.liftPixels.toFixed(2)}px`);
  card.style.setProperty("--card-lift-scale", profile.scale.toFixed(4));
  card.style.setProperty("--card-tilt-x", "0deg");
  card.style.setProperty("--card-tilt-y", "0deg");
  card.style.setProperty("--card-follow-x", "0px");
  card.style.setProperty("--card-follow-y", "0px");

  const clearReturnTimer = (): void => {
    if (returnTimer !== null) {
      clearTimeout(returnTimer);
    }
    returnTimer = null;
  };

  const writeTransformVariables = (): void => {
    card.style.setProperty("--card-tilt-x", `${currentRotateX.toFixed(3)}deg`);
    card.style.setProperty("--card-tilt-y", `${currentRotateY.toFixed(3)}deg`);
    card.style.setProperty("--card-follow-x", `${currentX.toFixed(3)}px`);
    card.style.setProperty("--card-follow-y", `${currentY.toFixed(3)}px`);
  };

  const isSettled = (): boolean => (
    Math.abs(targetX - currentX) < POSITION_EPSILON
    && Math.abs(targetY - currentY) < POSITION_EPSILON
    && Math.abs(targetRotateX - currentRotateX) < ROTATION_EPSILON
    && Math.abs(targetRotateY - currentRotateY) < ROTATION_EPSILON
  );

  const animateTowardsTarget = (): void => {
    frame = null;
    currentX += (targetX - currentX) * preset.positionLerp;
    currentY += (targetY - currentY) * preset.positionLerp;
    currentRotateX += (targetRotateX - currentRotateX) * preset.rotationLerp;
    currentRotateY += (targetRotateY - currentRotateY) * preset.rotationLerp;

    if (isSettled()) {
      currentX = targetX;
      currentY = targetY;
      currentRotateX = targetRotateX;
      currentRotateY = targetRotateY;
      writeTransformVariables();
      return;
    }

    writeTransformVariables();
    frame = requestFrame(animateTowardsTarget);
  };

  const scheduleAnimation = (): void => {
    if (frame === null && !isSettled()) {
      frame = requestFrame(animateTowardsTarget);
    }
  };

  const updatePointerTarget = (): void => {
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    const normalizedX = clamp(((latestX - bounds.left) / bounds.width) * 2 - 1, -1, 1);
    const normalizedY = clamp(((latestY - bounds.top) / bounds.height) * 2 - 1, -1, 1);
    targetRotateX = -normalizedY * profile.maxRotateX;
    targetRotateY = normalizedX * profile.maxRotateY;
    targetX = normalizedX * profile.maxFollowX;
    targetY = normalizedY * profile.maxFollowY;
    scheduleAnimation();
  };

  const enter = (): void => {
    clearReturnTimer();
    bounds = card.getBoundingClientRect();
    card.classList.remove("is-card-returning");
    card.classList.add("is-card-lifted");
  };

  const move = (event: PointerEvent): void => {
    latestX = event.clientX;
    latestY = event.clientY;
    card.classList.add("is-card-tracking");
    updatePointerTarget();
  };

  const leave = (): void => {
    bounds = null;
    clearReturnTimer();
    card.classList.remove("is-card-tracking");
    card.classList.add("is-card-returning");
    targetX = 0;
    targetY = 0;
    targetRotateX = 0;
    targetRotateY = 0;
    scheduleAnimation();
    returnTimer = setTimeout(() => {
      card.classList.remove("is-card-lifted");
      returnTimer = setTimeout(() => {
        card.classList.remove("is-card-returning");
        returnTimer = null;
      }, RETURN_LIFT_MS);
    }, RETURN_ROTATION_MS);
  };

  card.addEventListener("pointerenter", enter);
  card.addEventListener("pointermove", move);
  card.addEventListener("pointerleave", leave);

  const cleanup = (): void => {
    clearReturnTimer();
    if (frame !== null) {
      cancelFrame(frame);
    }
    card.removeEventListener("pointerenter", enter);
    card.removeEventListener("pointermove", move);
    card.removeEventListener("pointerleave", leave);
    card.classList.remove("is-card-lifted", "is-card-tracking", "is-card-returning");
    delete card.dataset.cardTilt;
    boundCards.delete(card);
  };
  boundCards.set(card, cleanup);
  return cleanup;
}

export function bindMemeCardTilts(
  container: ParentNode,
  environment: CardTiltEnvironment = {},
): void {
  const preset = environment.preset ?? storedCardMotionPreset();
  const cardSize = container instanceof HTMLElement
    ? container.dataset.cardSize as MemeCardSize | undefined
    : undefined;
  if (container instanceof HTMLElement) {
    container.dataset.cardMotion = preset;
  }
  for (const card of container.querySelectorAll<HTMLElement>(".meme-card[data-meme-id]")) {
    bindCardTilt(card, { ...environment, preset, cardSize: environment.cardSize ?? cardSize });
  }
  if (container instanceof HTMLElement) syncDrunkPhysics(container, preset, environment);
}

export function applyCardMotionPreset(
  container: HTMLElement,
  preset: CardMotionPresetName,
  environment: Omit<CardTiltEnvironment, "preset"> = {},
): void {
  container.dataset.cardMotion = preset;
  const cardSize = environment.cardSize
    ?? (container.dataset.cardSize as MemeCardSize | undefined);
  for (const card of container.querySelectorAll<HTMLElement>(".meme-card[data-meme-id]")) {
    boundCards.get(card)?.();
    bindCardTilt(card, { ...environment, preset, cardSize });
  }
  syncDrunkPhysics(container, preset, environment);
}

function syncDrunkPhysics(
  container: HTMLElement,
  preset: CardMotionPresetName,
  environment: Omit<CardTiltEnvironment, "preset">,
): void {
  const existing = drunkControllers.get(container);
  if (preset !== "drunk") {
    existing?.stop();
    drunkControllers.delete(container);
    return;
  }
  if (existing) {
    existing.refresh();
    return;
  }
  const controller = new DrunkPhysicsController(container, {
    finePointer: environment.finePointer,
    reducedMotion: environment.reducedMotion,
    requestFrame: environment.requestFrame,
    cancelFrame: environment.cancelFrame,
  });
  if (controller.start()) drunkControllers.set(container, controller);
}
