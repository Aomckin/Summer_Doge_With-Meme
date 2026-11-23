import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { MemeVaultApp, type MemeApi } from "./app";
import { capabilitiesFor } from "./auth";
import { getVaultProfile, profileForVault } from "./vault-profile";
import type { MemePageResponse, MemeResponse, VaultSummary } from "./types";

const MEME_CAPS = {
  semanticSearch: true, directRelations: true, aiAnalysis: true,
  randomAsset: true, templates: true, captions: true,
};
const ANIME_CAPS = {
  semanticSearch: true, directRelations: true, aiAnalysis: true,
  randomAsset: true, favorite: true, artworkMetadata: true,
};

function vault(overrides: Partial<VaultSummary>): VaultSummary {
  return {
    id: 1, name: "Meme", slug: "meme", type: "meme", profile: "meme",
    capabilities: MEME_CAPS, description: null, icon: null,
    meme_count: 0, max_file_size_mb: 100,
    appearance: {},
    background_image_url: null,
    ...overrides,
  };
}

const animeVault = vault({
  id: 2, name: "好看的二次元图", slug: "anime", type: "generic", profile: "anime",
  capabilities: ANIME_CAPS,
  appearance: { presetId: "dreamy", accentColor: "#d58cff" },
  background_image_url: "/media/vaults/anime/images/bg.png",
});

const genericVault = vault({
  id: 3, name: "杂图", slug: "stuff", type: "generic", profile: "generic",
  capabilities: {},
});

function meme(id: number, title = `图 ${id}`): MemeResponse {
  return {
    id, title, description: "desc", source: null, original_filename: `${id}.png`,
    stored_filename: `${id}.png`, image_url: `/media/${id}.png`, thumbnail_url: `/thumb/${id}.png`,
    mime_type: "image/png", file_size: 10, width: 800, height: 1200, file_hash: String(id),
    created_at: "2026-01-01", updated_at: "2026-01-01", tags: [], template: null,
    images: [], image_count: 1,
    vault_id: 2,
    vault_asset_no: id,
    profile_metadata: { profile: "anime", data: { orientation: "portrait", work: "Project SEKAI" } },
  };
}

function page(items: MemeResponse[]): MemePageResponse {
  return {
    items, total: items.length, page: 1, page_size: 24,
    total_pages: items.length ? 1 : 0, sort: "default", shuffle_seed: null,
  };
}

