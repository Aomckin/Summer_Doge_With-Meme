import type { AppState, MemeResponse } from "./types";

export interface EditDraft {
  title: string;
  description: string;
  source: string;
  tags: string;
  templateId: string;
}

export interface AppElements {
  searchInput: HTMLInputElement;
  randomButton: HTMLButtonElement;
  openUploadButton: HTMLButtonElement;
  openSettingsButton: HTMLButtonElement;
  openTemplatesButton: HTMLButtonElement;
  operationError: HTMLElement;
  tagFilters: HTMLElement;
  listStatus: HTMLElement;
  memeGrid: HTMLElement;
  loadMoreButton: HTMLButtonElement;
  detailPanel: HTMLElement;
  uploadDialog: HTMLDialogElement;
  uploadForm: HTMLFormElement;
  uploadFile: HTMLInputElement;
  uploadError: HTMLElement;
  uploadSubmit: HTMLButtonElement;
  uploadTemplateSelect: HTMLSelectElement;
  templateDialog: HTMLDialogElement;
  templateForm: HTMLFormElement;
  templateList: HTMLElement;
  templateError: HTMLElement;
  templateSubmit: HTMLButtonElement;
  settingsDialog: HTMLDialogElement;
  settingsContent: HTMLElement;
  providerDialog: HTMLDialogElement;
  providerForm: HTMLFormElement;
  providerError: HTMLElement;
  modelDialog: HTMLDialogElement;
  modelForm: HTMLFormElement;
  modelError: HTMLElement;
  imageViewerDialog: HTMLDialogElement;
  imageViewerFrame: HTMLElement;
  imageViewerImage: HTMLImageElement;
  imageViewerTitle: HTMLElement;
  imageViewerLink: HTMLAnchorElement;
  imageViewerError: HTMLElement;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing UI element: ${selector}`);
  }
  return element;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function tagMarkup(names: string[]): string {
  if (!names.length) {
    return '<span class="muted">无标签</span>';
  }
  return names
    .map((name) => `<span class="tag">${escapeHtml(name)}</span>`)
    .join("");
}

export function mountShell(root: HTMLElement): AppElements {
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">MV</span>
          <div>
            <strong>Meme Vault</strong>
            <span>个人 Meme 创作台</span>
          </div>
        </div>
        <div class="toolbar">
          <label class="search-box" for="meme-search">
            <span aria-hidden="true">⌕</span>
            <input id="meme-search" type="search" placeholder="搜索标题或描述…" aria-label="搜索 Meme" autocomplete="off">
          </label>
          <button id="open-settings" class="button button-secondary" type="button">API 设置</button>
          <button id="open-templates" class="button button-secondary" type="button">模板管理</button>
          <button id="random-button" class="button button-secondary" type="button">随机一个</button>
          <button id="open-upload" class="button button-primary" type="button">上传 Meme</button>
        </div>
      </header>

      <div id="operation-error" class="operation-error" role="alert" aria-live="assertive" hidden></div>

      <main class="workspace">
        <section class="library" aria-label="Meme 资料库">
          <div class="section-heading">
            <div>
              <p class="eyebrow">LIBRARY</p>
              <h1>我的 Meme</h1>
            </div>
          </div>
          <div id="tag-filters" class="tag-filters" aria-label="标签筛选"></div>
          <div id="list-status" class="list-status" aria-live="polite"></div>
          <div id="meme-grid" class="meme-grid"></div>
          <button id="load-more" class="button button-secondary load-more" type="button" hidden>加载更多</button>
        </section>

        <aside id="detail-panel" class="detail-panel" aria-label="Meme 详情"></aside>
      </main>
    </div>

    <dialog id="upload-dialog" class="modal" aria-labelledby="upload-dialog-title">
      <form id="upload-form" class="modal-card">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">NEW MEME</p>
            <h2 id="upload-dialog-title">上传 Meme</h2>
          </div>
          <button class="icon-button" type="button" data-close-upload aria-label="关闭">×</button>
        </div>
        <label>
          <span>图片</span>
          <input id="upload-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required>
        </label>
        <label>
          <span>标题</span>
          <input name="title" type="text" maxlength="255" required>
        </label>
        <label>
          <span>描述</span>
          <textarea name="description" rows="3"></textarea>
        </label>
        <label>
          <span>来源</span>
          <input name="source" type="text" maxlength="500">
        </label>
        <label>
          <span>标签</span>
          <input name="tags" type="text" placeholder="funny, reaction">
          <small>使用英文逗号分隔</small>
        </label>
        <label>
          <span>模板</span>
          <select id="upload-template" name="template_id">
            <option value="">无模板</option>
          </select>
        </label>
        <p id="upload-error" class="form-error" role="alert" hidden></p>
        <div class="modal-actions">
          <button class="button button-ghost" type="button" data-close-upload>取消</button>
          <button id="upload-submit" class="button button-primary" type="submit">开始上传</button>
        </div>
      </form>
    </dialog>

    <dialog id="template-dialog" class="settings-dialog" aria-labelledby="template-dialog-title">
      <div class="settings-shell template-settings-shell">
        <header class="settings-header">
          <div>
            <p class="eyebrow">TEMPLATE LIBRARY · VISUAL MATCHING</p>
            <h2 id="template-dialog-title">模板管理</h2>
            <p>可选上传一张参考原图；有图模板按视觉相似度匹配，无图模板保留描述分类。</p>
          </div>
          <button class="icon-button" type="button" data-close-templates aria-label="关闭模板管理">×</button>
        </header>
        <div class="template-settings-layout">
          <form id="template-form" class="modal-card template-form">
            <input name="template_id" type="hidden">
            <label>
              <span>名称</span>
              <input name="name" type="text" maxlength="100" required>
            </label>
            <label><span>参考原图（可选）</span><input name="reference_image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
            <label>
              <span>描述</span>
              <textarea name="description" rows="4"></textarea>
            </label>
            <p id="template-error" class="form-error" role="alert" hidden></p>
            <div class="modal-actions">
              <button class="button button-ghost" type="button" data-cancel-template-edit hidden>取消编辑</button>
              <button id="template-submit" class="button button-primary" type="submit">创建模板</button>
            </div>
          </form>
          <div id="template-list" class="template-list"></div>
        </div>
      </div>
    </dialog>

    <dialog id="api-settings-dialog" class="settings-dialog" aria-labelledby="settings-title">
      <div class="settings-shell">
        <header class="settings-header">
          <div>
            <p class="eyebrow">AI CONFIGURATION · v0.3.3</p>
            <h2 id="settings-title">API 设置</h2>
            <p>管理模型厂商、连接凭据与图片分析模型。</p>
          </div>
          <button class="icon-button" type="button" data-close-settings aria-label="关闭 API 设置">×</button>
        </header>
        <div id="settings-content" class="settings-content"></div>
      </div>
    </dialog>

    <dialog id="provider-dialog" class="modal settings-editor" aria-labelledby="provider-dialog-title">
      <form id="provider-form" class="modal-card">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">MODEL PROVIDER</p>
            <h2 id="provider-dialog-title">添加模型厂商</h2>
          </div>
          <button class="icon-button" type="button" data-close-provider aria-label="关闭">×</button>
        </div>
        <input name="provider_id" type="hidden">
        <label>
          <span>厂商模板</span>
          <select name="preset_id"></select>
          <small>模板会填写基础 URL、协议与常用模型。</small>
        </label>
        <label>
          <span>名称</span>
          <input name="name" type="text" maxlength="100" required>
        </label>
        <label>
          <span>基础 URL</span>
          <input name="base_url" type="url" maxlength="500" required>
        </label>
        <label>
          <span>API 协议</span>
          <select name="protocol" required>
            <option value="openai_responses">OpenAI Responses</option>
            <option value="openai_chat_completions">OpenAI 兼容 Chat Completions</option>
          </select>
        </label>
        <label>
          <span>API Key</span>
          <input name="api_key" type="password" maxlength="1000" autocomplete="new-password" placeholder="编辑时留空表示保持不变">
          <small data-key-hint>密钥提交后只显示末四位。</small>
        </label>
        <label class="check-row" data-clear-key-row hidden>
          <input name="clear_api_key" type="checkbox">
          <span>清除已保存的 API Key</span>
        </label>
        <div class="settings-field-grid">
          <label>
            <span>超时（秒）</span>
            <input name="timeout_seconds" type="number" min="1" max="600" step="1" value="30" required>
          </label>
          <label>
            <span>最大重试</span>
            <input name="max_retries" type="number" min="0" max="5" step="1" value="1" required>
          </label>
          <label>
            <span>重试间隔（秒）</span>
            <input name="retry_delay_seconds" type="number" min="0" max="60" step="0.5" value="1" required>
          </label>
        </div>
        <label class="check-row">
          <input name="enabled" type="checkbox" checked>
          <span>启用该厂商</span>
        </label>
        <p id="provider-error" class="form-error" role="alert" hidden></p>
        <div class="modal-actions">
          <button class="button button-ghost" type="button" data-close-provider>取消</button>
          <button class="button button-primary" type="submit" data-provider-submit>保存厂商</button>
        </div>
      </form>
    </dialog>

    <dialog id="model-dialog" class="modal settings-editor" aria-labelledby="model-dialog-title">
      <form id="model-form" class="modal-card">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">MODEL REGISTRY</p>
            <h2 id="model-dialog-title">添加模型</h2>
          </div>
          <button class="icon-button" type="button" data-close-model aria-label="关闭">×</button>
        </div>
        <input name="model_record_id" type="hidden">
        <label>
          <span>模型厂商</span>
          <select name="provider_id" required></select>
        </label>
        <label>
          <span>模型名称</span>
          <input name="display_name" type="text" maxlength="200" required>
        </label>
        <label>
          <span>模型标识符</span>
          <input name="model_id" type="text" maxlength="200" required>
        </label>
        <label class="check-row">
          <input name="supports_vision" type="checkbox">
          <span>支持图片输入</span>
        </label>
        <label class="check-row">
          <input name="enabled" type="checkbox" checked>
          <span>启用该模型</span>
        </label>
        <p id="model-error" class="form-error" role="alert" hidden></p>
        <div class="modal-actions">
          <button class="button button-ghost" type="button" data-close-model>取消</button>
          <button class="button button-primary" type="submit" data-model-submit>保存模型</button>
        </div>
      </form>
    </dialog>

    <dialog
      id="image-viewer-dialog"
      class="image-viewer"
      aria-labelledby="image-viewer-title"
    >
      <div class="image-viewer-content">
        <header class="image-viewer-header">
          <h2 id="image-viewer-title" data-viewer-title></h2>
          <div class="image-viewer-actions">
            <a
              class="button button-secondary"
              data-viewer-link
              target="_blank"
              rel="noopener noreferrer"
            >打开原图</a>
            <button
              class="icon-button"
              type="button"
              data-close-viewer
              aria-label="关闭原图查看器"
            >×</button>
          </div>
        </header>
        <div class="image-viewer-frame" data-viewer-frame>
          <img data-viewer-image alt="" hidden>
          <p data-viewer-error role="alert" hidden>原图加载失败</p>
        </div>
      </div>
    </dialog>
  `;

