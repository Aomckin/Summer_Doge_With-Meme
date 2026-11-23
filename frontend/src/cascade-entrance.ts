/**
 * v2.1 Staggered cascade entrance controller for normal library list cards.
 * Performs a single-pass geometric measurement of in-viewport cards, sorts
 * by visual position (strict top then left), and applies staggered opacity-only fade-in.
 * Immediately downgrades to static display on reduced-motion, motion=off,
 * complex modes, hidden documents, or when aborted/interrupted.
 */

export interface CascadeEntranceOptions {
  signal?: AbortSignal;
}

export class CascadeEntranceController {
  private readonly abortController = new AbortController();
  private pendingRaf = 0;
  private fallbackTimeout = 0;
  private readonly activeCards = new Set<HTMLElement>();
  private externalSignal: AbortSignal | null = null;

  private readonly onExternalAbort = (): void => {
    this.destroy();
  };

  private readonly onAnimationEvent = (event: AnimationEvent): void => {
    const card = event.target;
    if (
      card instanceof HTMLElement &&
      event.animationName === "card-cascade-in" &&
      this.activeCards.has(card)
    ) {
      this.cleanupCard(card);
      if (this.activeCards.size === 0 && this.fallbackTimeout) {
        clearTimeout(this.fallbackTimeout);
        this.fallbackTimeout = 0;
      }
    }
  };

  constructor(
    private readonly grid: HTMLElement,
    options?: CascadeEntranceOptions,
  ) {
    if (options?.signal) {
      if (options.signal.aborted) {
        this.destroy();
        return;
      }
      this.externalSignal = options.signal;
      this.externalSignal.addEventListener("abort", this.onExternalAbort);
    }

    const signal = this.abortController.signal;

    // Listen on grid for both animationend and animationcancel
    this.grid.addEventListener("animationend", this.onAnimationEvent, { signal });
    this.grid.addEventListener("animationcancel", this.onAnimationEvent, { signal });

    // Cancel and make static if document visibility changes to hidden
    document.addEventListener(
      "visibilitychange",
      () => {
        if (typeof document !== "undefined" && document.hidden) {
          this.cancel();
        }
      },
      { signal },
    );

    // Cancel immediately if system motion preference changes to reduced-motion
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      try {
        const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
        const onMediaChange = (e: MediaQueryListEvent | MediaQueryList): void => {
          if (e.matches) {
            this.cancel();
          }
        };
        if (typeof mql.addEventListener === "function") {
          mql.addEventListener("change", onMediaChange, { signal });
        } else if (typeof mql.addListener === "function") {
          mql.addListener(onMediaChange);
          signal.addEventListener("abort", () => mql.removeListener(onMediaChange), { once: true });
        }
      } catch {
        // Graceful handling for non-standard environments
      }
    }
  }

  private isReducedMotion(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }

  /**
   * Triggers a single-pass staggered entrance for newly rendered cards in normal list view.
   */
  trigger(): void {
    this.cancel();

    if (this.abortController.signal.aborted) return;

    // Do not animate if document is currently hidden
    if (typeof document !== "undefined" && document.hidden) {
      return;
    }

    // Static downgrade: prefers-reduced-motion
    if (this.isReducedMotion()) {
      return;
    }

    // Static downgrade: card motion is turned off
    if (this.grid.dataset.cardMotion === "off") {
      return;
    }

    // Static downgrade: immersive feed, free gallery, or focus mode
    const isImmersive = document.documentElement.dataset.vaultMode === "immersive";
    if (isImmersive) {
      return;
    }

    // Schedule single batch read after current paint/layout has stabilized
    this.pendingRaf = requestAnimationFrame(() => {
      this.pendingRaf = 0;
      this.measureAndAnimate();
    });
  }

  private measureAndAnimate(): void {
    if (this.abortController.signal.aborted) return;

    if (
      (typeof document !== "undefined" && document.hidden) ||
      this.isReducedMotion() ||
      this.grid.dataset.cardMotion === "off" ||
      document.documentElement.dataset.vaultMode === "immersive"
    ) {
      return;
    }

    const cardElements = Array.from(
      this.grid.querySelectorAll<HTMLElement>(".meme-card[data-meme-id]"),
    );
    if (!cardElements.length) return;

    const viewportHeight = window.innerHeight || 800;
    const viewportWidth = window.innerWidth || 1200;

    // Single-pass batch read: collect geometric coordinates of cards in the current viewport
    const candidates: { card: HTMLElement; top: number; left: number }[] = [];
    for (const card of cardElements) {
      const rect = card.getBoundingClientRect();
      // Only include cards with physical geometry in viewport
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < viewportHeight &&
        rect.right > 0 &&
        rect.left < viewportWidth
      ) {
        candidates.push({ card, top: rect.top, left: rect.left });
      }
    }

    if (!candidates.length) return;

    // Sort strictly by visual top position, then by left position
    candidates.sort((a, b) => {
      if (a.top !== b.top) {
        return a.top - b.top;
      }
      return a.left - b.left;
    });

    // Limit to at most the first 12 visible cards
    const batch = candidates.slice(0, 12);
    const maxTotalDelay = 300; // ms
    const step = batch.length > 1 ? Math.min(25, Math.floor(maxTotalDelay / (batch.length - 1))) : 0;

    // Single-pass batch write: assign delay and activate animation
    for (let index = 0; index < batch.length; index++) {
      const { card } = batch[index];
      const delay = index * step;
      card.style.setProperty("--card-stagger-delay", `${delay}ms`);
      card.setAttribute("data-stagger-in", "active");
      this.activeCards.add(card);
    }

    // Safety fallback: ensure all active cards are normalized after animation concludes
    const fallbackDuration = maxTotalDelay + 240 + 100; // maxDelay + duration + buffer
    this.fallbackTimeout = window.setTimeout(() => {
      this.fallbackTimeout = 0;
      this.cancel();
    }, fallbackDuration);
  }

  private cleanupCard(card: HTMLElement): void {
    this.activeCards.delete(card);
    card.removeAttribute("data-stagger-in");
    card.style.removeProperty("--card-stagger-delay");
  }

  /**
   * Cancels in-flight cascade measurement or animation, ensuring all cards are fully visible.
   */
  cancel(): void {
    if (this.pendingRaf) {
      cancelAnimationFrame(this.pendingRaf);
      this.pendingRaf = 0;
    }
    if (this.fallbackTimeout) {
      clearTimeout(this.fallbackTimeout);
      this.fallbackTimeout = 0;
    }
    for (const card of this.activeCards) {
      card.removeAttribute("data-stagger-in");
      card.style.removeProperty("--card-stagger-delay");
    }
    this.activeCards.clear();
  }

  destroy(): void {
    this.cancel();
    if (this.externalSignal) {
      this.externalSignal.removeEventListener("abort", this.onExternalAbort);
      this.externalSignal = null;
    }
    this.abortController.abort();
  }
}
