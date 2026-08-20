import type { ImmersiveMediaLoader } from "./immersive-media";

export interface ImmersiveFocusViewerOptions {
  documentRef?: Document;
  windowRef?: Window;
  duration?: number;
  onBeforeDetach?: (item: HTMLElement) => void;
  onAfterRestore?: (item: HTMLElement) => void;
}

interface FocusMediaOrigin {
  frame: HTMLElement;
  parent: HTMLElement;
  nextSibling: ChildNode | null;
  stack: HTMLElement;
}

interface FocusOrigin {
  parent: HTMLElement;
  nextSibling: ChildNode | null;
  rect: DOMRect;
  previousOverflow: string;
  media: FocusMediaOrigin | null;
}

export class ImmersiveFocusViewer {
  private focusedItem: HTMLElement | null = null;
  private layer: HTMLElement | null = null;
  private origin: FocusOrigin | null = null;
  private closing: Promise<void> | null = null;
  private readonly documentRef: Document;
  private readonly windowRef: Window;
  private readonly root: HTMLElement;
  private readonly duration: number;
  private readonly onBeforeDetach?: (item: HTMLElement) => void;
  private readonly onAfterRestore?: (item: HTMLElement) => void;
  private readonly abortController = new AbortController();

  constructor(
    private readonly grid: HTMLElement,
    private readonly media: ImmersiveMediaLoader,
    options: ImmersiveFocusViewerOptions = {},
  ) {
    this.documentRef = options.documentRef ?? document;
    this.windowRef = options.windowRef ?? window;
    this.root = this.documentRef.documentElement;
    const reducedMotion = typeof this.windowRef.matchMedia === "function"
      && this.windowRef.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.duration = reducedMotion ? 0 : options.duration ?? 280;
    this.onBeforeDetach = options.onBeforeDetach;
    this.onAfterRestore = options.onAfterRestore;
    this.bindEvents();
  }

  isOpen(): boolean {
    return this.focusedItem !== null;
  }

  async open(item: HTMLElement): Promise<void> {
    if (this.root.dataset.vaultMode !== "immersive") return;
    if (this.focusedItem === item) {
      await this.close();
      return;
    }
    if (this.focusedItem) await this.close(true);

    const card = item.querySelector<HTMLElement>("[data-meme-id]");
    if (!card || !(item.parentElement instanceof HTMLElement)) return;
    const rect = item.getBoundingClientRect();
    const parent = item.parentElement;
    this.onBeforeDetach?.(item);
    const mediaOrigin = this.prepareFocusMedia(card);
    this.origin = {
      parent,
      nextSibling: item.nextSibling,
      rect,
      previousOverflow: this.root.style.overflow,
      media: mediaOrigin,
    };
    this.focusedItem = item;
    this.layer = this.documentRef.createElement("div");
    this.layer.className = "immersive-focus-layer";
    this.layer.setAttribute("role", "presentation");
    this.documentRef.body.append(this.layer);
    this.layer.append(item);
    item.classList.add("is-immersive-focused");
    card.classList.remove("is-card-lifted", "is-card-tracking", "is-card-returning");
    item.tabIndex = -1;
    this.root.dataset.immersiveFocus = "open";
    this.root.style.overflow = "hidden";

    const target = this.targetRect(card, mediaOrigin !== null);
    this.applyRect(item, target);
    item.focus({ preventScroll: true });
    void this.media.ensureOriginal(item);
    await this.animateRect(item, rect, target);
  }

  close(immediate = false): Promise<void> {
    if (this.closing) return this.closing;
    const item = this.focusedItem;
    const origin = this.origin;
    if (!item || !origin) return Promise.resolve();
    this.closing = this.finishClose(item, origin, immediate);
    return this.closing;
  }

  deactivate(): void {
    void this.close(true);
  }

  destroy(): void {
    this.abortController.abort();
    this.deactivate();
  }

  private async finishClose(
    item: HTMLElement,
    origin: FocusOrigin,
    immediate: boolean,
  ): Promise<void> {
    const current = item.getBoundingClientRect();
    if (!immediate) await this.animateRect(item, current, origin.rect);
    this.restoreItem(item, origin);
    this.closing = null;
  }

  private restoreItem(item: HTMLElement, origin: FocusOrigin): void {
    if (origin.media) {
      const { frame, parent, nextSibling, stack } = origin.media;
      if (nextSibling?.parentNode === parent) parent.insertBefore(frame, nextSibling);
      else parent.append(frame);
      stack.remove();
    }
    if (origin.nextSibling?.parentNode === origin.parent) {
      origin.parent.insertBefore(item, origin.nextSibling);
    } else {
      origin.parent.append(item);
    }
    item.classList.remove("is-immersive-focused");
    item.removeAttribute("tabindex");
    item.style.removeProperty("position");
    item.style.removeProperty("top");
    item.style.removeProperty("left");
    item.style.removeProperty("width");
    item.style.removeProperty("z-index");
    this.layer?.remove();
    this.layer = null;
    this.focusedItem = null;
    this.origin = null;
    delete this.root.dataset.immersiveFocus;
    this.root.style.overflow = origin.previousOverflow;
    this.onAfterRestore?.(item);
  }

