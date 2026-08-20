import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImmersiveController } from "./immersive-controller";
import type { ImmersiveCallbacks, ImmersiveElements } from "./immersive-types";

const controllers: ImmersiveController[] = [];

function fixture() {
  document.body.innerHTML = `
    <button id="entry">沉浸浏览</button>
    <nav id="dock" data-visible="false">
      <input id="search">
      <button id="previous">上一页</button>
      <button id="next">下一页</button>
      <button id="random">随机</button>
      <button id="appearance">外观</button>
      <button id="exit">退出</button>
    </nav>
    <dialog id="appearance-dialog"></dialog>`;
  const elements: ImmersiveElements = {
    entryButton: document.querySelector<HTMLButtonElement>("#entry")!,
    dock: document.querySelector<HTMLElement>("#dock")!,
    searchInput: document.querySelector<HTMLInputElement>("#search")!,
    previousButton: document.querySelector<HTMLButtonElement>("#previous")!,
    nextButton: document.querySelector<HTMLButtonElement>("#next")!,
    randomButton: document.querySelector<HTMLButtonElement>("#random")!,
    appearanceButton: document.querySelector<HTMLButtonElement>("#appearance")!,
    exitButton: document.querySelector<HTMLButtonElement>("#exit")!,
    appearanceDialog: document.querySelector<HTMLDialogElement>("#appearance-dialog")!,
  };
  const callbacks: ImmersiveCallbacks = {
    getSearchValue: vi.fn(() => "Miku"),
    getPagination: vi.fn(() => ({ page: 2, totalPages: 4, loading: false })),
    onSearch: vi.fn(),
    onPreviousPage: vi.fn(),
    onNextPage: vi.fn(),
    onRandom: vi.fn(),
    onOpenAppearance: vi.fn(() => elements.appearanceDialog.showModal()),
    onLayoutChanged: vi.fn(),
  };
  const controller = new ImmersiveController(elements, callbacks, {
    coarsePointer: false,
    hideDelay: 900,
    triggerDistance: 120,
    searchDelay: 300,
  });
  controllers.push(controller);
  return { controller, elements, callbacks };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.dataset.vaultMode = "";
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ImmersiveController mode", () => {
  it("switches repeatedly without rebuilding content or invoking business callbacks", async () => {
    const { controller, elements, callbacks } = fixture();
    expect(document.documentElement.dataset.vaultMode).toBe("normal");
    elements.entryButton.click();
    expect(controller.isActive()).toBe(true);
    expect(document.documentElement.dataset.vaultMode).toBe("immersive");
    expect(elements.dock.inert).toBe(false);
    expect(elements.searchInput.value).toBe("Miku");

    controller.enter();
    elements.exitButton.click();
    await vi.runAllTimersAsync();
    expect(controller.isActive()).toBe(false);
    expect(document.documentElement.dataset.vaultMode).toBe("normal");
    expect(elements.dock.inert).toBe(true);
    expect(callbacks.onSearch).not.toHaveBeenCalled();
    expect(callbacks.onRandom).not.toHaveBeenCalled();
    expect(callbacks.onLayoutChanged).toHaveBeenCalledTimes(2);
  });

  it("restores the normal scroll position and focus on exit", async () => {
    const { controller, elements } = fixture();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 420 });
    elements.entryButton.focus();
    controller.enter();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 900 });
    controller.exit();
    await vi.runAllTimersAsync();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 420, behavior: "auto" });
    expect(document.activeElement).toBe(elements.entryButton);
  });
});

describe("ImmersiveController dock", () => {
  it("shows near the bottom, hides after delay, and stays while hovered", async () => {
    const { controller, elements } = fixture();
    controller.enter();
    controller.hideDock();
    expect(elements.dock.dataset.visible).toBe("false");

    document.dispatchEvent(new MouseEvent("pointermove", { clientY: window.innerHeight - 20 }));
    expect(elements.dock.dataset.visible).toBe("true");
    elements.dock.dispatchEvent(new Event("pointerenter"));
    document.dispatchEvent(new MouseEvent("pointermove", { clientY: 10 }));
    await vi.advanceTimersByTimeAsync(1200);
    expect(elements.dock.dataset.visible).toBe("true");

    elements.dock.dispatchEvent(new Event("pointerleave"));
    await vi.advanceTimersByTimeAsync(900);
    expect(elements.dock.dataset.visible).toBe("false");
  });

  it("keeps the dock during search and shares the entered query through callbacks", async () => {
    const { controller, elements, callbacks } = fixture();
    controller.enter();
    elements.searchInput.focus();
    elements.searchInput.value = "动漫";
    elements.searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointermove", { clientY: 10 }));
    await vi.advanceTimersByTimeAsync(300);
    expect(callbacks.onSearch).toHaveBeenCalledWith("动漫");
    expect(elements.dock.dataset.visible).toBe("true");
  });

  it("routes random and Appearance through existing app callbacks", () => {
    const { controller, elements, callbacks } = fixture();
    controller.enter();
    elements.randomButton.click();
    elements.appearanceButton.click();
    expect(callbacks.onRandom).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenAppearance).toHaveBeenCalledTimes(1);
    expect(elements.appearanceDialog.open).toBe(true);
  });

  it("provides minimal previous and next paging with boundary states", () => {
    const { controller, elements, callbacks } = fixture();
    controller.enter();
    expect(elements.previousButton.disabled).toBe(false);
    expect(elements.nextButton.disabled).toBe(false);
    elements.previousButton.click();
    elements.nextButton.click();
    expect(callbacks.onPreviousPage).toHaveBeenCalledTimes(1);
    expect(callbacks.onNextPage).toHaveBeenCalledTimes(1);

    vi.mocked(callbacks.getPagination).mockReturnValue({ page: 1, totalPages: 1, loading: false });
    controller.refreshPagination();
    expect(elements.previousButton.disabled).toBe(true);
    expect(elements.nextButton.disabled).toBe(true);
  });

  it("keeps a discoverable low-opacity dock on coarse pointers", async () => {
    const setup = fixture();
    setup.controller.destroy();
    const controller = new ImmersiveController(setup.elements, setup.callbacks, {
      coarsePointer: true,
      hideDelay: 10,
    });
    controllers.push(controller);
    controller.enter();
    controller.hideDock();
    await vi.advanceTimersByTimeAsync(20);
    expect(setup.elements.dock.dataset.visible).toBe("true");
    expect(setup.elements.dock.inert).toBe(false);
  });
});

describe("ImmersiveController keyboard", () => {
  it("closes an open dialog on the first Escape and exits on the second", async () => {
    const { controller, elements } = fixture();
    controller.enter();
    elements.appearanceDialog.showModal();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(elements.appearanceDialog.open).toBe(false);
    expect(controller.isActive()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(controller.isActive()).toBe(false);
    await vi.runAllTimersAsync();
  });
});
