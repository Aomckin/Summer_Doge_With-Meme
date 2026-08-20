export type VaultUIMode = "normal" | "immersive";

export interface ImmersiveElements {
  entryButton: HTMLButtonElement;
  dock: HTMLElement;
  searchInput: HTMLInputElement;
  previousButton: HTMLButtonElement;
  nextButton: HTMLButtonElement;
  randomButton: HTMLButtonElement;
  appearanceButton: HTMLButtonElement;
  exitButton: HTMLButtonElement;
  appearanceDialog: HTMLDialogElement;
}

export interface ImmersiveCallbacks {
  getSearchValue(): string;
  getPagination(): { page: number; totalPages: number; loading: boolean };
  onSearch(value: string): void;
  onPreviousPage(): void;
  onNextPage(): void;
  onRandom(): void;
  onOpenAppearance(): void;
  onLayoutChanged?(): void;
}