  return {
    searchInput: required(root, "#meme-search"),
    randomButton: required(root, "#random-button"),
    openUploadButton: required(root, "#open-upload"),
    openSettingsButton: required(root, "#open-settings"),
    openTemplatesButton: required(root, "#open-templates"),
    operationError: required(root, "#operation-error"),
    tagFilters: required(root, "#tag-filters"),
    listStatus: required(root, "#list-status"),
    memeGrid: required(root, "#meme-grid"),
    loadMoreButton: required(root, "#load-more"),
    detailPanel: required(root, "#detail-panel"),
    uploadDialog: required(document, "#upload-dialog"),
    uploadForm: required(document, "#upload-form"),
    uploadFile: required(document, "#upload-file"),
    uploadError: required(document, "#upload-error"),
    uploadSubmit: required(document, "#upload-submit"),
    uploadTemplateSelect: required(document, "#upload-template"),
    templateDialog: required(document, "#template-dialog"),
    templateForm: required(document, "#template-form"),
    templateList: required(document, "#template-list"),
    templateError: required(document, "#template-error"),
    templateSubmit: required(document, "#template-submit"),
    settingsDialog: required(document, "#api-settings-dialog"),
    settingsContent: required(document, "#settings-content"),
    providerDialog: required(document, "#provider-dialog"),
    providerForm: required(document, "#provider-form"),
    providerError: required(document, "#provider-error"),
    modelDialog: required(document, "#model-dialog"),
    modelForm: required(document, "#model-form"),
    modelError: required(document, "#model-error"),
    imageViewerDialog: required(document, "#image-viewer-dialog"),
    imageViewerFrame: required(document, "[data-viewer-frame]"),
    imageViewerImage: required(document, "[data-viewer-image]"),
    imageViewerTitle: required(document, "[data-viewer-title]"),
    imageViewerLink: required(document, "[data-viewer-link]"),
    imageViewerError: required(document, "[data-viewer-error]"),
  };
}

