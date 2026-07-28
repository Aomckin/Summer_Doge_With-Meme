import { ApiError } from "./api";
import type {
  AIConnectionTestResponse,
  AIModelCreatePayload,
  AIModelResponse,
  AIModelUpdatePayload,
  AIProviderCreatePayload,
  AIProviderPreset,
  AIProviderResponse,
  AIProviderUpdatePayload,
} from "./types";
import { escapeHtml, type AppElements } from "./ui";

export interface AISettingsApi {
  listAIProviderPresets(): Promise<AIProviderPreset[]>;
  listAIProviders(): Promise<AIProviderResponse[]>;
  createAIProvider(
    payload: AIProviderCreatePayload,
  ): Promise<AIProviderResponse>;
  updateAIProvider(
    id: number,
    payload: AIProviderUpdatePayload,
  ): Promise<AIProviderResponse>;
  deleteAIProvider(id: number): Promise<void>;
  testAIProvider(id: number): Promise<AIConnectionTestResponse>;
  refreshAIModels(id: number): Promise<AIModelResponse[]>;
  listAIModels(): Promise<AIModelResponse[]>;
  createAIModel(payload: AIModelCreatePayload): Promise<AIModelResponse>;
  updateAIModel(
    id: number,
    payload: AIModelUpdatePayload,
  ): Promise<AIModelResponse>;
  deleteAIModel(id: number): Promise<void>;
}

type SettingsTab = "providers" | "models";

interface SettingsState {
  tab: SettingsTab;
  presets: AIProviderPreset[];
  providers: AIProviderResponse[];
  models: AIModelResponse[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
}

function readableError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "网络请求失败，请稍后重试。";
}

function field<T extends HTMLInputElement | HTMLSelectElement>(
  form: HTMLFormElement,
  name: string,
): T {
  const element = form.elements.namedItem(name);
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLSelectElement)
  ) {
    throw new Error(`Missing settings field: ${name}`);
  }
  return element as T;
}

function protocolLabel(protocol: string): string {
  if (protocol === "openai_responses") {
    return "OpenAI Responses";
  }
  if (protocol === "dashscope_multimodal_embedding") {
    return "DashScope 多模态向量";
  }
  return "OpenAI 兼容 Chat";
}

export class AISettingsController {
  private readonly state: SettingsState = {
    tab: "providers",
    presets: [],
    providers: [],
    models: [],
    loading: false,
    busy: false,
    error: null,
    notice: null,
  };

  constructor(
    private readonly elements: AppElements,
    private readonly api: AISettingsApi,
  ) {
    this.bind();
  }

  open(): void {
    if (!this.elements.settingsDialog.open) {
      this.elements.settingsDialog.showModal();
    }
    void this.load();
  }