function makeApi(_current: VaultSummary, overrides: Partial<MemeApi> = {}): MemeApi {
  const updateVaultAppearance = vi.fn().mockResolvedValue(animeVault);
  const uploadVaultBackground = vi.fn().mockResolvedValue(animeVault);
  const api = {
    updateVaultAppearance,
    updateVaultBackgroundImage: uploadVaultBackground,
    getMeme: vi.fn().mockImplementation(async id => meme(id)),
    listMemePage: vi.fn().mockResolvedValue(page([meme(11)])),
    listMemes: vi.fn().mockResolvedValue([]),
    listTags: vi.fn().mockResolvedValue([]),
    listTemplates: vi.fn().mockResolvedValue([]),
    listTemplatesForUpload: undefined,
    listMemeRelations: vi.fn().mockResolvedValue([]),
    getRandomMeme: vi.fn().mockResolvedValue(meme(99)),
    listSimilarMemes: vi.fn().mockRejectedValue(new ApiError(409, "missing")),
    listVaults: vi.fn().mockResolvedValue([
      vault({
        id: 1, name: "Meme", slug: "meme", profile: "meme", capabilities: MEME_CAPS,
        appearance: { presetId: "midnight", accentColor: "#8ba6ff" },
      }),
      animeVault,
      genericVault,
    ]),
    createVault: vi.fn(),
    updateVault: undefined,
    deleteVault: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MemeApi;
  (api as unknown as { __updateVaultAppearance: unknown }).__updateVaultAppearance = updateVaultAppearance;
  (api as unknown as { __uploadVaultBackground: unknown }).__uploadVaultBackground = uploadVaultBackground;
  return api;
}

describe("vault profile vocabulary", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps each profile to its own vocabulary", () => {
    expect(getVaultProfile("meme").vocabulary.libraryTitle).toBe("我的 Meme");
    expect(getVaultProfile("anime").vocabulary.libraryTitle).toBe("二次元收藏");
    expect(getVaultProfile("anime").vocabulary.assetSingular).toBe("图片");
    expect(getVaultProfile("photo").vocabulary.libraryTitle).toBe("生活相册");
    expect(getVaultProfile("game_score").vocabulary.countUnit).toBe("张成绩图");
    expect(getVaultProfile("unknown").vocabulary.libraryTitle).toBe("图片库");
    expect(profileForVault(null).capabilities).toEqual({});
  });

  it("renders anime vocabulary and never leaks Meme wording", async () => {
    const assetMeme = { ...meme(8169), vault_asset_no: 7 };
    const app = new MemeVaultApp(
      document.querySelector("#app")!,
      makeApi(animeVault, { listMemePage: vi.fn().mockResolvedValue(page([assetMeme])) }),
    );
    await app.start();
    // 切换到 anime 仓（直接调用应用路由，避免跨用例的 window 监听器串扰）
    window.history.pushState(null, "", "/v/anime");
    await (app as unknown as { applyVaultFromLocation(): Promise<void> }).applyVaultFromLocation();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-library-title]")?.textContent).toBe("二次元收藏"),
    );
    await vi.waitFor(() => expect(document.querySelector('[data-meme-id="8169"]')).not.toBeNull());
    document.querySelector<HTMLElement>('[data-meme-id="8169"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("[data-detail-title]")).not.toBeNull());

    // 泄漏断言限定在本仓页面区域；仓库下拉里其他仓库的描述不计入。
    const html = [
      document.querySelector("#library-heading")!.outerHTML,
      document.querySelector("#meme-grid")!.outerHTML,
      document.querySelector("#list-status")!.outerHTML,
      document.querySelector("#detail-panel")!.outerHTML,
      document.querySelector("#profile-filters")!.outerHTML,
    ].join("");
    for (const leaked of [
      "我的 Meme",
      "选择一个 Meme",
      "语义相似 Meme",
      "上传第一张 Meme",
      "相关 Meme",
      "为此 Meme 建立索引",
      "个 Meme",
    ]) {
      expect(html).not.toContain(leaked);
    }
    expect(html).toContain("二次元收藏");
    expect(html).toContain("张图片");
    expect(html).toContain("相似图片");
    expect(html).toContain("为此图片建立索引");
    // Anime 领域区块：作品信息与方向
    expect(html).toContain("作品信息");
    expect(html).toContain("Project SEKAI");
    expect(html).toContain("竖图");
    // 详情序号显示仓库内 vault_asset_no，不再泄漏全局数据库主键
    expect(html).toContain("#7");
    expect(html).not.toContain("#8169");
  });

  it("keeps Meme vocabulary for the meme vault", async () => {
    const app = new MemeVaultApp(document.querySelector("#app")!, makeApi(vault({})));
    await app.start();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-library-title]")?.textContent).toBe("我的 Meme"),
    );
    expect(document.body.innerHTML).toContain("个 Meme");
  });
});

