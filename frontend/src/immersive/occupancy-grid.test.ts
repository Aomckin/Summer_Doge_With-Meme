import { afterEach, describe, expect, it } from "vitest";

import {
  FREE_GALLERY_LAYOUT,
  ImmersiveOccupancyGrid,
  OccupancyGridLayout,
  gallerySeededRandom,
  type GalleryLayoutInput,
  type GalleryPlacement,
} from "./occupancy-grid";

const controllers: ImmersiveOccupancyGrid[] = [];

function inputs(count: number): GalleryLayoutInput[] {
  const ratios = [1, 4 / 3, 3 / 4, 16 / 9, 9 / 16, 2.4, 0.38];
  return Array.from({ length: count }, (_, index) => {
    const ratio = ratios[index % ratios.length]!;
    return {
      id: index + 1,
      width: Math.round(1000 * ratio),
      height: 1000,
    };
  });
}

function overlaps(left: GalleryPlacement, right: GalleryPlacement): boolean {
  return left.cellX < right.cellX + right.spanW
    && left.cellX + left.spanW > right.cellX
    && left.cellY < right.cellY + right.spanH
    && left.cellY + left.spanH > right.cellY;
}

function item(input: GalleryLayoutInput): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "immersive-layout-item gallery-layout-item";
  wrapper.dataset.immersiveLayoutId = String(input.id);
  wrapper.innerHTML = `
    <div class="meme-card-physics">
      <article class="meme-card" data-meme-id="${input.id}"
        data-card-width="${input.width}" data-card-height="${input.height}"></article>
    </div>`;
  return wrapper;
}

function fixture(count = 30) {
  const grid = document.createElement("div");
  grid.dataset.cardSize = "medium";
  for (const input of inputs(count)) grid.append(item(input));
  const controller = new ImmersiveOccupancyGrid(grid, { getWidth: () => 1200 });
  controllers.push(controller);
  return { grid, controller };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
});

describe("OccupancyGridLayout", () => {
  it("is deterministic and never uses transient random placement", () => {
    expect(gallerySeededRandom(4496, "gallery-x")).toBe(
      gallerySeededRandom(4496, "gallery-x"),
    );
    const first = new OccupancyGridLayout(1600, "medium");
    const second = new OccupancyGridLayout(1600, "medium");
    const data = inputs(120);
    expect(data.map(input => first.append(input))).toEqual(
      data.map(input => second.append(input)),
    );
    expect(first.reservedBooths).toEqual(second.reservedBooths);
  });

  it("places cards and two-dimensional reserved booths without collisions", () => {
    const layout = new OccupancyGridLayout(1600, "medium");
    for (const input of inputs(220)) layout.append(input);
    for (let left = 0; left < layout.placements.length; left += 1) {
      for (let right = left + 1; right < layout.placements.length; right += 1) {
        expect(overlaps(layout.placements[left]!, layout.placements[right]!)).toBe(false);
      }
    }
    for (const placement of layout.placements) {
      for (const booth of layout.reservedBooths) {
        expect(overlaps(placement, {
          id: -1,
          x: 0,
          y: 0,
          width: 0,
          estimatedHeight: 0,
          cellX: booth.cellX,
          cellY: booth.cellY,
          spanW: booth.spanW,
          spanH: booth.spanH,
        })).toBe(false);
      }
    }
  });

  it("creates all three two-dimensional empty booth tiers", () => {
    const layout = new OccupancyGridLayout(1800, "medium");
    for (const input of inputs(600)) layout.append(input);
    const tiers = new Set(layout.reservedBooths.map(booth => booth.tier));
    expect(tiers).toEqual(new Set(["normal", "large", "accent"]));
    expect(layout.reservedBooths.length).toBeGreaterThan(60);
  });

  it("uses many horizontal positions instead of a small set of fixed columns", () => {
    const layout = new OccupancyGridLayout(1800, "medium");
    for (const input of inputs(160)) layout.append(input);
    const positions = new Set(layout.placements.map(placement => placement.cellX));
    expect(layout.columnCount).toBeGreaterThan(30);
    expect(positions.size).toBeGreaterThan(20);
  });

  it("lets source aspect ratio shape each footprint without changing image ratio", () => {
    const wide = new OccupancyGridLayout(1200, "medium").append({
      id: 1,
      width: 2000,
      height: 500,
    });
    const tall = new OccupancyGridLayout(1200, "medium").append({
      id: 1,
      width: 500,
      height: 2000,
    });
    expect(wide.spanW).toBeGreaterThan(tall.spanW);
    expect(wide.spanH).toBeLessThan(tall.spanH);
  });

  it("reuses the existing card-size multiplier for cells and footprints", () => {
    const small = new OccupancyGridLayout(1600, "small");
    const medium = new OccupancyGridLayout(1600, "medium");
    const large = new OccupancyGridLayout(1600, "large");
    expect(small.cellSize / medium.cellSize).toBeCloseTo(0.75);
    expect(large.cellSize / medium.cellSize).toBeCloseTo(1.5);
    expect(FREE_GALLERY_LAYOUT.cellRatio).toBeGreaterThanOrEqual(0.18);
    expect(FREE_GALLERY_LAYOUT.cellRatio).toBeLessThanOrEqual(0.28);
  });

  it("maps the six tuner controls to distinct layout dimensions", () => {
    const source = inputs(180);
    const dense = new OccupancyGridLayout(1600, "medium", { 
      density: 100,
      whitespaceSize: 1,
      horizontalFreedom: 1,
      topContour: 1,
      edgePadding: 0,
      backgroundParticipation: 1,
    });
    const airy = new OccupancyGridLayout(1600, "medium", {
      density: 30,
      whitespaceSize: 2,
      horizontalFreedom: 1.5,
      topContour: 2,
      edgePadding: 80,
      backgroundParticipation: 2,
    });
    for (const input of source) {
      dense.append(input);
      airy.append(input);
    }
    const averageWidth = (layout: OccupancyGridLayout) => layout.placements
      .reduce((sum, placement) => sum + placement.width, 0) / layout.placements.length;
    expect(averageWidth(dense)).toBeCloseTo(averageWidth(airy));
    expect(airy.reservedBooths.length).toBeGreaterThan(dense.reservedBooths.length);
    expect(airy.height).toBeGreaterThan(dense.height);
    expect(airy.placements[0]!.spanW).toBeGreaterThan(dense.placements[0]!.spanW);
    expect(Math.min(...airy.placements.map(placement => placement.x))).toBeGreaterThanOrEqual(80);
    expect(airy.placements.some(placement => placement.cellY > 0)).toBe(true);
  });

  it("keeps old placements unchanged when new items are appended", () => {
    const layout = new OccupancyGridLayout(1400, "medium");
    const initial = inputs(80);
    for (const input of initial) layout.append(input);
    const snapshot = layout.placements.map(placement => ({ ...placement }));
    for (const input of inputs(40).map((value, index) => ({ ...value, id: index + 1000 }))) {
      layout.append(input);
    }
    expect(layout.placements.slice(0, snapshot.length)).toEqual(snapshot);
  });
});

