/**
 * v2.1 Staggered cascade entrance controller for normal library list cards.
 * Provides an organic arrival rhythm across all visual rows:
 * 1. Initial viewport wave: measures layout-stabilized cards across first, second, and third+ rows,
 *    sorting strictly by visual position (top then left) with a capped rolling delay.
 * 2. Continuous scroll reveal: uses IntersectionObserver to observe off-screen cards; as the user
 *    scrolls down, newly approaching rows stagger in once upon arrival.
 * 3. No-replay guard: cards that have already revealed are tracked via WeakSet and never replayed.
 * 4. Automatic discovery: internal MutationObserver detects newly appended normal-list cards and
 *    wires them to scroll-reveal without altering immersive feed semantics or stealing pending initial wave.
 * 5. Generation identity guard: stale queued observer callbacks after retrigger/cancel are rejected.
 * 6. Keyboard, pointer & accessibility first: focusin / pointerenter immediately clears animation.
 * 7. Robust static downgrade: prefers-reduced-motion, card-motion="off", immersive mode, document hidden,
 *    or missing/errored APIs immediately ensure all cards remain 100% visible and accessible.
 */

export interface CascadeEntranceOptions {
  signal?: AbortSignal;
  createObserver?: (
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit,
  ) => IntersectionObserver;
  rootMargin?: string;
}

