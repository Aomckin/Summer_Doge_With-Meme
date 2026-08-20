import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InfiniteFeedController,
  type InfiniteFeedPage,
} from "./immersive-feed";

interface Item { id: number }

class TestObserver {
  static latest: TestObserver | null = null;
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(private readonly callback: IntersectionObserverCallback) {
    TestObserver.latest = this;
  }

  intersect(): void {
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function page(items: number[], current: number, totalPages: number): InfiniteFeedPage<Item> {
  return {
    items: items.map(id => ({ id })),
    total: totalPages * 2,
    page: current,
    pageSize: 2,
    totalPages,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("InfiniteFeedController", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div data-sentinel></div>';
    TestObserver.latest = null;
  });

  it("starts from an existing first page and appends when the sentinel enters", async () => {
    const appended: Item[] = [];
    const loadPage = vi.fn().mockResolvedValue(page([3, 4], 2, 2));
    const controller = new InfiniteFeedController<Item>({
      sentinel: document.querySelector("[data-sentinel]")!,
      pageSize: 2,
      loadPage,
      onReset: vi.fn(),
      onAppend: items => appended.push(...items),
      itemKey: item => item.id,
      createObserver: callback => new TestObserver(callback) as unknown as IntersectionObserver,
    });

    controller.start(page([1, 2], 1, 2));
    TestObserver.latest?.intersect();
    await vi.waitFor(() => expect(appended.map(item => item.id)).toEqual([3, 4]));
    expect(loadPage).toHaveBeenCalledWith(2, 2, expect.any(AbortSignal));
    expect(controller.state).toMatchObject({ offset: 4, hasMore: false, loading: false });
    TestObserver.latest?.intersect();
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("guards duplicate loads while a request is pending", async () => {
    const pending = deferred<InfiniteFeedPage<Item>>();
    const loadPage = vi.fn(() => pending.promise);
    const controller = new InfiniteFeedController<Item>({
      sentinel: document.querySelector("[data-sentinel]")!, pageSize: 2, loadPage,
      onReset: vi.fn(), onAppend: vi.fn(),
      createObserver: callback => new TestObserver(callback) as unknown as IntersectionObserver,
    });
    controller.start(page([1, 2], 1, 2));
    TestObserver.latest?.intersect();
    TestObserver.latest?.intersect();
    expect(loadPage).toHaveBeenCalledTimes(1);
    pending.resolve(page([3, 4], 2, 2));
    await vi.waitFor(() => expect(controller.state.loading).toBe(false));
  });

  it("aborts reset requests and ignores stale generation responses", async () => {
    const first = deferred<InfiniteFeedPage<Item>>();
    const second = deferred<InfiniteFeedPage<Item>>();
    const loadPage = vi.fn()
      .mockImplementationOnce((_page, _size, signal: AbortSignal) => {
        expect(signal.aborted).toBe(false);
        return first.promise;
      })
      .mockImplementationOnce(() => second.promise);
    const resetItems: number[][] = [];
    const controller = new InfiniteFeedController<Item>({
      sentinel: document.querySelector("[data-sentinel]")!, pageSize: 2, loadPage,
      onReset: items => resetItems.push(items.map(item => item.id)), onAppend: vi.fn(),
      createObserver: callback => new TestObserver(callback) as unknown as IntersectionObserver,
    });

    controller.start();
    const firstSignal = loadPage.mock.calls[0]![2] as AbortSignal;
    const reset = controller.reset();
    expect(firstSignal.aborted).toBe(true);
    second.resolve(page([20, 21], 1, 1));
    await reset;
    first.resolve(page([10, 11], 1, 1));
    await Promise.resolve();
    expect(resetItems.at(-1)).toEqual([20, 21]);
    expect(resetItems.flat()).not.toContain(10);
  });

  it("keeps loaded items after failure and retries the same page", async () => {
    const onReset = vi.fn();
    const onAppend = vi.fn();
    const loadPage = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([3, 4], 2, 2));
    const controller = new InfiniteFeedController<Item>({
      sentinel: document.querySelector("[data-sentinel]")!, pageSize: 2, loadPage,
      onReset, onAppend, errorMessage: () => "网络断开",
      createObserver: callback => new TestObserver(callback) as unknown as IntersectionObserver,
    });
    controller.start(page([1, 2], 1, 2));
    await controller.loadNext();
    expect(controller.state).toMatchObject({ offset: 2, error: "网络断开" });
    expect(onReset).toHaveBeenCalledTimes(1);
    await controller.retry();
    expect(loadPage.mock.calls.map(call => call[0])).toEqual([2, 2]);
    expect(onAppend).toHaveBeenCalledWith([{ id: 3 }, { id: 4 }]);
  });
});
