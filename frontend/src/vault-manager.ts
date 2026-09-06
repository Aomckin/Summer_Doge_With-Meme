import { ApiError } from "./api";
import { VAULT_PROFILE_NAMES, getVaultProfile } from "./vault-profile";
import type { VaultCreateInput, VaultSummary, VaultUpdateInput } from "./types";

export interface VaultApi {
  list(): Promise<VaultSummary[]>;
  create(input: VaultCreateInput): Promise<VaultSummary>;
  update(id: number, input: VaultUpdateInput): Promise<VaultSummary>;
  delete(id: number, force?: boolean): Promise<void>;
}

export interface VaultManagerActions {
  canManage: boolean;
  onSwitch(vault: VaultSummary): void;
  onVaultsChanged(vaults: VaultSummary[]): void;
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function slugifyVaultName(name: string): string {
  // 从名称生成 slug 建议：保留小写字母/数字，中文等转连字符。
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "";
}

// Profile 决定仓库的 UI 词汇与能力；meme 为默认体验，generic 为兜底。
const PROFILE_OPTIONS: Array<{ value: string; label: string }> = VAULT_PROFILE_NAMES.map(
  name => ({ value: name, label: getVaultProfile(name).label }),
);

export class VaultManagerController {
  private readonly dropdown = document.createElement("div");
  private readonly dialog = document.createElement("dialog");
  private vaults: VaultSummary[] = [];
  private current: VaultSummary | null = null;
  private dropdownOpen = false;
  private editingVault: VaultSummary | null = null;

  constructor(
    private readonly opener: HTMLButtonElement,
    private readonly nameElement: HTMLElement,
    private readonly api: VaultApi,
    private readonly actions: VaultManagerActions,
  ) {
    this.dropdown.className = "vault-dropdown";
    this.dropdown.setAttribute("role", "menu");
    this.dropdown.hidden = true;
    this.dialog.className = "settings-dialog vault-dialog";
    this.dialog.dataset.vaultDialog = "";
    document.body.append(this.dropdown, this.dialog);
    this.opener.addEventListener("click", event => {
      event.stopPropagation();
      if (this.dropdownOpen) {
        this.closeDropdown();
      } else {
        void this.openDropdown();
      }
    });
    this.dropdown.addEventListener("click", event => void this.handleDropdownClick(event));
    this.dialog.addEventListener("click", event => this.handleDialogClick(event));
    this.dialog.addEventListener("submit", event => void this.handleCreate(event));
    document.addEventListener("click", event => {
      if (
        this.dropdownOpen
        && !this.dropdown.contains(event.target as Node)
        && event.target !== this.opener
        && !this.opener.contains(event.target as Node)
      ) {
        this.closeDropdown();
      }
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.dropdownOpen) {
        this.closeDropdown();
      }
    });
  }

  get vaultList(): VaultSummary[] {
    return this.vaults;
  }

  updateSelector(vault: VaultSummary | null): void {
    this.current = vault;
    const icon = vault?.icon || "📦";
    const name = vault?.name ?? "Meme";
    this.nameElement.textContent = name;
    const iconElement = this.opener.querySelector<HTMLElement>(".vault-selector-icon");
    if (iconElement) iconElement.textContent = icon;
  }

  async refresh(): Promise<VaultSummary[]> {
    this.vaults = await this.api.list();
    this.actions.onVaultsChanged(this.vaults);
    return this.vaults;
  }

  private async openDropdown(): Promise<void> {
    this.dropdownOpen = true;
    this.opener.setAttribute("aria-expanded", "true");
    this.dropdown.hidden = false;
    // 先显示再定位，确保 offsetWidth 可用于右缘防溢出计算。
    this.positionDropdown();
    this.renderDropdown(true);
    try {
      await this.refresh();
      if (this.dropdownOpen) this.renderDropdown(false);
    } catch {
      if (this.dropdownOpen) {
        this.dropdown.innerHTML = `<div class="vault-dropdown-error">仓库列表加载失败</div>`;
      }
    }
  }

  private positionDropdown(): void {
    const rect = this.opener.getBoundingClientRect();
    const width = this.dropdown.offsetWidth || 260;
    // 选择器位于顶栏右侧：靠右对齐下拉，避免溢出视口。
    const left = Math.max(
      8,
      Math.min(Math.round(rect.left), window.innerWidth - width - 8),
    );
    this.dropdown.style.left = `${left}px`;
    this.dropdown.style.top = `${Math.round(rect.bottom + 6)}px`;
  }

  private closeDropdown(): void {
    this.dropdownOpen = false;
    this.opener.setAttribute("aria-expanded", "false");
    this.dropdown.hidden = true;
  }