export class CascadeEntranceController {
  private readonly abortController = new AbortController();
  private pendingRaf = 0;
  private fallbackTimeout = 0;
  private fallbackDeadline = 0;
  private generation = 0;
  private readonly activeCards = new Set<HTMLElement>();
  private readonly revealedCards = new WeakSet<HTMLElement>();
  private observer: IntersectionObserver | null = null;
  private observerGeneration = 0;
  private mutationObserver: MutationObserver | null = null;
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
        this.fallbackDeadline = 0;
      }
    }
  };

  private readonly onCardFocusIn = (event: FocusEvent): void => {
    const card = (event.target as HTMLElement | null)?.closest<HTMLElement>(".meme-card");
    if (card && this.activeCards.has(card)) {
      this.cleanupCard(card);
      if (this.activeCards.size === 0 && this.fallbackTimeout) {
        clearTimeout(this.fallbackTimeout);
        this.fallbackTimeout = 0;
        this.fallbackDeadline = 0;
      }
    }
  };

  private readonly onCardPointerEnter = (event: Event): void => {
    const card = (event.target as HTMLElement | null)?.closest<HTMLElement>(".meme-card");
    if (card && this.activeCards.has(card)) {
      this.cleanupCard(card);
      if (this.activeCards.size === 0 && this.fallbackTimeout) {
        clearTimeout(this.fallbackTimeout);
        this.fallbackTimeout = 0;
        this.fallbackDeadline = 0;
      }
    }
  };

  constructor(
    private readonly grid: HTMLElement,
    private readonly options?: CascadeEntranceOptions,
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

    // Listen on grid for animation events, keyboard focus, and pointer hover
    this.grid.addEventListener("animationend", this.onAnimationEvent, { signal });
    this.grid.addEventListener("animationcancel", this.onAnimationEvent, { signal });
    this.grid.addEventListener("focusin", this.onCardFocusIn, { signal });
    this.grid.addEventListener("pointerenter", this.onCardPointerEnter, { signal, capture: true });

    // Handle document visibility changes
    document.addEventListener(
      "visibilitychange",
      () => {
        if (typeof document !== "undefined") {
          if (document.hidden) {
            document.documentElement.dataset.documentHidden = "true";
            this.cancel();
          } else {
            delete document.documentElement.dataset.documentHidden;
            this.trigger();
          }
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
          } else {
            this.trigger();
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

    // Set up MutationObserver to automatically discover newly appended normal-list cards
    if (typeof MutationObserver !== "undefined") {
      try {
        this.mutationObserver = new MutationObserver((mutations) => {
          this.handleGridMutations(mutations);
        });
        this.mutationObserver.observe(this.grid, { childList: true, subtree: true });
      } catch {
        this.mutationObserver = null;
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

  private isPausedOrDisabled(): boolean {
    return (
      this.abortController.signal.aborted ||
      (typeof document !== "undefined" && document.hidden) ||
      this.isReducedMotion() ||
      this.grid.dataset.cardMotion === "off" ||
      document.documentElement.dataset.cardMotion === "off" ||
      document.documentElement.dataset.vaultMode === "immersive"
    );
  }

  private handleGridMutations(mutations: MutationRecord[]): void {
    if (this.isPausedOrDisabled()) return;

    // When an initial wave measurement is scheduled (pendingRaf !== 0),
    // measureAndAnimateInitialView will run in the very next animation frame
    // and process all cards currently in this.grid in reading order.
    // MutationObserver must not pre-emptively process them and steal the initial wave!
    if (this.pendingRaf !== 0) {
      return;
    }

    const appendedCards: HTMLElement[] = [];
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof HTMLElement) {
          if (node.classList.contains("meme-card") && node.dataset.memeId) {
            if (!this.revealedCards.has(node) && !this.activeCards.has(node)) {
              appendedCards.push(node);
            }
          } else {
            const nested = node.querySelectorAll<HTMLElement>(".meme-card[data-meme-id]");
            for (const card of Array.from(nested)) {
              if (!this.revealedCards.has(card) && !this.activeCards.has(card)) {
                appendedCards.push(card);
              }
            }
          }
        }
      }
    }

    if (appendedCards.length) {
      this.observeAppendedCards(appendedCards);
    }
  }

  private ensureObserver(): IntersectionObserver | null {
    if (this.observer) return this.observer;
    const create = this.options?.createObserver ?? ((cb, opts) => new IntersectionObserver(cb, opts));
    if (!this.options?.createObserver && typeof IntersectionObserver === "undefined") {
      return null;
    }
    try {
      this.observerGeneration = this.generation;
      const currentGen = this.observerGeneration;
      this.observer = create(
        (entries) => {
          if (this.generation !== currentGen) return;
          this.handleIntersectionEntries(entries, currentGen);
        },
        {
          root: null,
          rootMargin: this.options?.rootMargin ?? "80px 0px 80px 0px",
          threshold: 0,
        },
      );
      return this.observer;
    } catch {
      return null;
    }
  }

  private handleIntersectionEntries(
    entries: IntersectionObserverEntry[],
    callbackGen: number,
  ): void {
    if (this.generation !== callbackGen || this.isPausedOrDisabled()) {
      return;
    }

    const arrivingCards: { card: HTMLElement; top: number; left: number }[] = [];
    for (const entry of entries) {
      const card = entry.target as HTMLElement;
      // Filter out disconnected or detached nodes
      if (!card.isConnected || !this.grid.contains(card)) {
        try {
          this.observer?.unobserve(card);
        } catch {
          // ignore
        }
        continue;
      }

      if (entry.isIntersecting && !this.revealedCards.has(card) && !this.activeCards.has(card)) {
        try {
          this.observer?.unobserve(card);
        } catch {
          // ignore
        }
        this.revealedCards.add(card);
        const rect = card.getBoundingClientRect();
        arrivingCards.push({ card, top: rect.top, left: rect.left });
      }
    }

    if (!arrivingCards.length) return;

    // Sort arriving wave by visual top position, then left
    arrivingCards.sort((a, b) => (a.top !== b.top ? a.top - b.top : a.left - b.left));

    // Stagger arriving wave (max 240ms wave)
    const maxBatchDelay = 240;
    const step = arrivingCards.length > 1
      ? Math.min(35, Math.floor(maxBatchDelay / (arrivingCards.length - 1)))
      : 0;

    for (let index = 0; index < arrivingCards.length; index++) {
      const { card } = arrivingCards[index];
      const delay = index * step;
      card.style.setProperty("--card-stagger-delay", `${delay}ms`);
      card.setAttribute("data-stagger-in", "active");
      this.activeCards.add(card);
    }

    this.scheduleFallbackTimeout(maxBatchDelay + 300 + 100);
  }

  /**
   * Triggers entrance cascade for library cards.
   * Viewport cards cascade immediately in reading order; off-screen cards
   * are observed and cascade in smoothly when approaching during scroll.
   */
  trigger(): void {
    this.cancel();

    if (this.isPausedOrDisabled()) return;

    this.generation++;
    const currentGeneration = this.generation;

    // Schedule batch read after current paint/layout has stabilized
    this.pendingRaf = requestAnimationFrame(() => {
      this.pendingRaf = 0;
      if (this.generation !== currentGeneration) return;
      this.measureAndAnimateInitialView(currentGeneration);
    });
  }

  private measureAndAnimateInitialView(executionGeneration: number): void {
    if (this.generation !== executionGeneration || this.isPausedOrDisabled()) return;

    const cardElements = Array.from(
      this.grid.querySelectorAll<HTMLElement>(".meme-card[data-meme-id]"),
    );
    if (!cardElements.length) return;

    const viewportHeight = window.innerHeight || 800;
    const viewportWidth = window.innerWidth || 1200;

    const initialVisible: { card: HTMLElement; top: number; left: number }[] = [];

    for (const card of cardElements) {
      if (!card.isConnected || !this.grid.contains(card)) continue;
      // Skip DOM nodes that were already revealed in this controller's lifecycle
      if (this.revealedCards.has(card)) continue;

      const rect = card.getBoundingClientRect();
      const isVisibleInView =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < viewportHeight &&
        rect.right > 0 &&
        rect.left < viewportWidth;

      if (isVisibleInView) {
        initialVisible.push({ card, top: rect.top, left: rect.left });
      }
    }

    if (initialVisible.length) {
      // Sort strictly by visual top position, then by left position
      initialVisible.sort((a, b) => {
        if (a.top !== b.top) {
          return a.top - b.top;
        }
        return a.left - b.left;
      });

      // Stagger through all visible rows (capped at 300ms total to stay responsive)
      const maxTotalDelay = 300;
      const step = initialVisible.length > 1
        ? Math.min(25, Math.floor(maxTotalDelay / (initialVisible.length - 1)))
        : 0;

      for (let index = 0; index < initialVisible.length; index++) {
        const { card } = initialVisible[index];
        const delay = index * step;
        card.style.setProperty("--card-stagger-delay", `${delay}ms`);
        card.setAttribute("data-stagger-in", "active");
        this.activeCards.add(card);
        this.revealedCards.add(card);
      }

      this.scheduleFallbackTimeout(maxTotalDelay + 240 + 100);
    }

    // Set up scroll observer for off-screen cards (and any cards not yet revealed)
    const observer = this.ensureObserver();
    if (observer) {
      for (const card of cardElements) {
        if (card.isConnected && this.grid.contains(card) && !this.revealedCards.has(card)) {
          try {
            observer.observe(card);
          } catch {
            // Graceful fallback if observe throws
            this.revealedCards.add(card);
          }
        }
      }
    }
  }

  private scheduleFallbackTimeout(duration = 640): void {
    const newDeadline = Date.now() + duration;
    if (this.fallbackTimeout && newDeadline <= this.fallbackDeadline) {
      return;
    }
    if (this.fallbackTimeout) {
      clearTimeout(this.fallbackTimeout);
    }
    this.fallbackDeadline = newDeadline;
    this.fallbackTimeout = window.setTimeout(() => {
      this.fallbackTimeout = 0;
      this.fallbackDeadline = 0;
      this.cleanupActiveCards();
    }, duration);
  }

  private cleanupActiveCards(): void {
    this.fallbackDeadline = 0;
    for (const card of this.activeCards) {
      card.removeAttribute("data-stagger-in");
      card.style.removeProperty("--card-stagger-delay");
    }
    this.activeCards.clear();
  }

  private cleanupCard(card: HTMLElement): void {
    this.activeCards.delete(card);
    card.removeAttribute("data-stagger-in");
    card.style.removeProperty("--card-stagger-delay");
  }

  /**
   * Observe newly appended cards without replaying animation for already revealed ones.
   */
  observeAppendedCards(cards: HTMLElement[]): void {
    if (this.isPausedOrDisabled()) return;

    const observer = this.ensureObserver();
    if (!observer) return;

    const viewportHeight = window.innerHeight || 800;
    const viewportWidth = window.innerWidth || 1200;

    const visibleAppended: { card: HTMLElement; top: number; left: number }[] = [];

    for (const card of cards) {
      if (!card.isConnected || !this.grid.contains(card)) continue;
      if (this.revealedCards.has(card) || this.activeCards.has(card)) continue;

      const rect = card.getBoundingClientRect();
      const isVisibleInView =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < viewportHeight &&
        rect.right > 0 &&
        rect.left < viewportWidth;

      if (isVisibleInView) {
        visibleAppended.push({ card, top: rect.top, left: rect.left });
      } else {
        try {
          observer.observe(card);
        } catch {
          this.revealedCards.add(card);
        }
      }
    }

    if (visibleAppended.length) {
      visibleAppended.sort((a, b) => (a.top !== b.top ? a.top - b.top : a.left - b.left));
      const maxBatchDelay = 200;
      const step = visibleAppended.length > 1
        ? Math.min(25, Math.floor(maxBatchDelay / (visibleAppended.length - 1)))
        : 0;

      for (let i = 0; i < visibleAppended.length; i++) {
        const { card } = visibleAppended[i];
        card.setAttribute("data-stagger-in", "active");
        card.style.setProperty("--card-stagger-delay", `${i * step}ms`);
        this.activeCards.add(card);
        this.revealedCards.add(card);
      }
      this.scheduleFallbackTimeout(maxBatchDelay + 300 + 100);
    }
  }

  /**
   * Cancels in-flight cascade measurement or animation, ensuring all cards are fully visible.
   */
  cancel(): void {
    this.generation++;
    if (this.pendingRaf) {
      cancelAnimationFrame(this.pendingRaf);
      this.pendingRaf = 0;
    }
    if (this.fallbackTimeout) {
      clearTimeout(this.fallbackTimeout);
      this.fallbackTimeout = 0;
      this.fallbackDeadline = 0;
    }
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch {
        // ignore
      }
      this.observer = null;
    }
    this.cleanupActiveCards();
  }

  destroy(): void {
    this.cancel();
    delete document.documentElement.dataset.documentHidden;
    if (this.mutationObserver) {
      try {
        this.mutationObserver.disconnect();
      } catch {
        // ignore
      }
      this.mutationObserver = null;
    }
    if (this.externalSignal) {
      this.externalSignal.removeEventListener("abort", this.onExternalAbort);
      this.externalSignal = null;
    }
    this.abortController.abort();
  }
}