describe("per-vault appearance", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function accentOf(): string {
    return document.documentElement.style.getPropertyValue("--accent").trim();
  }

  it("switching vaults switches the theme with the vault", async () => {
    const app = new MemeVaultApp(document.querySelector("#app")!, makeApi(animeVault));
    await app.start();
    await vi.waitFor(() => expect(accentOf()).toBe("#8ba6ff"));

    window.history.pushState(null, "", "/v/anime");
    await (app as unknown as { applyVaultFromLocation(): Promise<void> }).applyVaultFromLocation();
    await vi.waitFor(() => expect(accentOf()).toBe("#d58cff"));

    const controller = (app as unknown as { appearance: { getBackgroundUrl(): string | null } }).appearance;
    expect(controller.getBackgroundUrl()).toBe("/media/vaults/anime/images/bg.png");

    window.history.pushState(null, "", "/v/meme");
    await (app as unknown as { applyVaultFromLocation(): Promise<void> }).applyVaultFromLocation();
    await vi.waitFor(() => expect(accentOf()).toBe("#8ba6ff"));
    expect(controller.getBackgroundUrl()).toBeNull();
  });

  it("re-uploading a background changes its URL so the preview updates immediately", async () => {
    const api = makeApi(animeVault);
    let uploadCount = 0;
    api.updateVaultBackgroundImage = vi.fn().mockImplementation(async () => {
      uploadCount += 1;
      return { ...animeVault, background_image_url: `/api/vaults/2/background-image?v=bg-${uploadCount}` };
    });
    const app = new MemeVaultApp(document.querySelector("#app")!, api);
    await app.start();
    window.history.pushState(null, "", "/v/anime");
    await (app as unknown as { applyVaultFromLocation(): Promise<void> }).applyVaultFromLocation();
    await vi.waitFor(() => expect(accentOf()).toBe("#d58cff"));

    const applyTheme = (app as unknown as { applyVaultTheme(): void });
    const controller = (app as unknown as { appearance: { getBackgroundUrl(): string | null } }).appearance;
    const state = (app as unknown as { state: { currentVault: VaultSummary } }).state;

    // 第一次上传：state 更新后应用主题 → 新 URL 生效
    state.currentVault = await api.updateVaultBackgroundImage!(2, new File(["a"], "a.png"));
    applyTheme.applyVaultTheme();
    const firstUrl = controller.getBackgroundUrl();
    expect(firstUrl).toBe("/api/vaults/2/background-image?v=bg-1");

    // 替换背景：URL 含版本参数随之变化 → 预览立即更新，无需刷新页面
    state.currentVault = await api.updateVaultBackgroundImage!(2, new File(["b"], "b.png"));
    applyTheme.applyVaultTheme();
    const secondUrl = controller.getBackgroundUrl();
    expect(secondUrl).toBe("/api/vaults/2/background-image?v=bg-2");
    expect(secondUrl).not.toBe(firstUrl);
  });

  it("appearance edits persist to the vault instead of localStorage", async () => {
    const api = makeApi(animeVault);
    const app = new MemeVaultApp(document.querySelector("#app")!, api);
    await app.start();
    window.history.pushState(null, "", "/v/anime");
    await (app as unknown as { applyVaultFromLocation(): Promise<void> }).applyVaultFromLocation();

    const controller = (app as unknown as { appearance: { update(patch: Record<string, number>): unknown } }).appearance;
    controller.update({ backgroundBlur: 24 });

    const persisted = (api as unknown as { __updateVaultAppearance: ReturnType<typeof vi.fn> }).__updateVaultAppearance;
    await vi.waitFor(() => expect(persisted).toHaveBeenCalled());
    const [vaultId, payload] = persisted.mock.calls[0] as [number, Record<string, unknown>];
    expect(vaultId).toBe(animeVault.id);
    expect(payload).toMatchObject({ backgroundBlur: 24 });
  });

  it("exposes the editing vault and uploads background to the vault", async () => {
    const api = makeApi(animeVault);
    const app = new MemeVaultApp(document.querySelector("#app")!, api);
    await app.start();
    window.history.pushState(null, "", "/v/anime");
    await (app as unknown as { applyVaultFromLocation(): Promise<void> }).applyVaultFromLocation();

    document.querySelector<HTMLButtonElement>("#open-appearance")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-appearance-scope]")?.textContent).toContain("好看的二次元图"),
    );
    // vault 模式：上传入口存在，且选择文件后走服务器持久化
    const fileInput = document.querySelector<HTMLInputElement>("#appearance-dialog [data-appearance-file]");
    expect(fileInput).not.toBeNull();
    const upload = (api as unknown as { __uploadVaultBackground: ReturnType<typeof vi.fn> }).__uploadVaultBackground;
    const updated = { ...animeVault, background_image_url: "/api/vaults/2/background-image" };
    upload.mockResolvedValue(updated);
    const file = new File(["png"], "bg.png", { type: "image/png" });
    Object.defineProperty(fileInput!, "files", { value: [file] });
    fileInput!.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(upload).toHaveBeenCalledWith(animeVault.id, file));
    await vi.waitFor(() =>
      expect(
        (app as unknown as { state: { currentVault: VaultSummary } }).state.currentVault.background_image_url,
      ).toBe("/api/vaults/2/background-image"),
    );

    document.documentElement.dataset.authRole = "visitor";
    const app2 = new MemeVaultApp(
      document.querySelector("#app")!,
      makeApi(animeVault),
      capabilitiesFor("visitor"),
    );
    await app2.start();
    await vi.waitFor(() => {
      const disabled = document.querySelectorAll<HTMLInputElement>("#appearance-dialog [data-appearance-range][disabled]").length;
      expect(disabled).toBeGreaterThan(0);
    });
  });
});