  private targetRect(card: HTMLElement, multipleImages: boolean): DOMRect {
    const sourceWidth = Math.max(1, Number(card.dataset.cardWidth) || card.clientWidth || 1);
    const sourceHeight = Math.max(1, Number(card.dataset.cardHeight) || card.clientHeight || 1);
    const maximumWidth = this.windowRef.innerWidth * 0.88;
    const maximumHeight = this.windowRef.innerHeight * 0.88;
    const scale = Math.min(maximumWidth / sourceWidth, maximumHeight / sourceHeight);
    const width = multipleImages
      ? Math.min(maximumWidth, Math.max(sourceWidth * scale, Math.min(720, maximumWidth)))
      : sourceWidth * scale;
    const height = multipleImages ? maximumHeight : sourceHeight * scale;
    return new DOMRect(
      (this.windowRef.innerWidth - width) / 2,
      (this.windowRef.innerHeight - height) / 2,
      width,
      height,
    );
  }

  private prepareFocusMedia(card: HTMLElement): FocusMediaOrigin | null {
    const template = card.querySelector<HTMLTemplateElement>("template[data-focus-media-manifest]");
    const descriptors = template
      ? [...template.content.querySelectorAll<HTMLElement>("[data-focus-media]")]
      : [];
    if (descriptors.length <= 1) return null;

    const frame = card.querySelector<HTMLElement>(".meme-card-main > .card-image");
    if (!frame || !(frame.parentElement instanceof HTMLElement)) return null;
    const parent = frame.parentElement;
    const stack = this.documentRef.createElement("span");
    stack.className = "immersive-focus-media-stack";
    parent.insertBefore(stack, frame);
    stack.append(frame);

    for (const descriptor of descriptors.slice(1)) {
      const extraFrame = this.documentRef.createElement("span");
      extraFrame.className = "card-image immersive-focus-extra-media";
      const image = this.documentRef.createElement("img");
      image.dataset.cardImage = "";
      image.dataset.thumbnailSrc = descriptor.dataset.thumbnailSrc ?? "";
      image.dataset.originalSrc = descriptor.dataset.originalSrc ?? "";
      image.src = image.dataset.thumbnailSrc || image.dataset.originalSrc;
      image.alt = descriptor.dataset.alt ?? "";
      image.loading = "eager";
      const width = Number(descriptor.dataset.width);
      const height = Number(descriptor.dataset.height);
      if (Number.isFinite(width) && width > 0) image.width = width;
      if (Number.isFinite(height) && height > 0) image.height = height;
      const fallback = this.documentRef.createElement("span");
      fallback.className = "image-fallback";
      fallback.setAttribute("aria-hidden", "true");
      fallback.textContent = "图片不可用";
      image.addEventListener("error", () => {
        image.hidden = true;
        extraFrame.classList.add("is-broken");
      });
      extraFrame.append(image, fallback);
      stack.append(extraFrame);
    }

    return { frame, parent, nextSibling: stack.nextSibling, stack };
  }

  private applyRect(item: HTMLElement, rect: DOMRect): void {
    item.style.position = "fixed";
    item.style.left = `${rect.left}px`;
    item.style.top = `${rect.top}px`;
    item.style.width = `${rect.width}px`;
    item.style.zIndex = "1";
  }

  private async animateRect(item: HTMLElement, from: DOMRect, to: DOMRect): Promise<void> {
    if (this.duration === 0 || typeof item.animate !== "function") return;
    const animation = item.animate([
      { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px` },
      { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px` },
    ], {
      duration: this.duration,
      easing: "cubic-bezier(.2,.78,.22,1)",
      fill: "both",
    });
    try {
      await animation.finished;
    } catch {
      // A newer focus transition superseded this one.
    } finally {
      animation.cancel();
    }
  }

  private bindEvents(): void {
    const signal = this.abortController.signal;
    this.grid.addEventListener("click", event => {
      if (this.root.dataset.vaultMode !== "immersive") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-copy-meme], [data-quick-download]")) return;
      const item = target.closest<HTMLElement>(".gallery-layout-item");
      if (!item) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void this.open(item);
    }, { capture: true, signal });
    this.documentRef.addEventListener("click", event => {
      if (!this.layer || !this.focusedItem) return;
      const target = event.target;
      if (!(target instanceof Node) || !this.layer.contains(target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void this.close();
    }, { capture: true, signal });
    this.documentRef.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !this.focusedItem) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void this.close();
    }, { capture: true, signal });
  }
}
