import { CARD_SIZE_MOTION } from "../card-motion-config";
import type { MemeCardSize } from "../types";

export const FREE_GALLERY_LAYOUT = {
  baseCardWidth: 200,
  cellRatio: 0.22,
  cellGapRatio: 0.2,
  widthJitter: { min: 0.9, max: 1.1 },
  aspectWidthFactor: { min: 0.82, max: 1.24 },
  searchBacktrackRows: 9,
  searchRows: 120,
  candidateCount: 18,
  initialDenseItems: 8,
  emptyBooth: {
    normal: { probability: 0.16, width: [3, 6], height: [2, 5] },
    large: { probability: 0.06, width: [6, 11], height: [5, 9] },
    accent: { probability: 0.02, width: [10, 17], height: [8, 14] },
  },
} as const;

export interface FreeGalleryTuning {
  density: number;
  whitespaceSize: number;
  horizontalFreedom: number;
  topContour: number;
  edgePadding: number;
  backgroundParticipation: number;
}

export const DEFAULT_FREE_GALLERY_TUNING: Readonly<FreeGalleryTuning> = {
  density: 70,
  whitespaceSize: 1,
  horizontalFreedom: 1,
  topContour: 1,
  edgePadding: 0,
  backgroundParticipation: 1,
};

export interface GalleryLayoutInput {
  id: number;
  width: number;
  height: number;
}

export interface GalleryPlacement {
  id: number;
  x: number;
  y: number;
  width: number;
  estimatedHeight: number;
  cellX: number;
  cellY: number;
  spanW: number;
  spanH: number;
}

export type EmptyBoothTier = "normal" | "large" | "accent";