describe("vault capability gating", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function startWith(current: VaultSummary): Promise<void> {
    const app = new MemeVaultApp(document.querySelector("#app")!, makeApi(current));
    await app.start();
    window.history.pushState(null, "", `/v/${current.slug}`);
    await (app as unknown as { applyVaultFromLocation(): Promise<void> }).applyVaultFromLocation();
    await vi.waitFor(() =>
      expect(document.querySelector("#vault-selector [data-vault-name]")?.textContent).toBe(current.name),
    );
    // 等待应用状态解析到目标仓库，再强制整体重渲染，断言门控结果。
    await vi.waitFor(() =>
      expect(
        (app as unknown as { state: { currentVault: VaultSummary | null } }).state.currentVault?.slug,
      ).toBe(current.slug),
    );
    (app as unknown as { render(): void }).render();
    await vi.waitFor(() => {
      const hidden = document.querySelector<HTMLButtonElement>("#random-button")!.hidden;
      if (hidden !== (current.capabilities.randomAsset !== true)) {
        throw new Error("capability gating has not been applied yet");
      }
    });
  }

  it("does not render generic-vault-only controls in a generic vault", async () => {
    await startWith(genericVault);
    // generic 无任何专属能力：随机按钮、语义搜索选项、Meme 专属管理入口全部不存在
    expect(document.querySelector<HTMLButtonElement>("#random-button")!.hidden).toBe(true);
    expect(
      document.querySelector<HTMLOptionElement>('#search-mode option[value="semantic"]')!.hidden,
    ).toBe(true);
    for (const id of ["#open-meme-maker", "#open-semantic-index", "#open-vault-inspector", "#open-enrichment", "#open-chat-recommendation", "#open-templates"]) {
      expect(document.querySelector<HTMLButtonElement>(id)!.hidden).toBe(true);
    }
    expect((document.querySelector("#template-filters") as HTMLElement).hidden).toBe(true);
    // 通用能力仍在：标签筛选、标签管理、批量下载
    expect((document.querySelector("#tag-filters") as HTMLElement).hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>("#open-tags")!.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>("#open-download")!.hidden).toBe(false);
  });

  it("does not leak Meme-only capabilities into the anime vault", async () => {
    await startWith(animeVault);
    // anime 没有 templates/captions：Meme 制作器入口与文案实验室不存在
    expect(document.querySelector<HTMLButtonElement>("#open-meme-maker")!.hidden).toBe(true);
    // anime 有的能力仍在：随机、语义、收藏筛选 chips
    expect(document.querySelector<HTMLButtonElement>("#random-button")!.hidden).toBe(false);
    expect(
      document.querySelector<HTMLOptionElement>('#search-mode option[value="semantic"]')!.hidden,
    ).toBe(false);
    expect((document.querySelector("#profile-filters") as HTMLElement).hidden).toBe(false);
    expect(document.body.innerHTML).not.toContain("data-caption-lab-host");
  });

  it("renders the full Meme experience in the meme vault", async () => {
    await startWith(vault({}));
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLButtonElement>("#random-button")!.hidden).toBe(false),
    );
    expect(document.querySelector<HTMLButtonElement>("#open-meme-maker")!.hidden).toBe(false);
    expect((document.querySelector("#template-filters") as HTMLElement).hidden).toBe(false);
  });
});
