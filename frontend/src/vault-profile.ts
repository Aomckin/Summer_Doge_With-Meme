import type { VaultSummary } from "./types";

export type VaultProfileName = "meme" | "anime" | "photo" | "game_score" | "generic";

export type VaultCapabilities = Record<string, boolean>;

/** UI 词汇表：所有面向用户的资产称谓都从这里读取，禁止在组件里写死 "Meme"。 */
export interface VaultVocabulary {
  assetSingular: string;
  assetPlural: string;
  /** 空详情占位：选择一个 {assetSingular} */
  selectPrompt: string;
  libraryTitle: string;
  countUnit: string;
  emptyTitle: string;
  emptyHint: string;
  uploadCta: string;
  relatedTitle: string;
  similarTitle: string;
  rebuildIndexCta: string;
  detailEyebrow: string;
  randomButtonTitle: string;
}

export interface VaultProfile {
  name: VaultProfileName;
  label: string;
  capabilities: VaultCapabilities;
  vocabulary: VaultVocabulary;
}

const MEME_VOCABULARY: VaultVocabulary = {
  assetSingular: "Meme",
  assetPlural: "Meme",
  selectPrompt: "选择一个 Meme",
  libraryTitle: "我的 Meme",
  countUnit: "个 Meme",
  emptyTitle: "Vault 还是空的",
  emptyHint: "上传第一张 Meme，开始建立你的私人收藏。",
  uploadCta: "上传第一张 Meme",
  relatedTitle: "相关 Meme",
  similarTitle: "语义相似 Meme",
  rebuildIndexCta: "为此 Meme 建立索引",
  detailEyebrow: "MEME",
  randomButtonTitle: "随机一个",
};

const ANIME_VOCABULARY: VaultVocabulary = {
  assetSingular: "图片",
  assetPlural: "图片",
  selectPrompt: "选择一张图片",
  libraryTitle: "二次元收藏",
  countUnit: "张图片",
  emptyTitle: "仓库还是空的",
  emptyHint: "上传第一张图片，开始建立你的二次元收藏。",
  uploadCta: "上传第一张图片",
  relatedTitle: "相关图片",
  similarTitle: "相似图片",
  rebuildIndexCta: "为此图片建立索引",
  detailEyebrow: "IMAGE",
  randomButtonTitle: "随机一张",
};

const PHOTO_VOCABULARY: VaultVocabulary = {
  assetSingular: "照片",
  assetPlural: "照片",
  selectPrompt: "选择一张照片",
  libraryTitle: "生活相册",
  countUnit: "张照片",
  emptyTitle: "相册还是空的",
  emptyHint: "上传第一张照片，开始整理你的生活相册。",
  uploadCta: "上传第一张照片",
  relatedTitle: "相关照片",
  similarTitle: "相似照片",
  rebuildIndexCta: "为此照片建立索引",
  detailEyebrow: "PHOTO",
  randomButtonTitle: "随机一张",
};

const GAME_SCORE_VOCABULARY: VaultVocabulary = {
  assetSingular: "成绩图",
  assetPlural: "成绩图",
  selectPrompt: "选择一张成绩图",
  libraryTitle: "游戏成绩",
  countUnit: "张成绩图",
  emptyTitle: "成绩库还是空的",
  emptyHint: "上传第一张成绩图，开始记录你的游戏战绩。",
  uploadCta: "上传第一张成绩图",
  relatedTitle: "相关成绩图",
  similarTitle: "相似成绩图",
  rebuildIndexCta: "为此成绩图建立索引",
  detailEyebrow: "SCORE",
  randomButtonTitle: "随机一张",
};

const GENERIC_VOCABULARY: VaultVocabulary = {
  assetSingular: "图片",
  assetPlural: "图片",
  selectPrompt: "选择一张图片",
  libraryTitle: "图片库",
  countUnit: "张图片",
  emptyTitle: "仓库还是空的",
  emptyHint: "上传第一张图片，开始建立你的收藏。",
  uploadCta: "上传第一张图片",
  relatedTitle: "相关图片",
  similarTitle: "相似图片",
  rebuildIndexCta: "为此图片建立索引",
  detailEyebrow: "IMAGE",
  randomButtonTitle: "随机一张",
};

const PROFILES: Record<VaultProfileName, Omit<VaultProfile, "capabilities">> = {
  meme: { name: "meme", label: "梗图", vocabulary: MEME_VOCABULARY },
  anime: { name: "anime", label: "二次元图片", vocabulary: ANIME_VOCABULARY },
  photo: { name: "photo", label: "生活照片", vocabulary: PHOTO_VOCABULARY },
  game_score: { name: "game_score", label: "游戏成绩图", vocabulary: GAME_SCORE_VOCABULARY },
  generic: { name: "generic", label: "通用图片库", vocabulary: GENERIC_VOCABULARY },
};

export const VAULT_PROFILE_NAMES = Object.keys(PROFILES) as VaultProfileName[];

/** 各 Profile 的默认主题预设；后端 vault_themes.PROFILE_DEFAULT_PRESET 的前端镜像。 */
export const PROFILE_DEFAULT_PRESET_ID: Record<VaultProfileName, string> = {
  meme: "midnight",
  anime: "dreamy",
  photo: "clean",
  game_score: "midnight",
  generic: "default",
};

export function isVaultProfileName(value: string | null | undefined): value is VaultProfileName {
  return value != null && Object.hasOwn(PROFILES, value);
}

export function getVaultProfile(name: string | null | undefined): VaultProfile {
  const key = isVaultProfileName(name) ? name : "generic";
  // capabilities 由后端按 profile 下发；这里仅在前端缺省时兜底为空。
  return { ...PROFILES[key], capabilities: {} };
}

export function profileForVault(vault: VaultSummary | null): VaultProfile {
  if (!vault) return { ...PROFILES.generic, capabilities: {} };
  return {
    ...getVaultProfile(vault.profile),
    capabilities: vault.capabilities ?? {},
  };
}

export function hasCapability(vault: VaultSummary | null, capability: string): boolean {
  return vault?.capabilities?.[capability] === true;
}

export const ANIME_METADATA_FIELDS = {
  work: "作品",
  characters: "角色（逗号分隔）",
  artist: "画师",
  favorite_level: "收藏度（0-5）",
  source_url: "来源 URL",
  rating: "分级",
  orientation: "方向",
} as const;

export type AnimeMetadataField = keyof typeof ANIME_METADATA_FIELDS;

export interface AnimeMetadata {
  work?: string;
  characters?: string[];
  artist?: string;
  favorite_level?: number;
  source_url?: string;
  rating?: string;
  orientation?: "portrait" | "landscape" | "square";
}
