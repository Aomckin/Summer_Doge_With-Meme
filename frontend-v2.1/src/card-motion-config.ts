import type { MemeCardSize } from "./types";

export interface CardSizeMotionMultiplier {
  translation: number;
  rotation: number;
}

export const CARD_SIZE_MOTION: Readonly<Record<MemeCardSize, CardSizeMotionMultiplier>> = {
  small: { translation: 0.75, rotation: 0.85 },
  medium: { translation: 1, rotation: 1 },
  large: { translation: 1.5, rotation: 1.2 },
  "extra-large": { translation: 2, rotation: 1.35 },
};

export function cardSizeMotionMultiplier(size: string | undefined): CardSizeMotionMultiplier {
  return size === "small" || size === "large" || size === "extra-large"
    ? CARD_SIZE_MOTION[size]
    : CARD_SIZE_MOTION.medium;
}
