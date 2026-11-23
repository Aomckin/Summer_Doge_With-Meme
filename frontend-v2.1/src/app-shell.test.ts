import { beforeEach, describe, expect, it } from "vitest";
import { AppShellController } from "./app-shell";

function fixture() {
  document.body.innerHTML = `
    <div data-root>
      <input data-search value="miku">
      <button data-outside>Library</button>
      <details data-menu>
        <summary>更多</summary>
        <button data-action>模板管理</button>
      </details>
    </div>
  `;
  const root = document.querySelector<HTMLElement>("[data-root]")!;
  const searchInput = document.querySelector<HTMLInputElement>("[data-search]")!;
  const managementMenu = document.querySelector<HTMLDetailsElement>("[data-menu]")!;
  return {
    root,
    searchInput,
    managementMenu,
    controller: new AppShellController({ root, searchInput, managementMenu }),
  };
}

describe("AppShellController", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("focuses and selects Vault search with Ctrl/Cmd+K", () => {
    const { root, searchInput, managementMenu } = fixture();
    managementMenu.open = true;
    root.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(document.activeElement).toBe(searchInput);
    expect(searchInput.selectionStart).toBe(0);
    expect(searchInput.selectionEnd).toBe(searchInput.value.length);
    expect(managementMenu.open).toBe(false);
  });

  it("closes management actions after selection, Escape, or outside interaction", () => {
    const { root, managementMenu } = fixture();
    managementMenu.open = true;
    document.querySelector<HTMLButtonElement>("[data-action]")!.click();
    expect(managementMenu.open).toBe(false);

    managementMenu.open = true;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(managementMenu.open).toBe(false);
    expect(document.activeElement).toBe(managementMenu.querySelector("summary"));

    managementMenu.open = true;
    document.querySelector<HTMLButtonElement>("[data-outside]")!
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(managementMenu.open).toBe(false);
  });
});