export function renderToolbar(
  elements: AppElements,
  state: AppState,
): void {
  elements.randomButton.disabled = state.randomizing;
  elements.randomButton.textContent = state.randomizing
    ? "正在抽取…"
    : "随机一个";
  elements.openUploadButton.disabled = state.uploading;
}

function templateOptions(
  state: AppState,
  selectedId: string,
): string {
  return [
    '<option value="">无模板</option>',
    ...state.availableTemplates.map(
      (template) =>
        `<option value="${template.id}"${selectedId === String(template.id) ? " selected" : ""}>${escapeHtml(template.name)}</option>`,
    ),
  ].join("");
}

export function renderUploadTemplates(
  elements: AppElements,
  state: AppState,
): void {
  const selected = elements.uploadTemplateSelect.value;
  elements.uploadTemplateSelect.innerHTML = templateOptions(state, selected);
}

export function renderTemplateManager(
  elements: AppElements,
  state: AppState,
  editingId: number | null,
  busy: boolean,
  error: string | null,
): void {
  const editing = state.availableTemplates.find(
    (template) => template.id === editingId,
  );
  const idField = elements.templateForm.elements.namedItem("template_id");
  const nameField = elements.templateForm.elements.namedItem("name");
  const descriptionField =
    elements.templateForm.elements.namedItem("description");
  if (
    idField instanceof HTMLInputElement &&
    nameField instanceof HTMLInputElement &&
    descriptionField instanceof HTMLTextAreaElement
  ) {
    idField.value = editing ? String(editing.id) : "";
    nameField.value = editing?.name ?? "";
    descriptionField.value = editing?.description ?? "";
  }
  const cancel = elements.templateForm.querySelector<HTMLButtonElement>(
    "[data-cancel-template-edit]",
  );
  if (cancel) {
    cancel.hidden = !editing;
    cancel.disabled = busy;
  }
  elements.templateSubmit.disabled = busy;
  elements.templateSubmit.textContent = busy
    ? "正在保存…"
    : editing
      ? "保存修改"
      : "创建模板";
  elements.templateError.hidden = !error;
  elements.templateError.textContent = error ?? "";
  elements.templateList.innerHTML = state.availableTemplates.length
    ? state.availableTemplates
        .map(
          (template) => `
            <article class="template-row">
              <div>
                <strong>${escapeHtml(template.name)}</strong>
                <p>${escapeHtml(template.description || "暂无描述")}</p>
                ${template.reference_thumbnail_url ? `<img class="template-reference-preview" src="${escapeHtml(template.reference_thumbnail_url)}" alt="${escapeHtml(template.name)} 参考图">` : '<p class="muted">描述分类模板（无参考图）</p>'}
              </div>
              <div class="template-row-actions">
                <button class="button button-secondary" type="button" data-edit-template="${template.id}" ${busy ? "disabled" : ""}>编辑</button>
                <button class="button button-danger" type="button" data-delete-template="${template.id}" ${busy ? "disabled" : ""}>删除</button>
              </div>
            </article>
          `,
        )
        .join("")
    : '<p class="muted">还没有模板，可以先创建一个。</p>';
}

