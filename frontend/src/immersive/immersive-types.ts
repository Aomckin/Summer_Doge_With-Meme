export type VaultUIMode = "normal" | "immersive";

export interface ImmersiveElements {
  entryButton: HTMLButtonElement;
  dock: HTMLElement;
  searchInput: HTMLInputElement;
  randomButton: HTMLButtonElement;
  appearanceButton: HTMLButtonElement;
  exitButton: HTMLButtonElement;
  appearanceDialog: HTMLDialogElement;
}

export interface ImmersiveCallbacks {
  getSearchValue(): string;
  onSearch(value: string): void;
  onRandom(): void;
  onOpenAppearance(): void;
  onEnter?(): void;
  onExit?(): void;
  onLayoutChanged?(): void;
}