describe("ImmersiveOccupancyGrid", () => {
  it("positions wrappers while leaving card transforms untouched", async () => {
    const { grid, controller } = fixture();
    const originalCards = [...grid.querySelectorAll<HTMLElement>(".meme-card")];
    controller.activate();
    await Promise.resolve();
    expect(grid.dataset.freeGallery).toBe("active");
    expect(grid.style.getPropertyValue("--gallery-height")).toMatch(/px$/);
    expect(grid.querySelectorAll(".immersive-masonry-column")).toHaveLength(0);
    for (const wrapper of grid.querySelectorAll<HTMLElement>(".gallery-layout-item")) {
      expect(wrapper.style.getPropertyValue("--gallery-x")).toMatch(/px$/);
      expect(wrapper.style.getPropertyValue("--gallery-y")).toMatch(/px$/);
      expect(wrapper.style.getPropertyValue("--gallery-width")).toMatch(/px$/);
      expect(wrapper.style.transform).toBe("");
    }
    expect([...grid.querySelectorAll<HTMLElement>(".meme-card")]).toEqual(originalCards);
  });

  it("appends new cards without moving mounted cards", async () => {
    const { grid, controller } = fixture(20);
    controller.activate();
    await Promise.resolve();
    const existing = [...grid.querySelectorAll<HTMLElement>(".immersive-layout-item")];
    const positions = new Map(existing.map(node => [node, {
      x: node.style.getPropertyValue("--gallery-x"),
      y: node.style.getPropertyValue("--gallery-y"),
    }]));
    const added = item({ id: 999, width: 1000, height: 1000 });
    grid.append(added);
    await Promise.resolve();
    await Promise.resolve();
    expect(added.style.getPropertyValue("--gallery-x")).toMatch(/px$/);
    for (const node of existing) {
      expect(node.style.getPropertyValue("--gallery-x")).toBe(positions.get(node)?.x);
      expect(node.style.getPropertyValue("--gallery-y")).toBe(positions.get(node)?.y);
    }
  });

  it("preserves every placement while a focused card temporarily leaves the grid", async () => {
    const { grid, controller } = fixture(20);
    controller.activate();
    await Promise.resolve();
    const items = [...grid.querySelectorAll<HTMLElement>(".immersive-layout-item")];
    const focused = items[7]!;
    const positions = new Map(items.map(node => [node, {
      x: node.style.getPropertyValue("--gallery-x"),
      y: node.style.getPropertyValue("--gallery-y"),
    }]));
    const layer = document.createElement("div");
    document.body.append(layer);

    controller.beginTemporaryDetach(focused);
    layer.append(focused);
    await Promise.resolve();
    await Promise.resolve();
    grid.append(focused);
    controller.endTemporaryDetach(focused);
    await Promise.resolve();
    await Promise.resolve();

    for (const node of items) {
      expect(node.style.getPropertyValue("--gallery-x")).toBe(positions.get(node)?.x);
      expect(node.style.getPropertyValue("--gallery-y")).toBe(positions.get(node)?.y);
    }
    layer.remove();
  });

  it("restores the ordinary masonry DOM on exit", async () => {
    const { grid, controller } = fixture(12);
    controller.activate();
    await Promise.resolve();
    controller.deactivate();
    expect(grid.dataset.freeGallery).toBeUndefined();
    expect(grid.style.getPropertyValue("--gallery-height")).toBe("");
    for (const wrapper of grid.querySelectorAll<HTMLElement>(".immersive-layout-item")) {
      expect(wrapper.style.getPropertyValue("--gallery-x")).toBe("");
      expect(wrapper.style.getPropertyValue("--gallery-y")).toBe("");
    }
  });
});