export function renderOperationError(
  elements: AppElements,
  state: AppState,
): void {
  elements.operationError.hidden = !state.operationError;
  elements.operationError.textContent = state.operationError ?? "";
  elements.operationError.toggleAttribute(
    "data-operation-error",
    Boolean(state.operationError),
  );
}

const COLLAPSED_TAG_LIMIT = 8;

export function renderTags(elements: AppElements, state: AppState): void {
  if (!state.availableTags.length) {
    elements.tagFilters.innerHTML =
      '<span class="muted">还没有可筛选的标签</span>';
    return;
  }
  const collapsed = state.availableTags.length > COLLAPSED_TAG_LIMIT;
  const visibleTags = state.tagsExpanded
    ? state.availableTags
    : state.availableTags.filter(
        (tag, index) =>
          index < COLLAPSED_TAG_LIMIT ||
          state.selectedTags.includes(tag.name),
      );
  const hiddenCount = state.availableTags.length - visibleTags.length;
  const tags = visibleTags
    .map((tag) => {
      const selected = state.selectedTags.includes(tag.name);
      return `
        <button
          class="filter-chip${selected ? " is-active" : ""}"
          type="button"
          data-tag="${escapeHtml(tag.name)}"
          aria-pressed="${selected}"
        >${escapeHtml(tag.name)}</button>
      `;
    })
    .join("");
  const toggle = collapsed
    ? `
      <button
        class="filter-toggle"
        type="button"
        data-expand-tags
        aria-expanded="${state.tagsExpanded}"
      >${state.tagsExpanded ? "收起标签" : `展开全部标签（+${hiddenCount}）`}</button>
    `
    : "";
  elements.tagFilters.innerHTML = `${tags}${toggle}`;
}

