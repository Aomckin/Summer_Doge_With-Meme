export interface ImmersiveRandomMeme {
  id: number;
}

export interface ImmersiveRandomNavigatorOptions {
  random?: () => number;
  highlightDuration?: number;
}

export class ImmersiveRandomNavigator {
  private lastMemeId: number | null = null;
  private highlightedCard: HTMLElement | null = null;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly random: () => number;
  private readonly highlightDuration: number;

  constructor(
    private readonly grid: HTMLElement,
    options: ImmersiveRandomNavigatorOptions = {},
  ) {
    this.random = options.random ?? Math.random;
    this.highlightDuration = options.highlightDuration ?? 950;
  }

  visit(memes: readonly ImmersiveRandomMeme[]): number | null {
    const mounted = memes.flatMap(meme => {
      const card = this.grid.querySelector<HTMLElement>(`[data-meme-id="${meme.id}"]`);
      return card ? [{ id: meme.id, card }] : [];
    });
    if (!mounted.length) return null;

    const candidates = mounted.length > 1 && this.lastMemeId !== null
      ? mounted.filter(item => item.id !== this.lastMemeId)
      : mounted;
    const index = Math.min(
      candidates.length - 1,
      Math.floor(Math.max(0, this.random()) * candidates.length),
    );
    const target = candidates[index];
    if (!target) return null;

    this.clearHighlight();
    this.lastMemeId = target.id;
    target.card.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    target.card.classList.add("is-immersive-random-target");
    this.highlightedCard = target.card;
    this.highlightTimer = setTimeout(() => this.clearHighlight(), this.highlightDuration);
    return target.id;
  }

  destroy(): void {
    this.clearHighlight();
    this.lastMemeId = null;
  }

  private clearHighlight(): void {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = null;
    this.highlightedCard?.classList.remove("is-immersive-random-target");
    this.highlightedCard = null;
  }
}