  private renderDropdown(loading: boolean): void {
    const items = this.vaults
      .map(vault => {
        const active = this.current?.id === vault.id;
        const icon = vault.icon || "📦";
        return `
          <button type="button" role="menuitem" class="vault-dropdown-item${active ? " is-active" : ""}" data-vault-id="${vault.id}">
            <span class="vault-dropdown-icon" aria-hidden="true">${icon}</span>
            <span class="vault-dropdown-label">
              <strong>${escapeText(vault.name)}</strong>
              <small>${vault.meme_count} ${escapeText(getVaultProfile(vault.profile).vocabulary.countUnit)}</small>
            </span>
            ${active ? '<span class="vault-dropdown-check" aria-hidden="true">✓</span>' : ""}
          </button>
        `;
      })
      .join("");
    this.dropdown.innerHTML = `
      ${loading && !items ? '<div class="vault-dropdown-loading">加载中…</div>' : items}
      <div class="vault-dropdown-divider" role="separator"></div>
      ${this.actions.canManage
        ? '<button type="button" role="menuitem" class="vault-dropdown-item vault-dropdown-create" data-vault-create><span class="vault-dropdown-icon" aria-hidden="true">＋</span><span class="vault-dropdown-label"><strong>新建仓库</strong><small>独立管理一组图片资产</small></span></button>'
        : ""}
    `;
  }

  private async handleDropdownClick(event: MouseEvent): Promise<void> {
    const target = event.target as HTMLElement;
    const createButton = target.closest<HTMLElement>("[data-vault-create]");
    if (createButton) {
      this.closeDropdown();
      this.openCreateDialog();
      return;
    }
    const item = target.closest<HTMLElement>("[data-vault-id]");
    if (!item) return;
    const vault = this.vaults.find(candidate => candidate.id === Number(item.dataset.vaultId));
    if (!vault) return;
    this.closeDropdown();
    if (vault.id !== this.current?.id) {
      this.actions.onSwitch(vault);
    }
  }

  private openCreateDialog(): void {
    this.editingVault = null;
    if (!this.dialog.open) this.dialog.showModal();
    this.renderCreateDialog();
  }

  private beginEdit(vault: VaultSummary): void {
    this.editingVault = vault;
    if (!this.dialog.open) this.dialog.showModal();
    this.renderCreateDialog();
  }

  private renderCreateDialog(createError: string | null = null, busy = false): void {
    const disabled = busy ? "disabled" : "";
    const editing = this.editingVault;
    const submitLabel = editing ? "保存修改" : "创建仓库";
    const vaultRows = this.vaults.length
      ? this.vaults
          .map(vault => {
            const deletable = vault.slug !== "meme" && this.actions.canManage;
            return `
            <article class="vault-row">
              <div>
                <strong>${vault.icon || "📦"} ${escapeText(vault.name)}${vault.slug === "meme" ? '<span class="vault-row-badge">默认</span>' : ""}</strong>
                <p>${escapeText(vault.slug)} · ${vault.meme_count} 个 Meme</p>
              </div>
              ${this.actions.canManage
                ? `<div class="vault-row-actions">
                    <button class="button button-secondary" type="button" data-vault-edit="${vault.id}" ${disabled}>编辑</button>
                    ${deletable ? `<button class="button button-danger" type="button" data-vault-delete="${vault.id}" data-vault-name="${escapeText(vault.name)}" ${disabled}>删除</button>` : ""}
                  </div>`
                : ""}
            </article>
          `;
          })
          .join("")
      : '<p class="muted">还没有仓库。</p>';
    this.dialog.innerHTML = `
      <div class="settings-shell vault-settings-shell">
        <header class="settings-header">
          <div>
            <p class="eyebrow">VAULT LIBRARY · MULTI-VAULT</p>
            <h2>仓库管理</h2>
            <p>新建独立仓库管理一类图片资产；图片、搜索与向量索引按仓库相互隔离。</p>
          </div>
          <button class="icon-button" type="button" data-close-vault-dialog aria-label="关闭仓库管理">×</button>
        </header>
        <div class="vault-settings-layout">
          <form class="modal-card vault-form" data-vault-form>
            <label>
              <span>名称</span>
              <input name="name" type="text" required maxlength="255" placeholder="例如：二次元收藏" value="${editing ? escapeText(editing.name) : ""}" ${disabled}>
            </label>
            <label>
              <span>Slug（URL 与目录标识，创建后不可修改）</span>
              <input name="slug" type="text" required pattern="[a-z0-9][a-z0-9-]{0,63}" placeholder="例如：anime" value="${editing ? escapeText(editing.slug) : ""}" ${editing || busy ? "disabled" : ""}>
            </label>
            <div class="vault-form-row">
              <label>
                <span>类型（Profile：决定界面文案与可用功能）</span>
                <select name="profile" ${busy ? "disabled" : ""}>
                  ${PROFILE_OPTIONS.map(option => `<option value="${option.value}"${(editing ? editing.profile : "generic") === option.value ? " selected" : ""}>${option.label}</option>`).join("")}
                </select>
              </label>
              <label>
                <span>图标（emoji，可选）</span>
                <input name="icon" type="text" maxlength="50" placeholder="🌸" value="${editing && editing.icon ? escapeText(editing.icon) : ""}" ${disabled}>
              </label>
            </div>
            <div class="vault-form-row">
              <label>
                <span>单图大小上限（MB）</span>
                <input name="max_file_size_mb" type="number" min="1" max="1024" step="1" required value="${editing ? editing.max_file_size_mb ?? 100 : 100}" ${disabled}>
              </label>
              <div class="vault-form-hint">
                超过该大小的单张图片会被拒绝；大图仓库可以调高此值。
              </div>
            </div>
            <label>
              <span>描述（可选）</span>
              <textarea name="description" rows="3" maxlength="2000" ${disabled}>${editing && editing.description ? escapeText(editing.description) : ""}</textarea>
            </label>
            <p class="form-error" role="alert" ${createError ? "" : "hidden"}>${createError ? escapeText(createError) : ""}</p>
            <div class="modal-actions">
              ${editing ? `<button class="button button-ghost" type="button" data-cancel-vault-edit ${disabled}>取消编辑</button>` : ""}
              <button class="button button-ghost" type="button" data-close-vault-dialog ${disabled}>关闭</button>
              <button class="button button-primary" type="submit" ${disabled}>${submitLabel}</button>
            </div>
          </form>
          <div class="vault-list">
            ${vaultRows}
          </div>
        </div>
      </div>
    `;
    const nameInput = this.dialog.querySelector<HTMLInputElement>("input[name='name']");
    const slugInput = this.dialog.querySelector<HTMLInputElement>("input[name='slug']");
    nameInput?.addEventListener("input", () => {
      if (!slugInput) return;
      if (slugInput.dataset.touched === "true") return;
      slugInput.value = slugifyVaultName(nameInput.value);
    });
    slugInput?.addEventListener("input", () => {
      if (!slugInput) return;
      slugInput.dataset.touched = "true";
    });
  }