function cardMarkup(meme: MemeResponse, selected: boolean): string {
  const image = meme.thumbnail_url ?? meme.image_url;
  return `
    <button
      class="meme-card${selected ? " is-selected" : ""}"
      type="button"
      data-meme-id="${meme.id}"
      aria-label="查看 ${escapeHtml(meme.title)}"
    >
      <span class="card-image">
        <img
          src="${escapeHtml(image)}"
          alt="${escapeHtml(meme.title)}"
          width="${meme.width}"
          height="${meme.height}"
          loading="lazy"
        >
        <span class="image-fallback" aria-hidden="true">图片不可用</span>
      </span>
      <span class="card-overlay">
        <strong>${escapeHtml(meme.title)}</strong>
        <span class="card-tags">${tagMarkup(meme.tags.map((tag) => tag.name))}</span>
      </span>
    </button>
  `;
}

function bindImageFallbacks(container: ParentNode): void {
  for (const image of container.querySelectorAll<HTMLImageElement>("img")) {
    image.addEventListener("error", () => {
      image.hidden = true;
      image.parentElement?.classList.add("is-broken");
    });
  }
}

export function renderLibrary(
  elements: AppElements,
  state: AppState,
): void {
  if (state.loadingList) {
    elements.listStatus.innerHTML =
      '<span class="status-line"><span class="spinner"></span>正在加载 Meme…</span>';
    elements.memeGrid.innerHTML = Array.from(
      { length: 8 },
      () => '<div class="meme-card skeleton" aria-hidden="true"></div>',
    ).join("");
  } else if (state.listError) {
    elements.listStatus.innerHTML = `
      <div class="error-panel" data-list-error>
        <span>${escapeHtml(state.listError)}</span>
        <button class="button button-secondary" type="button" data-retry-list>重试</button>
      </div>
    `;
    elements.memeGrid.innerHTML = "";
  } else {
    if (state.loadMoreError) {
      elements.listStatus.innerHTML = `
        <div class="error-panel" data-more-error>
          <span>${escapeHtml(state.loadMoreError)}</span>
          <button class="button button-secondary" type="button" data-retry-more>重试加载</button>
        </div>
      `;
    } else {
      elements.listStatus.textContent = state.memes.length
        ? `已显示 ${state.memes.length} 个 Meme`
        : "还没有符合条件的 Meme";
    }
    elements.memeGrid.innerHTML = state.memes
      .map((meme) => cardMarkup(meme, meme.id === state.selectedMeme?.id))
      .join("");
    bindImageFallbacks(elements.memeGrid);
  }

  elements.loadMoreButton.hidden =
    state.loadingList ||
    Boolean(state.listError) ||
    Boolean(state.loadMoreError) ||
    !state.hasMore;
  elements.loadMoreButton.disabled = state.loadingMore;
  elements.loadMoreButton.textContent = state.loadingMore
    ? "正在加载…"
    : "加载更多";
}

function detailImage(meme: MemeResponse): string {
  return `
    <button
      class="detail-image"
      type="button"
      data-open-viewer
      aria-label="查看《${escapeHtml(meme.title)}》原图"
    >
      <img
        src="${escapeHtml(meme.image_url)}"
        alt="${escapeHtml(meme.title)}"
        width="${meme.width}"
        height="${meme.height}"
      >
      <span class="image-fallback" aria-hidden="true">原图不可用</span>
    </button>
  `;
}

function detailError(message: string | null): string {
  return message
    ? `<p class="form-error detail-error" role="alert" data-action-error>${escapeHtml(message)}</p>`
    : "";
}

