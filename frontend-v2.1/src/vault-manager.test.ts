import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { slugifyVaultName, VaultManagerController, type VaultApi } from "./vault-manager";
import type { VaultSummary } from "./types";

const memeVault: VaultSummary = {
  id: 1,
  name: "Meme",
  slug: "meme",
  type: "meme",
  description: null,
  icon: null,
  meme_count: 42,
  max_file_size_mb: 100,
  profile: "meme",
  capabilities: { templates: true, captions: true },
  appearance: {},
  background_image_url: null,
};

const animeVault: VaultSummary = {
  id: 2,
  name: "二次元收藏",
  slug: "anime",
  type: "image",
  description: null,
  icon: "🌸",
  meme_count: 3,
  max_file_size_mb: 100,
  profile: "anime",
  capabilities: { favorite: true, artworkMetadata: true },
  appearance: {},
  background_image_url: null,
};

function makeApi(overrides: Partial<VaultApi> = {}): VaultApi {
  return {
    list: vi.fn().mockResolvedValue([memeVault, animeVault]),
    create: vi.fn().mockResolvedValue(animeVault),
    update: vi.fn().mockResolvedValue(animeVault),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("slugifyVaultName", () => {
  it("derives a URL-safe slug from a name", () => {
    expect(slugifyVaultName("Anime Pics! 02")).toBe("anime-pics-02");
    expect(slugifyVaultName("二次元")).toBe("");
  });
});

describe("VaultManagerController", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app">
        <button id="vault-selector">
          <span class="vault-selector-icon">📦</span>
          <span data-vault-name>Meme</span>
          <span class="vault-selector-caret">▾</span>
        </button>
      </div>
    `;
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function build(overrides: Partial<VaultApi> = {}) {
    const api = makeApi(overrides);
    const onSwitch = vi.fn();
    const onVaultsChanged = vi.fn();
    const opener = document.querySelector<HTMLButtonElement>("#vault-selector")!;
    const nameElement = document.querySelector<HTMLElement>("[data-vault-name]")!;
    const controller = new VaultManagerController(
      opener,
      nameElement,
      api,
      { canManage: true, onSwitch, onVaultsChanged },
    );
    return { api, onSwitch, onVaultsChanged, opener, nameElement, controller };
  }

  it("renders the vault list in the dropdown and switches on click", async () => {
    const { opener, onSwitch } = build();
    opener.click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("[data-vault-id]").length).toBe(2),
    );

    const animeItem = document.querySelector<HTMLElement>('[data-vault-id="2"]')!;
    animeItem.click();

    expect(onSwitch).toHaveBeenCalledWith(animeVault);
  });

  it("marks the active vault and does not re-switch it", async () => {
    const { opener, onSwitch, controller } = build();
    controller.updateSelector(animeVault);
    expect(document.querySelector("[data-vault-name]")?.textContent).toBe("二次元收藏");

    opener.click();
    await vi.waitFor(() =>
      expect(document.querySelector('[data-vault-id="2"].is-active')).not.toBeNull(),
    );
    document.querySelector<HTMLElement>('[data-vault-id="2"]')!.click();

    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("creates a vault, refreshes and switches to it", async () => {
    const { opener, onSwitch, api: createdApi } = build();
    opener.click();
    await vi.waitFor(() => expect(document.querySelector("[data-vault-create]")).not.toBeNull());
    (document.querySelector<HTMLElement>("[data-vault-create]")!).click();

    const form = document.querySelector<HTMLFormElement>("[data-vault-form]")!;
    (form.elements.namedItem("name") as HTMLInputElement).value = "二次元收藏";
    (form.elements.namedItem("slug") as HTMLInputElement).value = "anime";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(createdApi.create).toHaveBeenCalled());
    await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledWith(animeVault));
  });

  it("surfaces creation errors inside the dialog", async () => {
    const { opener } = build({
      create: vi.fn().mockRejectedValue(new ApiError(409, "slug already exists")),
    });
    opener.click();
    await vi.waitFor(() => expect(document.querySelector("[data-vault-create]")).not.toBeNull());
    (document.querySelector<HTMLElement>("[data-vault-create]")!).click();

    const form = document.querySelector<HTMLFormElement>("[data-vault-form]")!;
    (form.elements.namedItem("name") as HTMLInputElement).value = "dup";
    (form.elements.namedItem("slug") as HTMLInputElement).value = "anime";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-vault-dialog] [role='alert']")?.textContent).toContain(
        "slug already exists",
      ),
    );
  });

  it("forces deletion after a non-empty conflict confirmation", async () => {
    const confirmMock = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirmMock);
    const api = makeApi({
      delete: vi.fn()
        .mockRejectedValueOnce(new ApiError(409, "Vault 2 still contains 3 memes; pass force to delete"))
        .mockResolvedValueOnce(undefined),
    });
    const { opener } = buildWithApi(api);

    // 删除入口位于对话框中：下拉 → 新建仓库 → 已有仓库列表。
    opener.click();
    await vi.waitFor(() => expect(document.querySelector("[data-vault-create]")).not.toBeNull());
    (document.querySelector<HTMLElement>("[data-vault-create]")!).click();
    await vi.waitFor(() => expect(document.querySelector("[data-vault-delete='2']")).not.toBeNull());
    (document.querySelector<HTMLElement>("[data-vault-delete='2']")!).click();

    await vi.waitFor(() => expect(api.delete).toHaveBeenNthCalledWith(2, 2, true));
    expect(confirmMock).toHaveBeenCalledTimes(2);
  });

  it("edits a vault: prefills the form, saves via update and syncs the selector", async () => {
    const { opener, nameElement, api, controller } = build({
      update: vi.fn().mockResolvedValue({ ...animeVault, name: "Anime 收藏" }),
    });
    // 把 anime 设为当前仓库：编辑它之后顶栏选择器必须同步新名称。
    controller.updateSelector(animeVault);
    opener.click();
    await vi.waitFor(() => expect(document.querySelector("[data-vault-create]")).not.toBeNull());
    (document.querySelector<HTMLElement>("[data-vault-create]")!).click();
    await vi.waitFor(() => expect(document.querySelector("[data-vault-edit='2']")).not.toBeNull());
    (document.querySelector<HTMLElement>("[data-vault-edit='2']")!).click();

    const form = document.querySelector<HTMLFormElement>("[data-vault-form]")!;
    expect((form.elements.namedItem("name") as HTMLInputElement).value).toBe("二次元收藏");
    expect((form.elements.namedItem("slug") as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector("[data-cancel-vault-edit]")).not.toBeNull();

    (form.elements.namedItem("name") as HTMLInputElement).value = "Anime 收藏";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(2, { name: "Anime 收藏", icon: "🌸", description: null, max_file_size_mb: 100 }),
    );
    await vi.waitFor(() => expect(nameElement.textContent).toBe("Anime 收藏"));
  });

  it("cancelling edit returns the form to create mode", async () => {
    const { opener } = build();
    opener.click();
    await vi.waitFor(() => expect(document.querySelector("[data-vault-create]")).not.toBeNull());
    (document.querySelector<HTMLElement>("[data-vault-create]")!).click();
    await vi.waitFor(() => expect(document.querySelector("[data-vault-edit='2']")).not.toBeNull());
    (document.querySelector<HTMLElement>("[data-vault-edit='2']")!).click();
    expect((document.querySelector<HTMLButtonElement>("[data-vault-form] button[type='submit']")!).textContent).toBe("保存修改");

    (document.querySelector<HTMLElement>("[data-cancel-vault-edit]")!).click();

    expect((document.querySelector<HTMLButtonElement>("[data-vault-form] button[type='submit']")!).textContent).toBe("创建仓库");
    expect((document.querySelector<HTMLInputElement>("[data-vault-form] input[name='slug']")!).disabled).toBe(false);
  });

  function buildWithApi(api: VaultApi) {
    const onSwitch = vi.fn();
    const opener = document.querySelector<HTMLButtonElement>("#vault-selector")!;
    const nameElement = document.querySelector<HTMLElement>("[data-vault-name]")!;
    const controller = new VaultManagerController(
      opener,
      nameElement,
      api,
      { canManage: true, onSwitch, onVaultsChanged: vi.fn() },
    );
    return { opener, controller };
  }
});
