import { cardSizeMotionMultiplier } from "./card-motion-config";

interface DrunkCardState {
  phase: number;
  speed: number;
  amplitudeX: number;
  amplitudeY: number;
  rotationAmplitude: number;
  liftAmplitude: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  currentX: number;
  currentY: number;
  currentLift: number;
  currentTiltX: number;
  currentTiltY: number;
  currentRotation: number;
}

interface DrunkIntersectionObserver {
  observe(target: Element): void;
  disconnect(): void;
}

export interface DrunkPhysicsEnvironment {
  finePointer?: boolean;
  reducedMotion?: boolean;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  random?: () => number;
  createObserver?: (
    callback: IntersectionObserverCallback,
  ) => DrunkIntersectionObserver;
}

const ATTRACTION_RADIUS = 520;
const ATTRACTION_DISTANCE = 18;
const ATTRACTION_LIFT = 18;
const ATTRACTION_TILT_X = 7;
const ATTRACTION_TILT_Y = 9;
const AMBIENT_LERP = 0.1;
const HOVER_AMBIENT_FACTOR = 0.16;

function mediaMatches(query: string): boolean {
  return typeof matchMedia === "function" && matchMedia(query).matches;
}

function defaultObserver(
  callback: IntersectionObserverCallback,
): DrunkIntersectionObserver | null {
  if (typeof IntersectionObserver !== "function") return null;
  return new IntersectionObserver(callback, { rootMargin: "200px" });
}

// Card Motion Feature Freeze: this is the final environmental effect layer.
export class DrunkPhysicsController {
  private readonly states = new Map<HTMLElement, DrunkCardState>();
  private readonly visibleCards = new Set<HTMLElement>();
  private observer: DrunkIntersectionObserver | null = null;
  private frame: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private pointerActive = false;
  private centersDirty = true;
  private running = false;

  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly random: () => number;

  constructor(
    private readonly container: HTMLElement,
    private readonly environment: DrunkPhysicsEnvironment = {},
  ) {
    this.requestFrame = environment.requestFrame
      ?? (typeof requestAnimationFrame === "function"
        ? requestAnimationFrame.bind(globalThis)
        : (() => 0));
    this.cancelFrame = environment.cancelFrame
      ?? (typeof cancelAnimationFrame === "function"
        ? cancelAnimationFrame.bind(globalThis)
        : (() => undefined));
    this.random = environment.random ?? Math.random;
  }

  start(): boolean {
    if (this.running) return true;
    const finePointer = this.environment.finePointer
      ?? mediaMatches("(hover: hover) and (pointer: fine)");
    const reducedMotion = this.environment.reducedMotion
      ?? mediaMatches("(prefers-reduced-motion: reduce)");
    if (!finePointer || reducedMotion) return false;

    const createObserver = this.environment.createObserver
      ?? ((callback: IntersectionObserverCallback) => defaultObserver(callback));
    this.observer = createObserver(entries => {
      for (const entry of entries) {
        if (!(entry.target instanceof HTMLElement)) continue;
        if (entry.isIntersecting) {
          this.visibleCards.add(entry.target);
        } else {
          this.visibleCards.delete(entry.target);
          this.resetCard(entry.target);
        }
      }
      this.centersDirty = true;
      if (this.visibleCards.size === 0) {
        if (this.frame !== null) this.cancelFrame(this.frame);
        this.frame = null;
      } else {
        this.scheduleFrame();
      }
    });
    if (!this.observer) return false;

    this.running = true;
    this.container.addEventListener("pointermove", this.handlePointerMove);
    this.container.addEventListener("pointerleave", this.handlePointerLeave);
    window.addEventListener("scroll", this.markCentersDirty, { passive: true, capture: true });
    window.addEventListener("resize", this.markCentersDirty, { passive: true });
    this.refresh();
    return true;
  }

  refresh(): void {
    if (!this.running || !this.observer) return;
    this.observer.disconnect();
    this.visibleCards.clear();
    const currentCards = new Set(
      this.container.querySelectorAll<HTMLElement>(".meme-card[data-card-tilt=\"ready\"]"),
    );
    for (const card of this.states.keys()) {
      if (!currentCards.has(card)) {
        this.resetCard(card);
        this.states.delete(card);
      }
    }
    for (const card of currentCards) {
      if (!this.states.has(card)) this.states.set(card, this.createState());
      this.observer.observe(card);
    }
    this.centersDirty = true;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.observer?.disconnect();
    this.observer = null;
    this.container.removeEventListener("pointermove", this.handlePointerMove);
    this.container.removeEventListener("pointerleave", this.handlePointerLeave);
    window.removeEventListener("scroll", this.markCentersDirty, true);
    window.removeEventListener("resize", this.markCentersDirty);
    for (const card of this.states.keys()) this.resetCard(card);
    this.states.clear();
    this.visibleCards.clear();
  }

  private createState(): DrunkCardState {
    return {
      phase: this.random() * Math.PI * 2,
      speed: 0.00035 + this.random() * 0.00045,
      amplitudeX: 1.5 + this.random() * 2.3,
      amplitudeY: 1.2 + this.random() * 1.8,
      rotationAmplitude: 0.25 + this.random() * 0.45,
      liftAmplitude: 1.5 + this.random() * 2.5,
      centerX: 0,
      centerY: 0,
      width: 0,
      height: 0,
      currentX: 0,
      currentY: 0,
      currentLift: 0,
      currentTiltX: 0,
      currentTiltY: 0,
      currentRotation: 0,
    };
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.pointerActive = true;
  };