export interface ReservedEmptyBooth {
  tier: EmptyBoothTier;
  cellX: number;
  cellY: number;
  spanW: number;
  spanH: number;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function gallerySeededRandom(seed: number, salt: string): number {
  let value = hashSeed(`${seed}:${salt}`);
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function clamp(minimum: number, value: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(minimum: number, maximum: number, amount: number): number {
  return minimum + (maximum - minimum) * amount;
}

function validCardSize(value: string | undefined): MemeCardSize {
  return value === "small" || value === "large" || value === "extra-large"
    ? value
    : "medium";
}

function validDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export class OccupancyGridLayout {
  readonly cellSize: number;
  readonly columnCount: number;
  readonly placements: GalleryPlacement[] = [];
  readonly reservedBooths: ReservedEmptyBooth[] = [];

  private readonly occupied = new Set<number>();
  private readonly reserved = new Set<number>();
  private frontierRow = 0;

  constructor(
    readonly viewportWidth: number,
    readonly cardSize: MemeCardSize,
    readonly tuning: Readonly<FreeGalleryTuning> = DEFAULT_FREE_GALLERY_TUNING,
  ) {
    const multiplier = CARD_SIZE_MOTION[cardSize].translation;
    this.cellSize = Math.max(24, FREE_GALLERY_LAYOUT.baseCardWidth * multiplier
      * FREE_GALLERY_LAYOUT.cellRatio);
    const usableWidth = Math.max(this.cellSize * 3, viewportWidth - tuning.edgePadding * 2);
    this.columnCount = Math.max(3, Math.floor(usableWidth / this.cellSize));
  }

  append(input: GalleryLayoutInput): GalleryPlacement {
    this.reserveEmptyBooth(input.id);
    const footprint = this.footprint(input);
    const location = this.findPosition(input.id, footprint.spanW, footprint.spanH);
    this.mark(this.occupied, location.x, location.y, footprint.spanW, footprint.spanH);
    this.frontierRow = Math.max(this.frontierRow, location.y + footprint.spanH);
    const placement: GalleryPlacement = {
      id: input.id,
      x: this.tuning.edgePadding + location.x * this.cellSize + footprint.safetyInset,
      y: location.y * this.cellSize + footprint.safetyInset,
      width: footprint.renderWidth,
      estimatedHeight: footprint.estimatedHeight,
      cellX: location.x,
      cellY: location.y,
      spanW: footprint.spanW,
      spanH: footprint.spanH,
    };
    this.placements.push(placement);
    return placement;
  }

  get height(): number {
    return Math.max(this.cellSize, this.frontierRow * this.cellSize);
  }

  private footprint(input: GalleryLayoutInput): {
    spanW: number;
    spanH: number;
    renderWidth: number;
    estimatedHeight: number;
    safetyInset: number;
  } {
    const imageWidth = validDimension(input.width);
    const imageHeight = validDimension(input.height);
    const aspect = imageWidth / imageHeight;
    const multiplier = CARD_SIZE_MOTION[this.cardSize].translation;
    const aspectWidthFactor = clamp(
      FREE_GALLERY_LAYOUT.aspectWidthFactor.min,
      Math.sqrt(aspect),
      FREE_GALLERY_LAYOUT.aspectWidthFactor.max,
    );
    const jitter = lerp(
      FREE_GALLERY_LAYOUT.widthJitter.min,
      FREE_GALLERY_LAYOUT.widthJitter.max,
      gallerySeededRandom(input.id, "footprint-width"),
    );
    const requestedWidth = FREE_GALLERY_LAYOUT.baseCardWidth * multiplier
      * aspectWidthFactor * jitter;
    const renderSpanW = clamp(2, Math.round(requestedWidth / this.cellSize), this.columnCount);
    const renderWidth = renderSpanW * this.cellSize
      - this.cellSize * FREE_GALLERY_LAYOUT.cellGapRatio;
    const estimatedHeight = renderWidth / aspect + 2;
    const renderSpanH = Math.max(2, Math.ceil(
      (estimatedHeight + this.cellSize * FREE_GALLERY_LAYOUT.cellGapRatio) / this.cellSize,
    ));
    const safetyCells = Math.round(lerp(2, 0, this.densityProgress()));
    const spanW = Math.min(this.columnCount, renderSpanW + safetyCells);
    const spanH = renderSpanH + safetyCells;
    const safetyInset = safetyCells * this.cellSize * 0.5;
    return { spanW, spanH, renderWidth, estimatedHeight, safetyInset };
  }

  private reserveEmptyBooth(seed: number): void {
    if (this.placements.length < FREE_GALLERY_LAYOUT.initialDenseItems) return;
    const roll = gallerySeededRandom(seed, "empty-booth-tier");
    const densityVoidMultiplier = lerp(1.8, 0.45, this.densityProgress());
    const participation = clamp(0, this.tuning.backgroundParticipation, 2)
      * densityVoidMultiplier;
    const accent = FREE_GALLERY_LAYOUT.emptyBooth.accent.probability * participation;
    const large = FREE_GALLERY_LAYOUT.emptyBooth.large.probability * participation;
    const normal = FREE_GALLERY_LAYOUT.emptyBooth.normal.probability * participation;
    const tier: EmptyBoothTier | null = roll < accent
      ? "accent"
      : roll < accent + large
        ? "large"
        : roll < accent + large + normal ? "normal" : null;
    if (!tier) return;

    const config = FREE_GALLERY_LAYOUT.emptyBooth[tier];
    const whitespaceScale = clamp(0.35, this.tuning.whitespaceSize, 2.5);
    const spanW = clamp(
      2,
      Math.round(lerp(config.width[0], config.width[1], gallerySeededRandom(seed, "void-width"))
        * whitespaceScale),
      Math.max(2, this.columnCount - 1),
    );
    const spanH = Math.max(1, Math.round(lerp(
      config.height[0],
      config.height[1],
      gallerySeededRandom(seed, "void-height"),
    ) * whitespaceScale));
    const maximumX = Math.max(0, this.columnCount - spanW);
    const preferredX = Math.round(gallerySeededRandom(seed, "void-x") * maximumX);
    const startY = Math.max(1, this.frontierRow - FREE_GALLERY_LAYOUT.searchBacktrackRows);

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const x = maximumX === 0
        ? 0
        : (preferredX + attempt * Math.max(1, Math.floor(this.columnCount * 0.37)))
          % (maximumX + 1);
      const y = startY + Math.floor(attempt / 3) * 2;
      if (!this.isClear(x, y, spanW, spanH)) continue;
      this.mark(this.reserved, x, y, spanW, spanH);
      this.reservedBooths.push({ tier, cellX: x, cellY: y, spanW, spanH });
      this.frontierRow = Math.max(this.frontierRow, y + spanH);
      return;
    }
  }

  private findPosition(seed: number, spanW: number, spanH: number): { x: number; y: number } {
    const maximumX = Math.max(0, this.columnCount - spanW);
    const preferredX = Math.round(gallerySeededRandom(seed, "gallery-x") * maximumX);
    const compactness = this.densityProgress();
    const backtrackRows = Math.round(lerp(3, 14, compactness));
    const departureRows = Math.round(
      lerp(10, 0, compactness) * gallerySeededRandom(seed, "density-departure"),
    );
    const startY = this.placements.length < FREE_GALLERY_LAYOUT.initialDenseItems
      ? Math.round(
          gallerySeededRandom(seed, "top-contour")
          * clamp(0, this.tuning.topContour, 2) * 8,
        )
      : Math.max(0, this.frontierRow - backtrackRows + departureRows);
    const stride = Math.max(1, Math.floor(this.columnCount * 0.382));
    const horizontalFreedom = clamp(0, this.tuning.horizontalFreedom, 1.5);
    const horizontalStep = Math.max(1, Math.ceil(4 - horizontalFreedom * 3));

    for (let rowOffset = 0; rowOffset < FREE_GALLERY_LAYOUT.searchRows; rowOffset += 1) {
      const y = startY + rowOffset;
      const freeRowPreference = maximumX === 0
        ? 0
        : (preferredX + Math.floor(
            gallerySeededRandom(seed, `row-drift:${rowOffset}`) * (maximumX + 1),
          )) % (maximumX + 1);
      const rowPreference = Math.min(
        maximumX,
        Math.round(freeRowPreference / horizontalStep) * horizontalStep,
      );
      const candidateLimit = Math.min(
        Math.max(4, Math.round(FREE_GALLERY_LAYOUT.candidateCount * Math.max(0.3, horizontalFreedom))),
        maximumX + 1,
      );
      for (let candidate = 0; candidate < candidateLimit; candidate += 1) {
        const rawX = maximumX === 0
          ? 0
          : (rowPreference + candidate * stride) % (maximumX + 1);
        const x = Math.min(maximumX, Math.round(rawX / horizontalStep) * horizontalStep);
        if (this.isClear(x, y, spanW, spanH)) return { x, y };
      }
    }

    let y = Math.max(startY, this.frontierRow);
    while (true) {
      for (let x = 0; x <= maximumX; x += 1) {
        if (this.isClear(x, y, spanW, spanH)) return { x, y };
      }
      y += 1;
    }
  }

  private isClear(x: number, y: number, width: number, height: number): boolean {
    if (x < 0 || y < 0 || x + width > this.columnCount) return false;
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        const key = row * this.columnCount + column;
        if (this.occupied.has(key) || this.reserved.has(key)) return false;
      }
    }
    return true;
  }

