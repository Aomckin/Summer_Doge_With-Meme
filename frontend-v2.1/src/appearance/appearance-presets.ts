import type { AppearancePresetId, AppearanceSettings } from "./appearance-types";
import { DEFAULT_APPEARANCE_SETTINGS } from "./appearance-types";

export interface AppearancePreset {
  id: AppearancePresetId;
  name: string;
  description: string;
  settings: AppearanceSettings;
}

function preset(
  id: AppearancePresetId,
  name: string,
  description: string,
  overrides: Partial<AppearanceSettings>,
): AppearancePreset {
  return {
    id,
    name,
    description,
    settings: { ...DEFAULT_APPEARANCE_SETTINGS, ...overrides, presetId: id },
  };
}

export const APPEARANCE_PRESETS: readonly AppearancePreset[] = [
  preset("default", "默认", "Meme Vault 原始暗色质感", {}),
  preset("clean", "清爽", "更实、更清晰的内容面板", {
    accentColor: "#7fcb45",
    tintColor: "#477a2c",
    backgroundDarkness: 26,
    panelOpacity: 96,
    panelBackdropBlur: 6,
    panelSaturation: 100,
    vignetteStrength: 8,
    ambientGlowStrength: 5,
  }),
  preset("glass", "玻璃", "通透面板与柔和背景虚化", {
    accentColor: "#74c7ff",
    tintColor: "#3f9fd4",
    backgroundDarkness: 22,
    backgroundBlur: 8,
    backgroundSaturation: 112,
    panelOpacity: 58,
    panelBackdropBlur: 24,
    panelSaturation: 125,
    tintStrength: 5,
    grainStrength: 1.2,
    vignetteStrength: 24,
    ambientGlowStrength: 25,
  }),
  preset("acrylic", "亚克力", "更浓的磨砂与细颗粒", {
    accentColor: "#d49a68",
    tintColor: "#74685e",
    backgroundDarkness: 32,
    backgroundBlur: 13,
    backgroundSaturation: 105,
    panelOpacity: 72,
    panelBackdropBlur: 30,
    panelSaturation: 118,
    tintStrength: 8,
    grainStrength: 3.5,
    vignetteStrength: 28,
    ambientGlowStrength: 18,
  }),
  preset("midnight", "午夜", "低饱和、深压暗的专注模式", {
    accentColor: "#8ba6ff",
    tintColor: "#233968",
    backgroundDarkness: 56,
    backgroundBlur: 4,
    backgroundSaturation: 66,
    panelOpacity: 91,
    panelBackdropBlur: 16,
    panelSaturation: 90,
    tintStrength: 13,
    grainStrength: 1,
    vignetteStrength: 48,
    ambientGlowStrength: 10,
  }),
  preset("dreamy", "梦境", "更鲜明的色彩、柔光与虚化", {
    accentColor: "#d58cff",
    tintColor: "#8448c7",
    backgroundDarkness: 18,
    backgroundBlur: 17,
    backgroundSaturation: 145,
    panelOpacity: 52,
    panelBackdropBlur: 27,
    panelSaturation: 138,
    tintStrength: 15,
    grainStrength: 1.5,
    vignetteStrength: 30,
    ambientGlowStrength: 58,
  }),
  preset("immersive", "沉浸", "让自定义背景成为视觉主体", {
    accentColor: "#c7cbc7",
    tintColor: "#858b88",
    backgroundDarkness: 10,
    backgroundBlur: 2,
    backgroundSaturation: 125,
    panelOpacity: 42,
    panelBackdropBlur: 22,
    panelSaturation: 132,
    tintStrength: 4,
    grainStrength: 1,
    vignetteStrength: 38,
    ambientGlowStrength: 32,
  }),
];

export function findAppearancePreset(
  id: AppearancePresetId,
): AppearancePreset | undefined {
  return APPEARANCE_PRESETS.find(item => item.id === id);
}