  private handleDialogClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target === this.dialog) {
      this.dialog.close();
      return;
    }
    if (target.closest("[data-close-vault-dialog]")) {
      this.dialog.close();
      return;
    }
    if (target.closest("[data-cancel-vault-edit]")) {
      this.editingVault = null;
      this.renderCreateDialog();
      return;
    }
    const editButton = target.closest<HTMLButtonElement>("[data-vault-edit]");
    if (editButton) {
      const vault = this.vaults.find(candidate => candidate.id === Number(editButton.dataset.vaultEdit));
      if (vault) this.beginEdit(vault);
      return;
    }
    const deleteButton = target.closest<HTMLButtonElement>("[data-vault-delete]");
    if (deleteButton) {
      void this.deleteVault(Number(deleteButton.dataset.vaultDelete), deleteButton.dataset.vaultName ?? "");
    }
  }

  private async handleCreate(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (!form.matches("[data-vault-form]")) return;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    const icon = String(data.get("icon") ?? "").trim() || null;
    const description = String(data.get("description") ?? "").trim() || null;
    const maxFileRaw = Number(data.get("max_file_size_mb") ?? 100);
    const maxFileSizeMb = Number.isFinite(maxFileRaw) && maxFileRaw >= 1
      ? Math.floor(maxFileRaw)
      : 100;
    this.renderCreateDialog(null, true);
    try {
      if (this.editingVault) {
        const updated = await this.api.update(this.editingVault.id, {
          name,
          icon,
          description,
          max_file_size_mb: maxFileSizeMb,
        });
        await this.refresh();
        this.editingVault = null;
        // 正在编辑当前仓库时，同步顶栏选择器的名称与图标。
        if (this.current?.id === updated.id) this.updateSelector(updated);
        this.renderCreateDialog();
      } else {
        const slug = String(data.get("slug") ?? "").trim();
        if (!slug) {
          this.renderCreateDialog("slug 不能为空");
          return;
        }
        const input: VaultCreateInput = {
          name,
          slug,
          profile: String(data.get("profile") ?? "generic"),
          icon,
          description,
          max_file_size_mb: maxFileSizeMb,
        };
        const created = await this.api.create(input);
        await this.refresh();
        this.updateSelector(created);
        this.dialog.close();
        this.actions.onSwitch(created);
      }
    } catch (error) {
      this.renderCreateDialog(
        message(error, this.editingVault ? "仓库保存失败，请稍后重试。" : "仓库创建失败，请稍后重试。"),
      );
    }
  }

  private async deleteVault(vaultId: number, vaultName: string): Promise<void> {
    const confirmed = window.confirm(`确定删除仓库「${vaultName}」吗？`);
    if (!confirmed) return;
    try {
      await this.api.delete(vaultId, false);
    } catch (error) {
      // 非空仓库需要显式 force；再次确认后连同全部 Meme 一起删除。
      if (error instanceof ApiError && error.status === 409) {
        const forced = window.confirm(
          `仓库「${vaultName}」仍包含 Meme。强制删除会连同这些资产一起移除且不可恢复，确定继续吗？`,
        );
        if (!forced) return;
        try {
          await this.api.delete(vaultId, true);
        } catch (forceError) {
          this.renderCreateDialog(message(forceError, "仓库删除失败。"), false);
          return;
        }
      } else {
        this.renderCreateDialog(message(error, "仓库删除失败。"), false);
        return;
      }
    }
    await this.refresh();
    this.renderCreateDialog();
  }
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