function aiAnalysisMarkup(state: AppState): string {
  const analysis = state.aiAnalysis;
  const error = state.aiError
    ? `<p class="form-error ai-error" role="alert">${escapeHtml(state.aiError)}</p>`
    : "";

  if (!analysis) {
    return `
      <section class="ai-panel" aria-labelledby="ai-panel-title">
        <div class="ai-panel-heading">
          <div>
            <p class="eyebrow">AI ASSIST</p>
            <h3 id="ai-panel-title">智能描述与标签</h3>
          </div>
          <button
            class="button button-primary"
            type="button"
            data-analyze-meme
            ${state.analyzing ? "disabled" : ""}
          >${state.analyzing ? "正在分析…" : "AI 分析"}</button>
        </div>
        <p class="ai-hint">分析结果仅供预览，确认前不会修改描述、标签或模板。</p>
        ${error}
      </section>
    `;
  }

  const suggestions = analysis.suggestions.length
    ? analysis.suggestions
        .map((suggestion) => {
          const checked = state.selectedAITags.includes(suggestion.name);
          return `
            <label class="ai-suggestion">
              <input
                type="checkbox"
                data-ai-tag="${escapeHtml(suggestion.name)}"
                ${checked ? "checked" : ""}
                ${state.confirmingAnalysis ? "disabled" : ""}
              >
              <span class="ai-suggestion-name">${escapeHtml(suggestion.name)}</span>
              <span class="ai-suggestion-kind">${suggestion.existing ? "已有" : "新建议"}</span>
              <span class="ai-confidence">${Math.round(suggestion.confidence * 100)}%</span>
            </label>
          `;
        })
        .join("")
    : '<p class="muted">这次分析没有返回标签建议。</p>';
  const suggestedTemplate = analysis.suggested_template
    ? `
      <p><strong>建议模板：${escapeHtml(analysis.suggested_template.name)}</strong></p>
      ${analysis.suggested_template.description ? `<p class="muted">${escapeHtml(analysis.suggested_template.description)}</p>` : ""}
    `
    : '<p class="muted">模板匹配：未找到合适的已有模板</p>';

  return `
    <section class="ai-panel has-result" aria-labelledby="ai-panel-title">
      <div class="ai-panel-heading">
        <div>
          <p class="eyebrow">AI ASSIST · ${escapeHtml(analysis.model_name)}</p>
          <h3 id="ai-panel-title">分析建议</h3>
        </div>
        <button
          class="button button-secondary"
          type="button"
          data-analyze-meme
          ${state.analyzing || state.confirmingAnalysis ? "disabled" : ""}
        >${state.analyzing ? "正在分析…" : "重新分析"}</button>
      </div>
      <p class="ai-description">${escapeHtml(analysis.description)}</p>
      <label class="ai-description-choice">
        <input
          type="checkbox"
          data-ai-description
          ${state.applyAIDescription ? "checked" : ""}
          ${state.confirmingAnalysis ? "disabled" : ""}
        >
        <span>同时采用这段图片描述</span>
      </label>
      <fieldset class="ai-suggestions">
        <legend>选择要追加的标签</legend>
        ${suggestions}
      </fieldset>
      <fieldset class="ai-template-choice">
        <legend>模板归类</legend>
        ${suggestedTemplate}
        <label class="check-row">
          <input
            type="checkbox"
            data-ai-apply-template
            ${state.applyAITemplate ? "checked" : ""}
            ${state.confirmingAnalysis ? "disabled" : ""}
          >
          <span>应用模板归类</span>
        </label>
        <label>
          <span>最终模板</span>
          <select
            data-ai-template
            ${state.confirmingAnalysis || !state.applyAITemplate ? "disabled" : ""}
          >${templateOptions(state, state.selectedAITemplateId === null ? "" : String(state.selectedAITemplateId))}</select>
        </label>
      </fieldset>
      ${error}
      <div class="ai-actions">
        <span class="ai-hint">只有点击确认后才会写入。</span>
        <button
          class="button button-primary"
          type="button"
          data-confirm-ai
          ${state.confirmingAnalysis ? "disabled" : ""}
        >${state.confirmingAnalysis ? "正在保存…" : "确认采用"}</button>
      </div>
    </section>
  `;
}