  private readonly handlePointerLeave = (): void => {
    this.pointerActive = false;
  };

  private readonly markCentersDirty = (): void => {
    this.centersDirty = true;
  };

  private updateCenters(): void {
    for (const card of this.visibleCards) {
      const state = this.states.get(card);
      if (!state) continue;
      const bounds = card.getBoundingClientRect();
      state.centerX = bounds.left + bounds.width / 2;
      state.centerY = bounds.top + bounds.height / 2;
      state.width = bounds.width;
      state.height = bounds.height;
    }
    this.centersDirty = false;
  }

  private scheduleFrame(): void {
    if (this.running && this.visibleCards.size > 0 && this.frame === null) {
      this.frame = this.requestFrame(this.animate);
    }
  }

  private readonly animate = (time: number): void => {
    this.frame = null;
    if (!this.running) return;
    if (this.centersDirty) this.updateCenters();
    const sizeMotion = cardSizeMotionMultiplier(this.container.dataset.cardSize);

    for (const card of this.visibleCards) {
      const state = this.states.get(card);
      if (!state) continue;

      const hoverFactor = card.classList.contains("is-card-lifted")
        ? HOVER_AMBIENT_FACTOR
        : 1;
      const floatX = Math.sin(time * state.speed + state.phase) * state.amplitudeX;
      const floatY = Math.cos(time * state.speed * 0.83 + state.phase * 1.31) * state.amplitudeY;
      const floatRotation = Math.sin(time * state.speed * 0.61 + state.phase * 0.73)
        * state.rotationAmplitude;
      const floatLift = -(Math.sin(time * state.speed * 0.71 + state.phase * 0.47) + 1)
        * 0.5 * state.liftAmplitude;
      let attractionX = 0;
      let attractionY = 0;
      let attractionLift = 0;
      let attractionTiltX = 0;
      let attractionTiltY = 0;

      if (this.pointerActive) {
        const dx = this.pointerX - state.centerX;
        const dy = this.pointerY - state.centerY;
        const distance = Math.hypot(dx, dy);
        if (distance < ATTRACTION_RADIUS) {
          const strength = Math.pow(1 - distance / ATTRACTION_RADIUS, 1.2);
          if (distance > 0) {
            attractionX = dx / distance * strength * ATTRACTION_DISTANCE;
            attractionY = dy / distance * strength * ATTRACTION_DISTANCE;
          }
          const normalizedX = Math.max(-1, Math.min(1, dx / Math.max(1, state.width / 2)));
          const normalizedY = Math.max(-1, Math.min(1, dy / Math.max(1, state.height / 2)));
          attractionLift = -ATTRACTION_LIFT * strength;
          attractionTiltX = -normalizedY * ATTRACTION_TILT_X * strength;
          attractionTiltY = normalizedX * ATTRACTION_TILT_Y * strength;
        }
      }

      const targetX = (floatX + attractionX) * sizeMotion.translation * hoverFactor;
      const targetY = (floatY + attractionY) * sizeMotion.translation * hoverFactor;
      const targetLift = (floatLift + attractionLift) * sizeMotion.translation * hoverFactor;
      const targetTiltX = attractionTiltX * sizeMotion.rotation * hoverFactor;
      const targetTiltY = attractionTiltY * sizeMotion.rotation * hoverFactor;
      const targetRotation = floatRotation * sizeMotion.rotation * hoverFactor;
      state.currentX += (targetX - state.currentX) * AMBIENT_LERP;
      state.currentY += (targetY - state.currentY) * AMBIENT_LERP;
      state.currentLift += (targetLift - state.currentLift) * AMBIENT_LERP;
      state.currentTiltX += (targetTiltX - state.currentTiltX) * AMBIENT_LERP;
      state.currentTiltY += (targetTiltY - state.currentTiltY) * AMBIENT_LERP;
      state.currentRotation += (targetRotation - state.currentRotation) * AMBIENT_LERP;
      card.style.setProperty("--card-drunk-x", `${state.currentX.toFixed(3)}px`);
      card.style.setProperty("--card-drunk-y", `${state.currentY.toFixed(3)}px`);
      card.style.setProperty("--card-drunk-lift", `${state.currentLift.toFixed(3)}px`);
      card.style.setProperty("--card-drunk-tilt-x", `${state.currentTiltX.toFixed(3)}deg`);
      card.style.setProperty("--card-drunk-tilt-y", `${state.currentTiltY.toFixed(3)}deg`);
      card.style.setProperty("--card-drunk-rotate", `${state.currentRotation.toFixed(3)}deg`);
      card.dataset.drunkPhysics = "ready";
    }

    this.scheduleFrame();
  };

  private resetCard(card: HTMLElement): void {
    const state = this.states.get(card);
    if (state) {
      state.currentX = 0;
      state.currentY = 0;
      state.currentLift = 0;
      state.currentTiltX = 0;
      state.currentTiltY = 0;
      state.currentRotation = 0;
    }
    card.style.removeProperty("--card-drunk-x");
    card.style.removeProperty("--card-drunk-y");
    card.style.removeProperty("--card-drunk-lift");
    card.style.removeProperty("--card-drunk-tilt-x");
    card.style.removeProperty("--card-drunk-tilt-y");
    card.style.removeProperty("--card-drunk-rotate");
    delete card.dataset.drunkPhysics;
  }
}
