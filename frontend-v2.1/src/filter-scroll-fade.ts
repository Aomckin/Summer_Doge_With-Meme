/**
 * v2.1 Adaptive horizontal scroll fade controller for filter chip tracks.
 * Handles subpixel overflow detection, direction-aware masks, focus protection,
 * and responsive re-calculation across vault changes and tag expansions.
 */

export interface FilterScrollFadeOptions {
  signal?: AbortSignal;
}

export class FilterScrollFadeController {
  private readonly abortController = new AbortController();
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly trackedContainers = new Set<HTMLElement>();
  private readonly trackedWrappers = new Set<HTMLElement>();
  private scheduledRaf = 0;
  private externalSignal: AbortSignal | null = null;
  private readonly onExternalAbort = (): void => {
    this.destroy();
  };

  constructor(
    private readonly root: HTMLElement,
    options?: FilterScrollFadeOptions,
  ) {
    if (options?.signal) {
      if (options.signal.aborted) {
        this.destroy();
        return;
      }
      this.externalSignal = options.signal;
      this.externalSignal.addEventListener("abort", this.onExternalAbort);
    }

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleUpdate();
      });
    }

    const signal = this.abortController.signal;

    // Delegated capture listener for horizontal scroll on filter chips
    this.root.addEventListener(
      "scroll",
      (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.classList.contains("filter-chip-scroll")) {
          this.updateElement(target);
        }
      },
      { capture: true, passive: true, signal },
    );

    this.refresh();
  }

  /**
   * Called on initial mount, content re-render, tag expansion/collapse, or vault switch.
   */
  refresh(): void {
    if (this.abortController.signal.aborted) return;

    // Unobserve and prune elements that have detached from root during re-renders
    for (const el of this.trackedContainers) {
      if (!this.root.contains(el)) {
        this.resizeObserver?.unobserve(el);
        this.trackedContainers.delete(el);
      }
    }
    for (const wrapper of this.trackedWrappers) {
      if (!this.root.contains(wrapper)) {
        this.resizeObserver?.unobserve(wrapper);
        this.trackedWrappers.delete(wrapper);
      }
    }

    // Observe newly mounted elements
    const scrollElements = Array.from(this.root.querySelectorAll<HTMLElement>(".filter-chip-scroll"));
    for (const el of scrollElements) {
      if (!this.trackedContainers.has(el)) {
        this.trackedContainers.add(el);
        this.resizeObserver?.observe(el);
      }
      const parentFilter = el.closest<HTMLElement>(".tag-filters, .template-filters, .profile-filters");
      if (parentFilter && !this.trackedWrappers.has(parentFilter)) {
        this.trackedWrappers.add(parentFilter);
        this.resizeObserver?.observe(parentFilter);
      }
    }
    this.scheduleUpdate();
  }

  private scheduleUpdate(): void {
    if (this.scheduledRaf || this.abortController.signal.aborted) return;
    this.scheduledRaf = requestAnimationFrame(() => {
      this.scheduledRaf = 0;
      this.updateAll();
    });
  }

  updateAll(): void {
    if (this.abortController.signal.aborted) return;
    const scrollElements = this.root.querySelectorAll<HTMLElement>(".filter-chip-scroll");
    for (const el of scrollElements) {
      this.updateElement(el);
    }
  }

  private updateElement(el: HTMLElement): void {
    if (this.abortController.signal.aborted) return;

    const parent = el.closest<HTMLElement>(".tag-filters, .template-filters, .profile-filters");
    const isExpanded = parent ? parent.hasAttribute("data-expanded") : false;
    const isHidden = el.hidden || (parent ? parent.hidden : false) || el.clientWidth <= 0;

    if (isExpanded || isHidden) {
      // Clear fade attributes without unobserving (so it can re-enable when collapsed or shown)
      el.removeAttribute("data-v21-scroll-fade");
      el.removeAttribute("data-overflow-left");
      el.removeAttribute("data-overflow-right");
      return;
    }

    const { scrollLeft, clientWidth, scrollWidth } = el;
    const maxScrollLeft = scrollWidth - clientWidth;

    // Subpixel tolerance threshold: 1.5px
    const TOLERANCE = 1.5;
    const hasOverflow = maxScrollLeft > TOLERANCE;

    if (!hasOverflow) {
      el.removeAttribute("data-v21-scroll-fade");
      el.removeAttribute("data-overflow-left");
      el.removeAttribute("data-overflow-right");
      return;
    }

    el.setAttribute("data-v21-scroll-fade", "true");
    const hasLeft = scrollLeft > TOLERANCE;
    const hasRight = scrollLeft < maxScrollLeft - TOLERANCE;

    if (hasLeft) {
      el.setAttribute("data-overflow-left", "true");
    } else {
      el.removeAttribute("data-overflow-left");
    }

    if (hasRight) {
      el.setAttribute("data-overflow-right", "true");
    } else {
      el.removeAttribute("data-overflow-right");
    }
  }

  destroy(): void {
    if (this.abortController.signal.aborted) return;
    if (this.scheduledRaf) {
      cancelAnimationFrame(this.scheduledRaf);
      this.scheduledRaf = 0;
    }
    if (this.externalSignal) {
      this.externalSignal.removeEventListener("abort", this.onExternalAbort);
      this.externalSignal = null;
    }
    this.resizeObserver?.disconnect();
    this.abortController.abort();
    this.trackedContainers.clear();
    this.trackedWrappers.clear();

    const scrollElements = this.root.querySelectorAll<HTMLElement>(".filter-chip-scroll");
    for (const el of scrollElements) {
      el.removeAttribute("data-v21-scroll-fade");
      el.removeAttribute("data-overflow-left");
      el.removeAttribute("data-overflow-right");
    }
  }
}
