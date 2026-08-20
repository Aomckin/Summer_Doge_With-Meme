export type ImmersiveMediaState =
  | "thumbnail"
  | "loading-original"
  | "original-ready"
  | "original-error";

export interface ImmersiveMediaLoaderOptions {
  rootMargin?: string;
  loadOriginal?: (url: string) => Promise<void>;
}

function defaultLoadOriginal(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () => resolve();
    probe.onerror = () => reject(new Error(`Unable to load original media: ${url}`));
    probe.src = url;
  });
}

export class ImmersiveMediaLoader {
  private active = false;
  private readonly intersectionObserver: IntersectionObserver | null;
  private readonly mutationObserver: MutationObserver | null;
  private readonly tokens = new WeakMap<HTMLImageElement, number>();
  private readonly loadOriginal: (url: string) => Promise<void>;

  constructor(
    private readonly grid: HTMLElement,
    options: ImmersiveMediaLoaderOptions = {},
  ) {
    this.loadOriginal = options.loadOriginal ?? defaultLoadOriginal;
    this.intersectionObserver = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (entry.isIntersecting && entry.target instanceof HTMLImageElement) {
              void this.upgrade(entry.target);
            }
          }
        }, { rootMargin: options.rootMargin ?? "500px 0px" });
    this.mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
          if (this.active) this.observeImages();
        });
    this.mutationObserver?.observe(this.grid, { childList: true, subtree: true });
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.observeImages();
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.intersectionObserver?.disconnect();
    for (const image of this.images()) {
      this.tokens.set(image, (this.tokens.get(image) ?? 0) + 1);
      const source = this.grid.dataset.cardSize === "extra-large"
        ? image.dataset.originalSrc
        : image.dataset.thumbnailSrc;
      if (source) image.src = source;
      this.setState(image, "thumbnail");
    }
  }

  refresh(): void {
    if (!this.active) return;
    this.observeImages();
    for (const image of this.images()) {
      if (image.dataset.immersiveMediaState === "original-ready") {
        const original = image.dataset.originalSrc;
        if (original && image.getAttribute("src") !== original) image.src = original;
      }
    }
  }

  async ensureOriginal(container: ParentNode): Promise<void> {
    const images = [...container.querySelectorAll<HTMLImageElement>("[data-card-image]")];
    await Promise.all(images.map(image => this.upgrade(image)));
  }

  destroy(): void {
    this.deactivate();
    this.mutationObserver?.disconnect();
  }

  private observeImages(): void {
    for (const image of this.images()) {
      image.dataset.immersiveMediaState ??= "thumbnail";
      if (this.intersectionObserver) this.intersectionObserver.observe(image);
      else void this.upgrade(image);
    }
  }

  private async upgrade(image: HTMLImageElement): Promise<void> {
    const original = image.dataset.originalSrc;
    if (!original) return;
    const state = image.dataset.immersiveMediaState as ImmersiveMediaState | undefined;
    if (state === "loading-original") return;
    if (state === "original-ready") {
      if (image.getAttribute("src") !== original) image.src = original;
      return;
    }

    const token = (this.tokens.get(image) ?? 0) + 1;
    this.tokens.set(image, token);
    this.setState(image, "loading-original");
    try {
      await this.loadOriginal(original);
      if (!this.active || this.tokens.get(image) !== token || !image.isConnected) return;
      image.src = original;
      this.setState(image, "original-ready");
    } catch {
      if (this.tokens.get(image) !== token) return;
      const thumbnail = image.dataset.thumbnailSrc;
      if (thumbnail && image.getAttribute("src") !== thumbnail) image.src = thumbnail;
      this.setState(image, "original-error");
    }
  }

  private images(): HTMLImageElement[] {
    return [...this.grid.querySelectorAll<HTMLImageElement>("[data-card-image]")];
  }

  private setState(image: HTMLImageElement, state: ImmersiveMediaState): void {
    image.dataset.immersiveMediaState = state;
    const card = image.closest<HTMLElement>("[data-meme-id]");
    if (card) card.dataset.immersiveMediaState = state;
  }
}
