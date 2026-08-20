import type {
  ImmersiveCallbacks,
  ImmersiveElements,
  VaultUIMode,
} from "./immersive-types";

export interface ImmersiveControllerOptions {
  root?: HTMLElement;
  documentRef?: Document;
  windowRef?: Window;
  hideDelay?: number;
  triggerDistance?: number;
  searchDelay?: number;
  coarsePointer?: boolean;
}

export class ImmersiveController {
  private mode: VaultUIMode = "normal";
  private dockLocked = false;
  private dockHideTimer: ReturnType<typeof setTimeout> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private normalScrollY = 0;
  private previousFocus: HTMLElement | null = null;
  private readonly abortController = new AbortController();
  private readonly root: HTMLElement;
  private readonly documentRef: Document;
  private readonly windowRef: Window;
  private readonly hideDelay: number;
  private readonly triggerDistance: number;
  private readonly searchDelay: number;
  private readonly coarsePointer: boolean;

  constructor(
    private readonly elements: ImmersiveElements,
    private readonly callbacks: ImmersiveCallbacks,
    options: ImmersiveControllerOptions = {},
  ) {
    this.documentRef = options.documentRef ?? document;
    this.windowRef = options.windowRef ?? window;
    this.root = options.root ?? this.documentRef.documentElement;
    this.hideDelay = options.hideDelay ?? 900;
    this.triggerDistance = options.triggerDistance ?? 120;
    this.searchDelay = options.searchDelay ?? 300;
    this.coarsePointer = options.coarsePointer ?? (
      typeof this.windowRef.matchMedia === "function"
        && this.windowRef.matchMedia("(pointer: coarse)").matches
    );
    this.root.dataset.vaultMode = "normal";
    this.elements.entryButton.setAttribute("aria-pressed", "false");
    this.elements.dock.setAttribute("aria-hidden", "true");
    this.elements.dock.inert = true;
    this.bindEvents();
  }

  enter(): void {
    if (this.isActive()) return;
    this.mode = "immersive";
    this.normalScrollY = this.windowRef.scrollY;
    this.previousFocus = this.documentRef.activeElement instanceof HTMLElement
      ? this.documentRef.activeElement
      : null;
    this.root.dataset.vaultMode = "immersive";
    this.elements.entryButton.setAttribute("aria-pressed", "true");
    this.elements.dock.setAttribute("aria-hidden", "false");
    this.elements.dock.inert = false;
    this.setSearchValue(this.callbacks.getSearchValue());
    this.refreshPagination();
    this.showDock();
    this.elements.dock.focus({ preventScroll: true });
    this.elements.dock.blur();
    this.callbacks.onLayoutChanged?.();
  }

  exit(): void {
    if (!this.isActive()) return;
    this.mode = "normal";
    this.clearDockTimer();
    this.dockLocked = false;
    this.root.dataset.vaultMode = "normal";
    this.elements.entryButton.setAttribute("aria-pressed", "false");
    this.elements.dock.dataset.visible = "false";
    this.elements.dock.setAttribute("aria-hidden", "true");
    this.elements.dock.inert = true;
    this.callbacks.onLayoutChanged?.();
    const restoreTarget = this.previousFocus?.isConnected
      ? this.previousFocus
      : this.elements.entryButton;
    setTimeout(() => {
      try {
        if (this.windowRef.scrollY !== this.normalScrollY) {
          this.windowRef.scrollTo({ top: this.normalScrollY, behavior: "auto" });
        }
      } catch {
        // Some embedded/test windows do not implement scrollTo.
      }
      restoreTarget.focus({ preventScroll: true });
    }, 0);
  }

  toggle(): void {
    if (this.isActive()) this.exit();
    else this.enter();
  }

  isActive(): boolean {
    return this.mode === "immersive";
  }

  showDock(): void {
    if (!this.isActive()) return;
    this.clearDockTimer();
    this.elements.dock.dataset.visible = "true";
  }