  private bind(): void {
    for (const button of document.querySelectorAll("[data-close-settings]")) {
      button.addEventListener("click", () => this.close());
    }
    this.elements.settingsDialog.addEventListener("click", (event) => {
      if (event.target === this.elements.settingsDialog) {
        this.close();
      }
    });
    this.elements.settingsContent.addEventListener("click", (event) => {
      const target = event.target as Element;
      const tab = target.closest<HTMLElement>("[data-settings-tab]")?.dataset
        .settingsTab;
      if (tab === "providers" || tab === "models") {
        this.state.tab = tab;
        this.state.error = null;
        this.state.notice = null;
        this.render();
        return;
      }
      if (target.closest("[data-add-provider]")) {
        this.openProviderEditor();
        return;
      }
      if (target.closest("[data-add-model]")) {
        this.openModelEditor();
        return;
      }
      const providerId = Number(
        target.closest<HTMLElement>("[data-provider-id]")?.dataset.providerId,
      );
      if (providerId) {
        if (target.closest("[data-edit-provider]")) {
          this.openProviderEditor(providerId);
        } else if (target.closest("[data-test-provider]")) {
          void this.testProvider(providerId);
        } else if (target.closest("[data-refresh-models]")) {
          void this.refreshModels(providerId);
        } else if (target.closest("[data-delete-provider]")) {
          void this.deleteProvider(providerId);
        }
        return;
      }
      const modelId = Number(
        target.closest<HTMLElement>("[data-model-record-id]")?.dataset
          .modelRecordId,
      );
      if (modelId) {
        if (target.closest("[data-edit-model]")) {
          this.openModelEditor(modelId);
        } else if (target.closest("[data-activate-model]")) {
          void this.activateModel(modelId);
        } else if (target.closest("[data-activate-embedding-model]")) {
          void this.activateEmbeddingModel(modelId);
        } else if (target.closest("[data-delete-model]")) {
          void this.deleteModel(modelId);
        }
      }
    });

    this.elements.providerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitProvider();
    });
    field<HTMLSelectElement>(
      this.elements.providerForm,
      "preset_id",
    ).addEventListener("change", () => this.applySelectedPreset());
    for (const button of document.querySelectorAll("[data-close-provider]")) {
      button.addEventListener("click", () =>
        this.elements.providerDialog.close(),
      );
    }
    this.elements.providerDialog.addEventListener("click", (event) => {
      if (event.target === this.elements.providerDialog) {
        this.elements.providerDialog.close();
      }
    });

    this.elements.modelForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitModel();
    });
    for (const button of document.querySelectorAll("[data-close-model]")) {
      button.addEventListener("click", () =>
        this.elements.modelDialog.close(),
      );
    }
    this.elements.modelDialog.addEventListener("click", (event) => {
      if (event.target === this.elements.modelDialog) {
        this.elements.modelDialog.close();
      }
    });
  }

  private close(): void {
    if (!this.state.busy && this.elements.settingsDialog.open) {
      this.elements.settingsDialog.close();
    }
  }

  private async load(): Promise<void> {
    this.state.loading = true;
    this.state.error = null;
    this.state.notice = null;
    this.render();
    try {
      const [presets, providers, models] = await Promise.all([
        this.api.listAIProviderPresets(),
        this.api.listAIProviders(),
        this.api.listAIModels(),
      ]);
      this.state.presets = presets;
      this.state.providers = providers;
      this.state.models = models;
    } catch (error) {
      this.state.error = readableError(error);
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  private render(): void {
    const tabs = `
      <div class="settings-tabs" role="tablist" aria-label="API 设置">
        <button class="${this.state.tab === "providers" ? "is-active" : ""}" type="button" role="tab" data-settings-tab="providers" aria-selected="${this.state.tab === "providers"}">模型厂商</button>
        <button class="${this.state.tab === "models" ? "is-active" : ""}" type="button" role="tab" data-settings-tab="models" aria-selected="${this.state.tab === "models"}">模型列表</button>
      </div>
    `;
    const feedback = this.state.error
      ? `<div class="settings-feedback is-error" role="alert">${escapeHtml(this.state.error)}</div>`
      : this.state.notice
        ? `<div class="settings-feedback" role="status">${escapeHtml(this.state.notice)}</div>`
        : "";
    const body = this.state.loading
      ? '<div class="settings-loading"><span class="spinner"></span>正在读取 API 设置…</div>'
      : this.state.tab === "providers"
        ? this.providersMarkup()
        : this.modelsMarkup();
    this.elements.settingsContent.innerHTML = `${tabs}${feedback}${body}`;
  }

  private providersMarkup(): string {
    const rows = this.state.providers.length
      ? this.state.providers
          .map((provider) => {
            const modelCount = this.state.models.filter(
              (model) => model.provider_id === provider.id,
            ).length;
            return `
              <article class="settings-row provider-row" data-provider-id="${provider.id}">
                <span class="status-dot${provider.enabled ? " is-on" : ""}" title="${provider.enabled ? "已启用" : "已停用"}"></span>
                <div class="settings-primary">
                  <strong>${escapeHtml(provider.name)}</strong>
                  <span>${escapeHtml(provider.base_url)}</span>
                </div>
                <div class="settings-meta">
                  <span>${escapeHtml(protocolLabel(provider.protocol))}</span>
                  <span>${provider.api_key_hint ? escapeHtml(provider.api_key_hint) : "未配置密钥"}</span>
                  <span>${modelCount} 个模型</span>
                  <span>${provider.timeout_seconds}s · 重试 ${provider.max_retries} 次</span>
                </div>
                <div class="settings-actions">
                  <button class="button button-secondary" type="button" data-test-provider ${this.state.busy ? "disabled" : ""}>测试</button>
                  <button class="button button-secondary" type="button" data-refresh-models ${this.state.busy ? "disabled" : ""}>刷新模型</button>
                  <button class="button button-secondary" type="button" data-edit-provider>编辑</button>
                  <button class="button button-danger" type="button" data-delete-provider>删除</button>
                </div>
              </article>
            `;
          })
          .join("")
      : `
          <div class="settings-empty">
            <h3>还没有模型厂商</h3>
            <p>从 OpenAI、Qwen、DeepSeek 预设开始，或添加自定义 OpenAI 兼容接口。</p>
          </div>
        `;
    return `
      <div class="settings-toolbar">
        <div>
          <h3>模型厂商设置</h3>
          <p>API Key 加密保存在本机，浏览器不会再次读取明文。</p>
        </div>
        <button class="button button-primary" type="button" data-add-provider>＋ 添加厂商</button>
      </div>
      <div class="settings-list">${rows}</div>
    `;
  }

  private modelsMarkup(): string {
    const providers = new Map(
      this.state.providers.map((provider) => [provider.id, provider]),
    );
    const rows = this.state.models.length
      ? this.state.models
          .map((model) => {
            const provider = providers.get(model.provider_id);
            return `
              <article class="settings-row model-row${model.is_active || model.is_embedding_active ? " is-active-model" : ""}" data-model-record-id="${model.id}">
                <span class="model-active-mark" aria-hidden="true">${model.is_active || model.is_embedding_active ? "✓" : ""}</span>
                <div class="settings-primary">
                  <strong>${escapeHtml(model.display_name)}</strong>
                  <span>${escapeHtml(model.model_id)}</span>
                </div>
                <div class="settings-meta">
                  <span>${escapeHtml(provider?.name ?? "厂商已删除")}</span>
                  <span class="capability${model.supports_vision ? " supports" : ""}">${model.supports_vision ? "支持视觉" : "仅文本"}</span>
                  ${model.supports_image_embedding ? '<span class="capability supports">模板视觉检索</span>' : ""}
                  <span>${model.enabled ? "已启用" : "已停用"}</span>
                </div>
                <div class="settings-actions">
                  <button class="button ${model.is_active ? "button-primary" : "button-secondary"}" type="button" data-activate-model ${!model.enabled || !model.supports_vision || !provider?.enabled || this.state.busy ? "disabled" : ""}>${model.is_active ? "当前分析模型" : "用于图片分析"}</button>
                  ${model.supports_image_embedding ? `<button class="button ${model.is_embedding_active ? "button-primary" : "button-secondary"}" type="button" data-activate-embedding-model ${!model.enabled || !provider?.enabled || this.state.busy ? "disabled" : ""}>${model.is_embedding_active ? "当前视觉检索模型" : "用于模板视觉检索"}</button>` : ""}
                  <button class="button button-secondary" type="button" data-edit-model>编辑</button>
                  <button class="button button-danger" type="button" data-delete-model>删除</button>
                </div>
              </article>
            `;
          })
          .join("")
      : `
          <div class="settings-empty">
            <h3>还没有模型</h3>
            <p>添加厂商预设会自动加入常用模型，也可以手动添加或在线刷新。</p>
          </div>
        `;
    return `
      <div class="settings-toolbar">
        <div>
          <h3>模型列表</h3>
          <p>图片分析模型与模板视觉检索模型独立配置；后者用于筛选最多 10 张参考图。</p>
        </div>
        <button class="button button-primary" type="button" data-add-model ${this.state.providers.length ? "" : "disabled"}>＋ 添加模型</button>
      </div>
      <div class="settings-list">${rows}</div>
    `;
  }

  private openProviderEditor(providerId?: number): void {
    const form = this.elements.providerForm;
    form.reset();
    this.showFormError(this.elements.providerError, null);
    const presetSelect = field<HTMLSelectElement>(form, "preset_id");
    presetSelect.innerHTML = [
      '<option value="custom">自定义</option>',
      ...this.state.presets.map(
        (preset) =>
          `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`,
      ),
    ].join("");
    const provider = providerId
      ? this.state.providers.find((item) => item.id === providerId)
      : undefined;
    const title = this.elements.providerDialog.querySelector("h2");
    const clearRow =
      form.querySelector<HTMLElement>("[data-clear-key-row]");
    const hint = form.querySelector<HTMLElement>("[data-key-hint]");
    if (provider) {
      field<HTMLInputElement>(form, "provider_id").value = String(provider.id);
      presetSelect.value = "custom";
      field<HTMLInputElement>(form, "name").value = provider.name;
      field<HTMLInputElement>(form, "base_url").value = provider.base_url;
      field<HTMLSelectElement>(form, "protocol").value = provider.protocol;
      field<HTMLInputElement>(form, "timeout_seconds").value = String(
        provider.timeout_seconds,
      );
      field<HTMLInputElement>(form, "max_retries").value = String(
        provider.max_retries,
      );
      field<HTMLInputElement>(form, "retry_delay_seconds").value = String(
        provider.retry_delay_seconds,
      );
      field<HTMLInputElement>(form, "enabled").checked = provider.enabled;
      if (clearRow) {
        clearRow.hidden = !provider.has_api_key;
      }
      if (hint) {
        hint.textContent = provider.api_key_hint
          ? `当前密钥：${provider.api_key_hint}；留空表示保持不变。`
          : "尚未配置密钥。";
      }
      if (title) {
        title.textContent = "编辑模型厂商";
      }
    } else {
      field<HTMLInputElement>(form, "provider_id").value = "";
      presetSelect.value = this.state.presets[0]?.id ?? "custom";
      this.applySelectedPreset();
      if (clearRow) {
        clearRow.hidden = true;
      }
      if (hint) {
        hint.textContent = "密钥提交后只显示末四位。";
      }
      if (title) {
        title.textContent = "添加模型厂商";
      }
    }
    if (!this.elements.providerDialog.open) {
      this.elements.providerDialog.showModal();
    }
  }

  private applySelectedPreset(): void {
    const form = this.elements.providerForm;
    const presetId = field<HTMLSelectElement>(form, "preset_id").value;
    const preset = this.state.presets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    field<HTMLInputElement>(form, "name").value = preset.name;
    field<HTMLInputElement>(form, "base_url").value = preset.base_url;
    field<HTMLSelectElement>(form, "protocol").value = preset.protocol;
  }

  private async submitProvider(): Promise<void> {
    if (this.state.busy) {
      return;
    }
    const form = this.elements.providerForm;
    const recordId = Number(
      field<HTMLInputElement>(form, "provider_id").value,
    );
    const apiKey = field<HTMLInputElement>(form, "api_key").value.trim();
    const common = {
      name: field<HTMLInputElement>(form, "name").value.trim(),
      base_url: field<HTMLInputElement>(form, "base_url").value.trim(),
      protocol: field<HTMLSelectElement>(form, "protocol")
        .value as AIProviderCreatePayload["protocol"],
      timeout_seconds: Number(
        field<HTMLInputElement>(form, "timeout_seconds").value,
      ),
      max_retries: Number(
        field<HTMLInputElement>(form, "max_retries").value,
      ),
      retry_delay_seconds: Number(
        field<HTMLInputElement>(form, "retry_delay_seconds").value,
      ),
      enabled: field<HTMLInputElement>(form, "enabled").checked,
    };
    this.state.busy = true;
    this.showFormError(this.elements.providerError, null);
    try {
      if (recordId) {
        const payload: AIProviderUpdatePayload = { ...common };
        if (apiKey) {
          payload.api_key = apiKey;
        } else if (
          field<HTMLInputElement>(form, "clear_api_key").checked
        ) {
          payload.api_key = null;
        }
        await this.api.updateAIProvider(recordId, payload);
      } else {
        const presetId = field<HTMLSelectElement>(form, "preset_id").value;
        await this.api.createAIProvider({
          ...common,
          preset_id: presetId === "custom" ? null : presetId,
          ...(apiKey ? { api_key: apiKey } : {}),
        });
      }
      this.elements.providerDialog.close();
      await this.reloadSettings("厂商设置已保存。");
    } catch (error) {
      const message = readableError(error);
      if (this.elements.providerDialog.open) {
        this.showFormError(this.elements.providerError, message);
      } else {
        this.state.error = message;
      }
    } finally {
      this.state.busy = false;
      this.render();
    }
  }

  private openModelEditor(modelId?: number): void {
    const form = this.elements.modelForm;
    form.reset();
    this.showFormError(this.elements.modelError, null);
    const providerSelect = field<HTMLSelectElement>(form, "provider_id");
    providerSelect.innerHTML = this.state.providers
      .map(
        (provider) =>
          `<option value="${provider.id}">${escapeHtml(provider.name)}</option>`,
      )
      .join("");
    const model = modelId
      ? this.state.models.find((item) => item.id === modelId)
      : undefined;
    const title = this.elements.modelDialog.querySelector("h2");
    if (model) {
      field<HTMLInputElement>(form, "model_record_id").value = String(model.id);
      providerSelect.value = String(model.provider_id);
      providerSelect.disabled = true;
      field<HTMLInputElement>(form, "display_name").value = model.display_name;
      field<HTMLInputElement>(form, "model_id").value = model.model_id;
      field<HTMLInputElement>(form, "supports_vision").checked =
        model.supports_vision;
      field<HTMLInputElement>(form, "supports_image_embedding").checked =
        model.supports_image_embedding;
      field<HTMLInputElement>(form, "enabled").checked = model.enabled;
      if (title) {
        title.textContent = "编辑模型";
      }
    } else {
      field<HTMLInputElement>(form, "model_record_id").value = "";
      providerSelect.disabled = false;
      if (title) {
        title.textContent = "添加模型";
      }
    }
    if (!this.elements.modelDialog.open) {
      this.elements.modelDialog.showModal();
    }
  }

  private async submitModel(): Promise<void> {
    if (this.state.busy) {
      return;
    }
    const form = this.elements.modelForm;
    const recordId = Number(
      field<HTMLInputElement>(form, "model_record_id").value,
    );
    const common = {
      model_id: field<HTMLInputElement>(form, "model_id").value.trim(),
      display_name: field<HTMLInputElement>(
        form,
        "display_name",
      ).value.trim(),
      supports_vision: field<HTMLInputElement>(
        form,
        "supports_vision",
      ).checked,
      supports_image_embedding: field<HTMLInputElement>(
        form,
        "supports_image_embedding",
      ).checked,
      enabled: field<HTMLInputElement>(form, "enabled").checked,
    };
    this.state.busy = true;
    this.showFormError(this.elements.modelError, null);
    try {
      if (recordId) {
        await this.api.updateAIModel(recordId, common);
      } else {
        await this.api.createAIModel({
          ...common,
          provider_id: Number(
            field<HTMLSelectElement>(form, "provider_id").value,
          ),
          is_active: false,
          is_embedding_active: false,
        });
      }
      this.elements.modelDialog.close();
      await this.reloadSettings("模型设置已保存。");
    } catch (error) {
      const message = readableError(error);
      if (this.elements.modelDialog.open) {
        this.showFormError(this.elements.modelError, message);
      } else {
        this.state.error = message;
      }
    } finally {
      this.state.busy = false;
      this.render();
    }
  }

  private async testProvider(providerId: number): Promise<void> {
    await this.runOperation(async () => {
      const result = await this.api.testAIProvider(providerId);
      return `连接成功，共发现 ${result.model_count} 个模型。`;
    });
  }

  private async refreshModels(providerId: number): Promise<void> {
    await this.runOperation(async () => {
      this.state.models = await this.api.refreshAIModels(providerId);
      return "模型列表已刷新；新发现的模型默认停用，请检查能力后再启用。";
    });
  }

  private async activateModel(modelId: number): Promise<void> {
    await this.runOperation(async () => {
      await this.api.updateAIModel(modelId, { is_active: true });
      this.state.models = await this.api.listAIModels();
      return "当前图片分析模型已更新。";
    });
  }

  private async activateEmbeddingModel(modelId: number): Promise<void> {
    await this.runOperation(async () => {
      await this.api.updateAIModel(modelId, { is_embedding_active: true });
      this.state.models = await this.api.listAIModels();
      return "当前模板视觉检索模型已更新。";
    });
  }

  private async deleteProvider(providerId: number): Promise<void> {
    const provider = this.state.providers.find(
      (item) => item.id === providerId,
    );
    if (
      !provider ||
      !confirm(`确定删除模型厂商“${provider.name}”及其模型吗？`)
    ) {
      return;
    }
    await this.runOperation(async () => {
      await this.api.deleteAIProvider(providerId);
      await this.reloadData();
      return "模型厂商已删除。";
    });
  }

  private async deleteModel(modelId: number): Promise<void> {
    const model = this.state.models.find((item) => item.id === modelId);
    if (!model || !confirm(`确定删除模型“${model.display_name}”吗？`)) {
      return;
    }
    await this.runOperation(async () => {
      await this.api.deleteAIModel(modelId);
      this.state.models = await this.api.listAIModels();
      return "模型已删除。";
    });
  }

  private async runOperation(
    operation: () => Promise<string>,
  ): Promise<void> {
    if (this.state.busy) {
      return;
    }
    this.state.busy = true;
    this.state.error = null;
    this.state.notice = null;
    this.render();
    try {
      this.state.notice = await operation();
    } catch (error) {
      this.state.error = readableError(error);
    } finally {
      this.state.busy = false;
      this.render();
    }
  }

  private async reloadSettings(notice: string): Promise<void> {
    await this.reloadData();
    this.state.notice = notice;
  }

  private async reloadData(): Promise<void> {
    const [providers, models] = await Promise.all([
      this.api.listAIProviders(),
      this.api.listAIModels(),
    ]);
    this.state.providers = providers;
    this.state.models = models;
  }

  private showFormError(element: HTMLElement, message: string | null): void {
    element.hidden = !message;
    element.textContent = message ?? "";
  }
}