  private densityProgress(): number {
    return (clamp(30, this.tuning.density, 100) - 30) / 70;
  }

  private mark(target: Set<number>, x: number, y: number, width: number, height: number): void {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        target.add(row * this.columnCount + column);
      }
    }
  }
}

export interface OccupancyGridOptions {
  getWidth?: () => number;
}

export class ImmersiveOccupancyGrid {
  private active = false;
  private cardSize: MemeCardSize = "medium";
  private layout: OccupancyGridLayout | null = null;
  private readonly placementById = new Map<number, GalleryPlacement>();
  private readonly elementById = new Map<number, HTMLElement>();
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private mutating = false;
  private readonly observer: MutationObserver | null;
  private tuning: Readonly<FreeGalleryTuning> = DEFAULT_FREE_GALLERY_TUNING;
  private readonly temporarilyDetachedIds = new Set<number>();
  private pendingRebuild = false;

  constructor(
    private readonly grid: HTMLElement,
    private readonly options: OccupancyGridOptions = {},
  ) {
    this.observer = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
          if (this.active && !this.mutating) this.refresh();
        });
    this.observer?.observe(this.grid, { childList: true, subtree: true });
    window.addEventListener("resize", this.handleResize, { passive: true });
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.grid.dataset.freeGallery = "active";
    this.rebuild();
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    delete this.grid.dataset.freeGallery;
    this.clearLayoutStyles();
    this.layout = null;
    this.placementById.clear();
    this.elementById.clear();
    this.temporarilyDetachedIds.clear();
    this.pendingRebuild = false;
  }

  refresh(): void {
    if (!this.active || this.mutating) return;
    const items = this.items();
    const size = validCardSize(this.grid.dataset.cardSize);
    const currentIds = new Set(items.map(item => this.itemId(item)).filter(Number.isSafeInteger));
    for (const id of this.temporarilyDetachedIds) currentIds.add(id);
    const removedExistingItem = [...this.placementById.keys()].some(id => !currentIds.has(id));
    if (!this.layout || size !== this.cardSize || removedExistingItem) {
      if (this.temporarilyDetachedIds.size) {
        this.pendingRebuild = true;
        return;
      }
      this.rebuild();
      return;
    }

    for (const item of items) {
      const id = this.itemId(item);
      if (!Number.isSafeInteger(id)) continue;
      const placement = this.placementById.get(id);
      if (placement) {
        this.applyPlacement(item, placement);
        this.elementById.set(id, item);
      } else {
        this.appendItem(item, id);
      }
    }
    this.applyGridHeight();
  }

  setTuning(tuning: Readonly<FreeGalleryTuning>): void {
    this.tuning = tuning;
    if (!this.active) return;
    if (this.temporarilyDetachedIds.size) this.pendingRebuild = true;
    else this.rebuild();
  }

  beginTemporaryDetach(item: HTMLElement): void {
    const id = this.itemId(item);
    if (!Number.isSafeInteger(id) || !this.placementById.has(id)) return;
    this.temporarilyDetachedIds.add(id);
  }

  endTemporaryDetach(item: HTMLElement): void {
    const id = this.itemId(item);
    if (!Number.isSafeInteger(id)) return;
    this.temporarilyDetachedIds.delete(id);
    const placement = this.placementById.get(id);
    if (placement) {
      this.applyPlacement(item, placement);
      this.elementById.set(id, item);
    }
    if (this.pendingRebuild && !this.temporarilyDetachedIds.size) {
      this.pendingRebuild = false;
      this.rebuild();
    }
  }

  destroy(): void {
    this.deactivate();
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = null;
    this.observer?.disconnect();
    window.removeEventListener("resize", this.handleResize);
  }

  private rebuild(): void {
    this.withMutationGuard(() => {
      this.clearLayoutStyles();
      this.cardSize = validCardSize(this.grid.dataset.cardSize);
      this.layout = new OccupancyGridLayout(this.width(), this.cardSize, this.tuning);
      this.placementById.clear();
      this.elementById.clear();
      this.items().forEach((item, index) => {
        const id = this.itemId(item);
        if (!Number.isSafeInteger(id)) return;
        item.dataset.galleryOrder = String(index);
        this.appendItem(item, id);
      });
      this.applyGridHeight();
    });
  }

  private appendItem(item: HTMLElement, id: number): void {
    if (!this.layout) return;
    const card = item.querySelector<HTMLElement>("[data-meme-id]");
    const width = Number(card?.dataset.cardWidth);
    const height = Number(card?.dataset.cardHeight);
    const placement = this.layout.append({ id, width, height });
    this.placementById.set(id, placement);
    this.elementById.set(id, item);
    item.dataset.galleryOrder ??= String(this.placementById.size - 1);
    this.applyPlacement(item, placement);
  }

  private applyPlacement(item: HTMLElement, placement: GalleryPlacement): void {
    item.classList.add("gallery-layout-item");
    item.style.setProperty("--gallery-x", `${placement.x.toFixed(2)}px`);
    item.style.setProperty("--gallery-y", `${placement.y.toFixed(2)}px`);
    item.style.setProperty("--gallery-width", `${placement.width.toFixed(2)}px`);
    item.dataset.galleryCell = `${placement.cellX},${placement.cellY}`;
    item.dataset.gallerySpan = `${placement.spanW}x${placement.spanH}`;
  }

  private clearLayoutStyles(): void {
    for (const item of this.items()) {
      item.classList.remove("gallery-layout-item");
      item.style.removeProperty("--gallery-x");
      item.style.removeProperty("--gallery-y");
      item.style.removeProperty("--gallery-width");
      delete item.dataset.galleryCell;
      delete item.dataset.gallerySpan;
    }
    this.grid.style.removeProperty("--gallery-height");
  }

  private applyGridHeight(): void {
    if (!this.layout) return;
    this.grid.style.setProperty("--gallery-height", `${this.layout.height.toFixed(2)}px`);
  }

  private width(): number {
    const width = this.options.getWidth?.() ?? this.grid.clientWidth;
    return Number.isFinite(width) && width > 0 ? width : 1200;
  }

  private items(): HTMLElement[] {
    return [...this.grid.children].filter(
      (element): element is HTMLElement => element instanceof HTMLElement
        && element.classList.contains("immersive-layout-item"),
    ).sort((left, right) => {
      const leftOrder = Number(left.dataset.galleryOrder);
      const rightOrder = Number(right.dataset.galleryOrder);
      return Number.isFinite(leftOrder) && Number.isFinite(rightOrder)
        ? leftOrder - rightOrder
        : 0;
    });
  }

  private itemId(item: HTMLElement): number {
    return Number(item.dataset.immersiveLayoutId);
  }

  private withMutationGuard(operation: () => void): void {
    this.mutating = true;
    operation();
    queueMicrotask(() => {
      this.observer?.takeRecords();
      this.mutating = false;
    });
  }

  private readonly handleResize = (): void => {
    if (!this.active) return;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      if (this.temporarilyDetachedIds.size) this.pendingRebuild = true;
      else this.rebuild();
    }, 100);
  };
}
