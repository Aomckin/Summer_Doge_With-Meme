export interface AppShellControllerOptions {
  root: HTMLElement;
  searchInput: HTMLInputElement;
  managementMenu: HTMLDetailsElement;
}

export class AppShellController {
  private readonly abortController = new AbortController();

  constructor(private readonly options: AppShellControllerOptions) {
    this.bindEvents();
  }

  destroy(): void {
    this.abortController.abort();
  }

  private bindEvents(): void {
    const { root, searchInput, managementMenu } = this.options;
    const signal = this.abortController.signal;

    root.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        managementMenu.open = false;
        searchInput.focus();
        searchInput.select();
        return;
      }
      if (event.key === "Escape" && managementMenu.open) {
        event.preventDefault();
        managementMenu.open = false;
        managementMenu.querySelector<HTMLElement>("summary")?.focus();
      }
    }, { signal });

    root.addEventListener("pointerdown", event => {
      const target = event.target;
      if (managementMenu.open && target instanceof Node && !managementMenu.contains(target)) {
        managementMenu.open = false;
      }
    }, { signal });

    managementMenu.addEventListener("click", event => {
      if ((event.target as Element).closest("button")) managementMenu.open = false;
    }, { signal });
  }
}
