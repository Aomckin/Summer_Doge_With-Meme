/**
 * v2.1 Interactive Spatial Light Controller.
 * Subtly tracks fine pointer focus across the viewport, updating CSS variables
 * on the root element to drive responsive atmospheric illumination.
 *
 * Architectural constraints & safety:
 * 1. Performance: updates strictly throttled via requestAnimationFrame (0 layout reflows).
 * 2. Motion safety: disabled immediately when prefers-reduced-motion is active or card-motion is off.
 * 3. User appearance integrity: visual intensity is multiplied by --appearance-glow-strength;
 *    if user sets slider to 0, intensity is strictly 0.
 * 4. Lifecycle: clean AbortSignal binding, instant cleanup on destroy or pointerleave.
 * 5. Touch safety: inactive on coarse pointer (touch devices).
 */

export interface SpatialLightOptions {
  signal?: AbortSignal;
  target?: HTMLElement | Window;
}

export class SpatialLightController {
  private readonly abortController = new AbortController();
  private pendingRaf = 0;
  private pointerX = 0;
  private pointerY = 0;
  private isActive = false;
  private externalSignal: AbortSignal | null = null;
  private mutationObserver: MutationObserver | null = null;
  private mediaQueryList: MediaQueryList | null = null;
  private readonly onExternalAbort = (): void => {
    this.destroy();
  };

  private readonly onMediaChange = (e: MediaQueryListEvent | MediaQueryList): void => {
    if (e.matches) {
      this.deactivate();
    }
  };

  constructor(options?: SpatialLightOptions) {
    if (options?.signal) {
      if (options.signal.aborted) {
        this.destroy();
        return;
      }
      this.externalSignal = options.signal;
      this.externalSignal.addEventListener("abort", this.onExternalAbort);
    }

    const signal = this.abortController.signal;

    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      try {
        this.mediaQueryList = window.matchMedia("(prefers-reduced-motion: reduce)");
        if (typeof this.mediaQueryList.addEventListener === "function") {
          this.mediaQueryList.addEventListener("change", this.onMediaChange, { signal });
        } else if (typeof this.mediaQueryList.addListener === "function") {
          this.mediaQueryList.addListener(this.onMediaChange);
        }
      } catch {
        this.mediaQueryList = null;
      }
    }

    // Observe documentElement attributes (cardMotion, vaultMode) to react immediately to preference switches
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      try {
        this.mutationObserver = new MutationObserver(() => {
          if (this.isMotionDisabled()) {
            this.deactivate();
          }
        });
        this.mutationObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-card-motion", "data-vault-mode"],
        });
      } catch {
        this.mutationObserver = null;
      }
    }

    const target = options?.target ?? (typeof window !== "undefined" ? window : null);
    if (!target) return;

    target.addEventListener(
      "pointermove",
      (e: Event) => {
        if (this.isMotionDisabled()) {
          if (this.isActive) this.deactivate();
          return;
        }
        const pe = e as PointerEvent;
        this.pointerX = pe.clientX;
        this.pointerY = pe.clientY;
        this.scheduleUpdate();
      },
      { signal, passive: true },
    );

    target.addEventListener(
      "pointerleave",
      () => {
        this.deactivate();
      },
      { signal, passive: true },
    );

    if (typeof window !== "undefined") {
      window.addEventListener(
        "blur",
        () => {
          this.deactivate();
        },
        { signal, passive: true },
      );
    }

    if (typeof document !== "undefined") {
      document.addEventListener(
        "visibilitychange",
        () => {
          if (document.hidden) {
            this.deactivate();
          }
        },
        { signal },
      );
    }
  }

  private isReducedMotion(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }

  private isCoarsePointer(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    try {
      return window.matchMedia("(pointer: coarse)").matches;
    } catch {
      return false;
    }
  }

  private isMotionDisabled(): boolean {
    if (this.isReducedMotion() || this.isCoarsePointer()) return true;
    if (typeof document !== "undefined") {
      if (document.hidden) return true;
      if (document.documentElement.dataset.vaultMode === "immersive") return true;
      if (document.documentElement.dataset.cardMotion === "off") return true;
      const grid = document.querySelector(".meme-grid");
      if (grid instanceof HTMLElement && grid.dataset.cardMotion === "off") return true;
    }
    return false;
  }

  private scheduleUpdate(): void {
    if (this.pendingRaf || this.isMotionDisabled()) return;
    this.pendingRaf = requestAnimationFrame(() => {
      this.pendingRaf = 0;
      if (this.abortController.signal.aborted || this.isMotionDisabled()) return;
      this.isActive = true;
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty("--canvas-pointer-x", `${this.pointerX}px`);
        document.documentElement.style.setProperty("--canvas-pointer-y", `${this.pointerY}px`);
        document.documentElement.style.setProperty("--canvas-pointer-active", "1");
      }
    });
  }

  private deactivate(): void {
    if (this.pendingRaf) {
      cancelAnimationFrame(this.pendingRaf);
      this.pendingRaf = 0;
    }
    this.isActive = false;
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--canvas-pointer-active", "0");
    }
  }

  destroy(): void {
    this.deactivate();
    if (this.mutationObserver) {
      try {
        this.mutationObserver.disconnect();
      } catch {
        // ignore
      }
      this.mutationObserver = null;
    }
    if (this.mediaQueryList && typeof this.mediaQueryList.removeListener === "function") {
      try {
        this.mediaQueryList.removeListener(this.onMediaChange);
      } catch {
        // ignore
      }
      this.mediaQueryList = null;
    }
    if (this.externalSignal) {
      this.externalSignal.removeEventListener("abort", this.onExternalAbort);
      this.externalSignal = null;
    }
    if (typeof document !== "undefined") {
      document.documentElement.style.removeProperty("--canvas-pointer-x");
      document.documentElement.style.removeProperty("--canvas-pointer-y");
      document.documentElement.style.removeProperty("--canvas-pointer-active");
    }
    this.abortController.abort();
  }
}