export function renderDetail(
  elements: AppElements,
  state: AppState,
  editing: boolean,
  draft: EditDraft | null,
): void {
  const meme = state.selectedMeme;
  if (!meme) {
    elements.detailPanel.innerHTML = `
      <div class="detail-empty">
        <span class="detail-empty-mark" aria-hidden="true">MV</span>
        <h2>选择一个 Meme</h2>
        <p>从左侧资料库选择卡片，或使用“随机一个”。</p>
        ${detailError(state.actionError)}
      </div>
    `;
    return;
  }

  if (editing && draft) {
    elements.detailPanel.innerHTML = `
      <div class="detail-scroll">
        ${detailImage(meme)}
        <form id="edit-form" class="edit-form">
          <div class="detail-heading">
            <div>
              <p class="eyebrow">EDITING #${meme.id}</p>
              <h2>编辑 Meme</h2>
            </div>
          </div>
          <label>
            <span>标题</span>
            <input name="title" type="text" maxlength="255" value="${escapeHtml(draft.title)}" required>
          </label>
          <label>
            <span>描述</span>
            <textarea name="description" rows="4">${escapeHtml(draft.description)}</textarea>
          </label>
          <label>
            <span>来源</span>
            <input name="source" type="text" maxlength="500" value="${escapeHtml(draft.source)}">
          </label>
          <label>
            <span>标签</span>
            <input name="tags" type="text" value="${escapeHtml(draft.tags)}">
          </label>
          <label>
            <span>模板</span>
            <select name="template_id">${templateOptions(state, draft.templateId)}</select>
          </label>
          ${detailError(state.actionError)}
          <div class="detail-actions">
            <button class="button button-ghost" type="button" data-cancel-edit>取消</button>
            <button class="button button-primary" type="submit" ${state.saving ? "disabled" : ""}>
              ${state.saving ? "正在保存…" : "保存修改"}
            </button>
          </div>
        </form>
      </div>
    `;
  } else {
    elements.detailPanel.innerHTML = `
      <div class="detail-scroll">
        ${detailImage(meme)}
        <div class="detail-content">
          <div class="detail-heading">
            <div>
              <p class="eyebrow">MEME #${meme.id}</p>
              <h2 data-detail-title>${escapeHtml(meme.title)}</h2>
            </div>
          </div>
          <div class="detail-tags">${tagMarkup(meme.tags.map((tag) => tag.name))}</div>
          <p class="detail-description">${escapeHtml(meme.description || "暂无描述")}</p>
          <dl class="metadata">
            <div><dt>来源</dt><dd>${escapeHtml(meme.source || "未填写")}</dd></div>
            <div><dt>模板</dt><dd>${escapeHtml(meme.template?.name || "未归类")}</dd></div>
            <div><dt>尺寸</dt><dd>${meme.width} × ${meme.height}</dd></div>
            <div><dt>文件</dt><dd>${formatFileSize(meme.file_size)} · ${escapeHtml(meme.mime_type)}</dd></div>
            <div><dt>创建</dt><dd>${escapeHtml(formatDate(meme.created_at))}</dd></div>
            <div><dt>更新</dt><dd>${escapeHtml(formatDate(meme.updated_at))}</dd></div>
          </dl>
          ${aiAnalysisMarkup(state)}
          ${detailError(state.actionError)}
          <div class="detail-actions">
            <button class="button button-secondary" type="button" data-edit-meme>编辑</button>
            <button class="button button-danger" type="button" data-delete-meme ${state.deleting ? "disabled" : ""}>
              ${state.deleting ? "正在删除…" : "删除"}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  bindImageFallbacks(elements.detailPanel);
}

export function openImageViewer(
  elements: AppElements,
  meme: MemeResponse,
): void {
  elements.imageViewerImage.hidden = false;
  elements.imageViewerFrame.classList.remove("is-broken");
  elements.imageViewerError.hidden = true;
  elements.imageViewerError.textContent = "";

  elements.imageViewerImage.src = meme.image_url;
  elements.imageViewerImage.alt = meme.title;
  elements.imageViewerImage.width = meme.width;
  elements.imageViewerImage.height = meme.height;
  elements.imageViewerTitle.textContent = meme.title;
  elements.imageViewerLink.href = meme.image_url;

  if (!elements.imageViewerDialog.open) {
    elements.imageViewerDialog.showModal();
  }
}

export function closeImageViewer(elements: AppElements): void {
  if (elements.imageViewerDialog.open) {
    elements.imageViewerDialog.close();
  }
}

export function setUploadBusy(
  elements: AppElements,
  busy: boolean,
  error: string | null,
): void {
  elements.uploadSubmit.disabled = busy;
  elements.uploadSubmit.textContent = busy ? "正在上传…" : "开始上传";
  elements.uploadError.hidden = !error;
  elements.uploadError.textContent = error ?? "";
}
