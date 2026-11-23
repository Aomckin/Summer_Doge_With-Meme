export type AppearancePresetId =
  | "default"
  | "clean"
  | "glass"
  | "acrylic"
  | "midnight"
  | "dreamy"
  | "immersive";

export interface AppearanceSettings {
  presetId: AppearancePresetId | null;
  accentColor: string;
  backgroundDarkness: number;
  backgroundBlur: number;
  backgroundSaturation: number;
  panelOpacity: number;
  panelBackdropBlur: number;
  panelSaturation: number;
  tintColor: string;
  tintStrength: number;
  grainStrength: number;
  vignetteStrength: number;
  ambientGlowStrength: number;
}

export const APPEARANCE_STORAGE_KEY = "meme-vault:appearance:v1";
export const APPEARANCE_DATABASE_NAME = "meme-vault-appearance";
export const APPEARANCE_ASSET_STORE = "assets";
export const BACKGROUND_IMAGE_KEY = "background-image";
export const MAX_BACKGROUND_IMAGE_BYTES = 25 * 1024 * 1024;

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  presetId: "default",
  accentColor: "#e6ff4a",
  backgroundDarkness: 0,
  backgroundBlur: 0,
  backgroundSaturation: 100,
  panelOpacity: 84,
  panelBackdropBlur: 18,
  panelSaturation: 100,
  tintColor: "#e6ff4a",
  tintStrength: 0,
  grainStrength: 0,
  vignetteStrength: 0,
  ambientGlowStrength: 0,
};

export const APPEARANCE_RANGES = {
  backgroundDarkness: [0, 80],
  backgroundBlur: [0, 30],
  backgroundSaturation: [50, 160],
  panelOpacity: [20, 100],
  panelBackdropBlur: [0, 32],
  panelSaturation: [80, 150],
  tintStrength: [0, 40],
  grainStrength: [0, 8],
  vignetteStrength: [0, 70],
  ambientGlowStrength: [0, 100],
} as const;

export function cloneAppearanceSettings(
  settings: AppearanceSettings,
): AppearanceSettings {
  return { ...settings };
}
