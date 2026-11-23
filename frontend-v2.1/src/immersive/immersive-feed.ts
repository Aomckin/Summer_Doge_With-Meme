export interface InfiniteFeedPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface InfiniteFeedState {
  offset: number;
  pageSize: number;
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  generation: number;
  total: number;
}

export interface InfiniteFeedControllerOptions<T> {
  sentinel: HTMLElement;
  pageSize: number;
  loadPage(page: number, pageSize: number, signal: AbortSignal): Promise<InfiniteFeedPage<T>>;
  onReset(items: readonly T[]): void;
  onAppend(items: readonly T[]): void;
  onStateChange?(state: Readonly<InfiniteFeedState>): void;
  itemKey?(item: T): string | number;
  rootMargin?: string;
  createObserver?: (callback: IntersectionObserverCallback, options: IntersectionObserverInit) => IntersectionObserver;
  errorMessage?: (error: unknown) => string;
}

export class InfiniteFeedController<T> {
  private active = false;
  private paused = false;
  private nextPage = 1;
  private requestController: AbortController | null = null;
  private observer: IntersectionObserver | null = null;
  private readonly loadedKeys = new Set<string | number>();
  private readonly stateValue: InfiniteFeedState;

  constructor(private readonly options: InfiniteFeedControllerOptions<T>) {
    this.stateValue = {
      offset: 0,
      pageSize: options.pageSize,
      loading: false,
      hasMore: true,
      error: null,
      generation: 0,
      total: 0,
    };
  }

  get state(): Readonly<InfiniteFeedState> {
    return { ...this.stateValue };
  }

  start(initialPage?: InfiniteFeedPage<T>): void {
    if (this.active) return;
    this.active = true;
    this.observeSentinel();
    if (initialPage) {
      this.beginGeneration();
      this.applyInitialPage(initialPage);
      return;
    }
    void this.reset();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.beginGeneration();
    this.observer?.disconnect();
    this.observer = null;
    this.stateValue.loading = false;
    this.emitState();
  }

  async reset(initialPage?: InfiniteFeedPage<T>): Promise<void> {
    this.beginGeneration();
    this.nextPage = 1;
    this.loadedKeys.clear();
    Object.assign(this.stateValue, {
      offset: 0,
      loading: false,
      hasMore: true,
      error: null,
      total: 0,
    });
    this.options.onReset([]);
    if (initialPage) {
      this.applyInitialPage(initialPage);
      return;
    }
    this.emitState();
    await this.loadNext();
  }

  async loadNext(): Promise<void> {
    if (!this.active || this.paused || this.stateValue.loading || !this.stateValue.hasMore) return;
    const requestGeneration = this.stateValue.generation;
    const controller = new AbortController();
    this.requestController = controller;
    this.stateValue.loading = true;
    this.stateValue.error = null;
    this.emitState();

    try {
      const response = await this.options.loadPage(
        this.nextPage,
        this.stateValue.pageSize,
        controller.signal,
      );
      if (!this.isCurrent(requestGeneration, controller)) return;
      const items = this.uniqueItems(response.items);
      if (response.page <= 1 && this.stateValue.offset === 0) this.options.onReset(items);
      else this.options.onAppend(items);
      this.stateValue.offset += items.length;
      this.stateValue.total = response.total;
      this.nextPage = response.page + 1;
      this.stateValue.hasMore = response.page < response.totalPages;
    } catch (error) {
      if (!this.isCurrent(requestGeneration, controller) || isAbortError(error)) return;
      this.stateValue.error = this.options.errorMessage?.(error)
        ?? "加载失败，请稍后重试。";
    } finally {
      if (this.isCurrent(requestGeneration, controller)) {
        this.requestController = null;
        this.stateValue.loading = false;
        this.emitState();
      }
    }
  }

  retry(): Promise<void> {
    return this.loadNext();
  }

  setPageSize(pageSize: number): void {
    if (!Number.isFinite(pageSize) || pageSize < 1) return;
    this.stateValue.pageSize = Math.floor(pageSize);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  destroy(): void {
    this.stop();
    this.requestController?.abort();
    this.requestController = null;
  }

  private beginGeneration(): void {
    this.requestController?.abort();
    this.requestController = null;
    this.stateValue.generation += 1;
  }

  private applyInitialPage(page: InfiniteFeedPage<T>): void {
    this.loadedKeys.clear();
    const items = this.uniqueItems(page.items);
    this.options.onReset(items);
    this.stateValue.offset = items.length;
    this.stateValue.total = page.total;
    this.stateValue.loading = false;
    this.stateValue.error = null;
    this.stateValue.hasMore = page.page < page.totalPages;
    this.nextPage = page.page + 1;
    this.emitState();
  }

  private uniqueItems(items: readonly T[]): T[] {
    if (!this.options.itemKey) return [...items];
    const unique: T[] = [];
    for (const item of items) {
      const key = this.options.itemKey(item);
      if (this.loadedKeys.has(key)) continue;
      this.loadedKeys.add(key);
      unique.push(item);
    }
    return unique;
  }

  private observeSentinel(): void {
    if (this.observer) return;
    const createObserver = this.options.createObserver
      ?? ((callback: IntersectionObserverCallback, options: IntersectionObserverInit) => (
        new IntersectionObserver(callback, options)
      ));
    if (!this.options.createObserver && typeof IntersectionObserver === "undefined") return;
    this.observer = createObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void this.loadNext();
    }, { root: null, rootMargin: this.options.rootMargin ?? "1000px 0px", threshold: 0 });
    this.observer.observe(this.options.sentinel);
  }

  private isCurrent(generation: number, controller: AbortController): boolean {
    return this.active
      && generation === this.stateValue.generation
      && this.requestController === controller;
  }

  private emitState(): void {
    this.options.onStateChange?.(this.state);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