  hideDock(): void {
    if (!this.isActive() || this.dockLocked || this.coarsePointer) return;
    this.clearDockTimer();
    this.elements.dock.dataset.visible = "false";
  }

  setSearchValue(value: string): void {
    if (this.documentRef.activeElement !== this.elements.searchInput) {
      this.elements.searchInput.value = value;
    }
  }

  refreshPagination(): void {
    const { page, totalPages, loading } = this.callbacks.getPagination();
    this.elements.previousButton.disabled = loading || totalPages === 0 || page <= 1;
    this.elements.nextButton.disabled = loading || totalPages === 0 || page >= totalPages;
  }

  destroy(): void {
    this.abortController.abort();
    this.clearDockTimer();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.root.dataset.vaultMode = "normal";
    this.elements.dock.inert = true;
  }

  private bindEvents(): void {
    const signal = this.abortController.signal;
    this.elements.entryButton.addEventListener("click", () => this.toggle(), { signal });
    this.elements.exitButton.addEventListener("click", () => this.exit(), { signal });
    this.elements.randomButton.addEventListener("click", () => {
      this.showDock();
      this.callbacks.onRandom();
    }, { signal });
    this.elements.previousButton.addEventListener("click", () => {
      this.showDock();
      this.callbacks.onPreviousPage();
      this.refreshPagination();
    }, { signal });
    this.elements.nextButton.addEventListener("click", () => {
      this.showDock();
      this.callbacks.onNextPage();
      this.refreshPagination();
    }, { signal });
    this.elements.appearanceButton.addEventListener("click", () => {
      this.dockLocked = true;
      this.showDock();
      this.callbacks.onOpenAppearance();
    }, { signal });
    this.elements.appearanceDialog.addEventListener("close", () => {
      this.dockLocked = false;
      this.scheduleDockHide();
    }, { signal });
    this.elements.searchInput.addEventListener("input", () => {
      this.dockLocked = true;
      this.showDock();
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.searchTimer = null;
        this.callbacks.onSearch(this.elements.searchInput.value);
        this.refreshPagination();
      }, this.searchDelay);
    }, { signal });
    this.elements.searchInput.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = null;
      this.callbacks.onSearch(this.elements.searchInput.value);
      this.refreshPagination();
    }, { signal });
    this.elements.dock.addEventListener("pointerenter", () => {
      this.dockLocked = true;
      this.showDock();
    }, { signal });
    this.elements.dock.addEventListener("pointerleave", () => {
      this.dockLocked = this.elements.dock.contains(this.documentRef.activeElement);
      this.scheduleDockHide();
    }, { signal });
    this.elements.dock.addEventListener("focusin", () => {
      this.dockLocked = true;
      this.showDock();
    }, { signal });
    this.elements.dock.addEventListener("focusout", () => {
      queueMicrotask(() => {
        this.dockLocked = this.elements.dock.contains(this.documentRef.activeElement)
          || this.elements.appearanceDialog.open;
        this.scheduleDockHide();
      });
    }, { signal });
    this.documentRef.addEventListener("pointermove", event => {
      if (!this.isActive() || this.coarsePointer) return;
      if (event.clientY >= this.windowRef.innerHeight - this.triggerDistance) {
        this.showDock();
      } else {
        this.scheduleDockHide();
      }
    }, { passive: true, signal });
    this.documentRef.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !this.isActive()) return;
      const dialog = this.documentRef.querySelector<HTMLDialogElement>("dialog[open]");
      if (dialog) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dialog.close();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.exit();
    }, { signal });
  }

  private scheduleDockHide(): void {
    if (!this.isActive() || this.dockLocked || this.coarsePointer) return;
    this.clearDockTimer();
    this.dockHideTimer = setTimeout(() => {
      this.dockHideTimer = null;
      this.hideDock();
    }, this.hideDelay);
  }

  private clearDockTimer(): void {
    if (this.dockHideTimer) clearTimeout(this.dockHideTimer);
    this.dockHideTimer = null;
  }
}
