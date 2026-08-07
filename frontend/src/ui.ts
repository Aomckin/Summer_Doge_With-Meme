import type { AppState, MemeCardSize, MemeResponse } from "./types";
import { buildPaginationTokens, clampPage } from "./pagination";

export interface EditDraft {
  title: string;
  description: string;
  source: string;
  tags: string[];
  templateId: string;
}

export interface AppElements {
  searchInput: HTMLInputElement;
  searchMode: HTMLSelectElement;
  semanticSearchButton: HTMLButtonElement;
  randomButton: HTMLButtonElement;
  openUploadButton: HTMLButtonElement;
  openDownloadButton: HTMLButtonElement;
  openSettingsButton: HTMLButtonElement;
  openTemplatesButton: HTMLButtonElement;
  openTagsButton: HTMLButtonElement;
  openSemanticIndexButton: HTMLButtonElement;
  operationError: HTMLElement;
  tagFilters: HTMLElement;
  libraryHeading: HTMLElement;
  browsingControls: HTMLElement;
  listStatus: HTMLElement;
  memeGrid: HTMLElement;
  pagination: HTMLElement;
  detailPanel: HTMLElement;
  templateDialog: HTMLDialogElement;
  templateForm: HTMLFormElement;
  templateReferencePreview: HTMLElement;
  templateList: HTMLElement;
  templatePagination: HTMLElement;
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
  relationDialog: HTMLDialogElement;
  relationSearch: HTMLInputElement;
  relationCandidates: HTMLElement;
  relationError: HTMLElement;
  relationSave: HTMLButtonElement;
  imageViewerDialog: HTMLDialogElement;
  imageViewerFrame: HTMLElement;
  imageViewerImage: HTMLImageElement;
  imageViewerTitle: HTMLElement;
  imageViewerLink: HTMLAnchorElement;
  imageViewerDownload: HTMLAnchorElement;
  imageViewerError: HTMLElement;
  imageViewerPrevious: HTMLButtonElement;
  imageViewerNext: HTMLButtonElement;
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
          <select id="search-mode" aria-label="搜索模式"><option value="keyword">关键词</option><option value="semantic">语义</option></select>
          <label class="search-box" for="meme-search">
            <span aria-hidden="true">⌕</span>
            <input id="meme-search" type="search" placeholder="搜索标题或描述…" aria-label="搜索 Meme" autocomplete="off">
          </label>
          <button id="semantic-search-button" class="button button-primary" type="button" hidden>语义搜索</button>
          <button id="open-settings" class="button button-secondary" type="button">API 设置</button>
          <button id="open-templates" class="button button-secondary" type="button">模板管理</button>
          <button id="open-tags" class="button button-secondary" type="button">标签管理</button>
          <button id="open-semantic-index" class="button button-secondary" type="button">语义索引</button>
          <button id="random-button" class="button button-secondary" type="button">随机一个</button>
          <button id="open-upload" class="button button-primary" type="button">图片上传</button>
          <button id="open-download" class="button button-secondary" type="button">批量下载</button>
        </div>
      </header>

      <div id="operation-error" class="operation-error" role="alert" aria-live="assertive" hidden></div>

      <main class="workspace">
        <section class="library" aria-label="Meme 资料库">
          <div id="library-heading" class="section-heading">
            <div>
              <p class="eyebrow">LIBRARY</p>
              <h1>我的 Meme</h1>
            </div>
          </div>
          <div id="tag-filters" class="tag-filters" aria-label="标签筛选"></div>
          <div id="browsing-controls" class="browsing-controls" aria-label="资料库浏览设置">
            <strong data-meme-total>共 0 个 Meme</strong>
            <label>顺序
              <select data-list-sort aria-label="资料库顺序">
                <option value="default">默认顺序</option>
                <option value="shuffle">随机顺序</option>
              </select>
            </label>
            <button class="button button-secondary" type="button" data-reshuffle hidden>重新洗牌</button>
            <label>每页
              <select data-page-size aria-label="每页显示数量">
                <option value="24">24</option><option value="48">48</option><option value="96">96</option>
              </select>
            </label>
            <label>卡片
              <select data-card-size aria-label="卡片显示大小">
                <option value="extra-large">超大</option><option value="large">大</option><option value="medium">中</option><option value="small">小</option>
              </select>
            </label>
          </div>
          <div id="list-status" class="list-status" aria-live="polite"></div>
          <div id="meme-grid" class="meme-grid" data-card-size="medium"></div>
          <nav id="library-pagination" class="pagination" aria-label="资料库分页"></nav>
        </section>

        <aside id="detail-panel" class="detail-panel" aria-label="Meme 详情"></aside>
      </main>
    </div>

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
            <div id="template-reference-input-preview" class="template-reference-input-preview" aria-live="polite">
              <span>选择图片后在这里预览</span>
            </div>
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
          <div>
            <div id="template-list" class="template-list"></div>
            <nav id="template-pagination" class="template-pagination" aria-label="模板分页"></nav>
          </div>
        </div>
      </div>
    </dialog>

    <dialog id="api-settings-dialog" class="settings-dialog" aria-labelledby="settings-title">
      <div class="settings-shell">
        <header class="settings-header">
          <div>
            <p class="eyebrow">AI CONFIGURATION · v0.4.0</p>
            <h2 id="settings-title">API 设置</h2>
            <p>管理模型厂商、连接凭据、图片分析与模板视觉检索模型。</p>
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
            <option value="dashscope_multimodal_embedding">DashScope 多模态向量</option>
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
          <input name="supports_image_embedding" type="checkbox">
          <span>支持图像与语义向量</span>
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
      class="modal relation-dialog"
      data-relation-dialog
      aria-labelledby="relation-dialog-title"
    >
      <div class="modal-card">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">DIRECT LINKS</p>
            <h2 id="relation-dialog-title">添加相关 Meme</h2>
          </div>
          <button class="icon-button" type="button" data-close-relations aria-label="关闭">×</button>
        </div>
        <label>
          <span>搜索标题或描述</span>
          <input data-relation-search type="search" autocomplete="off" placeholder="输入关键词筛选当前资料库">
        </label>
        <div class="relation-candidates" data-relation-candidates></div>
        <p class="form-error" data-relation-dialog-error role="alert" hidden></p>
        <div class="modal-actions">
          <button class="button button-ghost" type="button" data-close-relations>取消</button>
          <button class="button button-primary" type="button" data-save-relations>添加所选</button>
        </div>
      </div>
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
            <a class="button button-primary" data-viewer-download>下载当前图</a>
            <button
              class="icon-button"
              type="button"
              data-close-viewer
              aria-label="关闭原图查看器"
            >×</button>
          </div>
        </header>
        <div class="image-viewer-frame" data-viewer-frame>
          <button type="button" data-viewer-previous aria-label="上一张">‹</button>
          <img data-viewer-image alt="" hidden>
          <button type="button" data-viewer-next aria-label="下一张">›</button>
          <p data-viewer-error role="alert" hidden>原图加载失败</p>
        </div>
      </div>
    </dialog>
  `;

  return {
    searchInput: required(root, "#meme-search"),
    searchMode: required(root, "#search-mode"),
    semanticSearchButton: required(root, "#semantic-search-button"),
    randomButton: required(root, "#random-button"),
    openUploadButton: required(root, "#open-upload"),
    openDownloadButton: required(root, "#open-download"),
    openSettingsButton: required(root, "#open-settings"),
    openTemplatesButton: required(root, "#open-templates"),
    openTagsButton: required(root, "#open-tags"),
    openSemanticIndexButton: required(root, "#open-semantic-index"),
    operationError: required(root, "#operation-error"),
    tagFilters: required(root, "#tag-filters"),
    libraryHeading: required(root, "#library-heading"),
    browsingControls: required(root, "#browsing-controls"),
    listStatus: required(root, "#list-status"),
    memeGrid: required(root, "#meme-grid"),
    pagination: required(root, "#library-pagination"),
    detailPanel: required(root, "#detail-panel"),
    templateDialog: required(document, "#template-dialog"),
    templateForm: required(document, "#template-form"),
    templateReferencePreview: required(
      document,
      "#template-reference-input-preview",
    ),
    templateList: required(document, "#template-list"),
    templatePagination: required(document, "#template-pagination"),
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
    relationDialog: required(document, "[data-relation-dialog]"),
    relationSearch: required(document, "[data-relation-search]"),
    relationCandidates: required(document, "[data-relation-candidates]"),
    relationError: required(document, "[data-relation-dialog-error]"),
    relationSave: required(document, "[data-save-relations]"),
    imageViewerDialog: required(document, "#image-viewer-dialog"),
    imageViewerFrame: required(document, "[data-viewer-frame]"),
    imageViewerImage: required(document, "[data-viewer-image]"),
    imageViewerTitle: required(document, "[data-viewer-title]"),
    imageViewerLink: required(document, "[data-viewer-link]"),
    imageViewerDownload: required(document, "[data-viewer-download]"),
    imageViewerError: required(document, "[data-viewer-error]"),
    imageViewerPrevious: required(document, "[data-viewer-previous]"),
    imageViewerNext: required(document, "[data-viewer-next]"),
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
  renderTemplateReferenceInputPreview(
    elements,
    editing?.reference_thumbnail_url ?? null,
    editing ? `${editing.name} 当前参考图` : "参考图预览",
  );
  const totalPages = Math.ceil(state.availableTemplates.length / 12);
  const page = clampPage(state.templatePage, totalPages);
  const start = (page - 1) * 12;
  const templates = state.availableTemplates.slice(start, start + 12);
  elements.templateList.innerHTML = templates.length
    ? templates
        .map(
          (template) => `
            <article class="template-row">
              <div>
                <strong>${escapeHtml(template.name)}</strong>
                <p>${escapeHtml(template.description || "暂无描述")}</p>
                ${template.reference_thumbnail_url ? `<figure class="template-reference"><img class="template-reference-preview" data-template-reference-preview="${template.id}" src="${escapeHtml(template.reference_thumbnail_url)}" alt="${escapeHtml(template.name)} 参考图" loading="lazy"><figcaption>参考图</figcaption></figure>` : '<p class="muted">描述分类模板（无参考图）</p>'}
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
  elements.templatePagination.hidden = totalPages === 0;
  elements.templatePagination.innerHTML = totalPages
    ? `<button class="button button-ghost" type="button" data-template-page="${page - 1}" ${page <= 1 || busy ? "disabled" : ""}>上一页</button>
       <span>第 ${page} / ${totalPages} 页</span>
       <label>跳至页码 <input type="number" min="1" max="${totalPages}" inputmode="numeric" data-template-page-input ${busy ? "disabled" : ""}></label>
       <button class="button button-ghost" type="button" data-template-page="${page + 1}" ${page >= totalPages || busy ? "disabled" : ""}>下一页</button>`
    : "";
}

export function renderTemplateReferenceInputPreview(
  elements: AppElements,
  source: string | null,
  alt: string,
): void {
  elements.templateReferencePreview.innerHTML = source
    ? `<img src="${escapeHtml(source)}" alt="${escapeHtml(alt)}">`
    : "<span>选择图片后在这里预览</span>";
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

function cardMarkup(
  meme: MemeResponse,
  selected: boolean,
  cardSize: MemeCardSize,
  score?: number,
): string {
  const thumbnail = meme.thumbnail_url ?? meme.image_url;
  const image = cardSize === "extra-large" ? meme.image_url : thumbnail;
  return `
    <button
      class="meme-card${selected ? " is-selected" : ""}"
      type="button"
      data-meme-id="${meme.id}"
      aria-label="查看 ${escapeHtml(meme.title)}"
    >
      <span class="card-image">
        <img
          data-card-image
          data-thumbnail-src="${escapeHtml(thumbnail)}"
          data-original-src="${escapeHtml(meme.image_url)}"
          src="${escapeHtml(image)}"
          alt="${escapeHtml(meme.title)}"
          width="${meme.width}"
          height="${meme.height}"
          loading="lazy"
        >
        <span class="image-fallback" aria-hidden="true">图片不可用</span>
        ${meme.image_count > 1 ? `<span class="image-count-badge">${meme.image_count} 张</span>` : ""}
      </span>
      <span class="card-overlay">
        <strong>${escapeHtml(meme.title)}</strong>
        ${score === undefined ? "" : `<span class="semantic-score">相关度 ${score.toFixed(3)}</span>`}
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
  applyMemeCardSize(elements, state.cardSize);
  const total = new Intl.NumberFormat("zh-CN").format(state.totalMemes);
  const totalNode = elements.browsingControls.querySelector<HTMLElement>("[data-meme-total]");
  if (totalNode) totalNode.textContent = `共 ${total} 个 Meme`;
  const sort = elements.browsingControls.querySelector<HTMLSelectElement>("[data-list-sort]");
  const pageSize = elements.browsingControls.querySelector<HTMLSelectElement>("[data-page-size]");
  const cardSize = elements.browsingControls.querySelector<HTMLSelectElement>("[data-card-size]");
  const reshuffle = elements.browsingControls.querySelector<HTMLButtonElement>("[data-reshuffle]");
  elements.searchMode.value = state.searchMode;
  elements.semanticSearchButton.hidden = state.searchMode !== "semantic";
  elements.searchInput.placeholder = state.searchMode === "semantic" ? "描述想找的场景、情绪或用途" : "搜索标题或描述…";
  if (sort) {
    sort.value = state.listSort;
    sort.disabled = state.loadingList || state.searchMode === "semantic";
    const label = sort.closest("label");
    if (label) label.hidden = state.searchMode === "semantic";
  }
  if (pageSize) { pageSize.value = String(state.pageSize); pageSize.disabled = state.loadingList; }
  if (cardSize) cardSize.value = state.cardSize;
  if (reshuffle) {
    reshuffle.hidden = state.searchMode === "semantic" || state.listSort !== "shuffle";
    reshuffle.disabled = state.loadingList;
  }
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
    elements.listStatus.textContent = state.memes.length
      ? `第 ${state.page} / ${state.totalPages} 页`
      : "还没有符合条件的 Meme";
    elements.memeGrid.innerHTML = state.memes
      .map((meme) => cardMarkup(
        meme,
        meme.id === state.selectedMeme?.id,
        state.cardSize,
        state.searchMode === "semantic" ? state.semanticScores[meme.id] : undefined,
      ))
      .join("");
    bindImageFallbacks(elements.memeGrid);
  }

  const disabled = state.loadingList || state.totalPages === 0;
  const tokens = buildPaginationTokens(state.page, state.totalPages)
    .map((token) => token === "ellipsis"
      ? '<span class="pagination-ellipsis" aria-hidden="true">…</span>'
      : `<button type="button" class="button button-ghost pagination-number${token === state.page ? " is-active" : ""}" data-page="${token}" ${disabled || token === state.page ? "disabled" : ""} aria-current="${token === state.page ? "page" : "false"}">${token}</button>`)
    .join("");
  elements.pagination.innerHTML = `
    <button type="button" class="button button-ghost" data-page="1" ${disabled || state.page <= 1 ? "disabled" : ""}>第一页</button>
    <button type="button" class="button button-ghost" data-page="${state.page - 1}" ${disabled || state.page <= 1 ? "disabled" : ""}>上一页</button>
    <span class="pagination-numbers">${tokens}</span>
    <button type="button" class="button button-ghost" data-page="${state.page + 1}" ${disabled || state.page >= state.totalPages ? "disabled" : ""}>下一页</button>
    <button type="button" class="button button-ghost" data-page="${state.totalPages}" ${disabled || state.page >= state.totalPages ? "disabled" : ""}>最后一页</button>
    <label>跳至页码 <input type="number" min="1" max="${Math.max(1, state.totalPages)}" inputmode="numeric" data-page-input ${disabled ? "disabled" : ""}></label>`;
}

export function renderMemeCard(
  elements: AppElements,
  meme: MemeResponse,
  selected: boolean,
): void {
  const current = elements.memeGrid.querySelector<HTMLElement>(
    `[data-meme-id="${meme.id}"]`,
  );
  if (!current) {
    return;
  }
  const template = document.createElement("template");
  const size = elements.memeGrid.dataset.cardSize as MemeCardSize | undefined;
  template.innerHTML = cardMarkup(meme, selected, size ?? "medium").trim();
  const replacement = template.content.firstElementChild;
  if (!(replacement instanceof HTMLElement)) {
    return;
  }
  current.replaceWith(replacement);
  bindImageFallbacks(replacement);
}

export function applyMemeCardSize(
  elements: AppElements,
  size: MemeCardSize,
): void {
  elements.memeGrid.dataset.cardSize = size;
  for (const image of elements.memeGrid.querySelectorAll<HTMLImageElement>("[data-card-image]")) {
    const source = size === "extra-large"
      ? image.dataset.originalSrc
      : image.dataset.thumbnailSrc;
    if (source && image.getAttribute("src") !== source) {
      image.hidden = false;
      image.parentElement?.classList.remove("is-broken");
      image.src = source;
    }
  }
}

function detailImage(meme: MemeResponse, state: AppState): string {
  const images = meme.images.length ? meme.images : [{
    id: 0, image_url: meme.image_url, width: meme.width, height: meme.height,
  }];
  const busy = state.imageOperation !== null;
  return `
    <section class="image-manager" aria-label="图片组管理" aria-busy="${busy}">
      <div>
        <strong>${images.length} 张图片</strong>
        <span>拖拽图片可调整顺序，第一张始终是封面。</span>
      </div>
      <label class="button button-secondary ${busy ? "is-disabled" : ""}">
        ${state.imageOperation === "append" ? "正在追加…" : "追加图片"}
        <input
          data-append-image
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          ${busy ? "disabled" : ""}
          hidden
        >
      </label>
    </section>
    ${state.imageError ? `<p class="form-error image-operation-error" data-image-error role="alert">${escapeHtml(state.imageError)}</p>` : ""}
  ` + images.map((image, index) => `
    <article
      class="detail-image"
      data-image-id="${image.id}"
      draggable="${busy ? "false" : "true"}"
    >
      <div class="detail-image-toolbar">
        <span class="image-position">${index + 1} / ${images.length}</span>
        ${index === 0 ? `<strong class="cover-label" data-cover-label>封面</strong>` : ""}
        <span class="drag-hint">拖拽排序</span>
        ${images.length > 1 ? `
          <button
            class="button button-danger image-delete"
            type="button"
            data-delete-image="${image.id}"
            ${busy ? "disabled" : ""}
            aria-label="删除第 ${index + 1} 张图片"
          >${state.imageOperation === image.id ? "正在删除…" : "删除"}</button>
        ` : ""}
      </div>
      <button
        class="detail-image-view"
        type="button"
        data-open-viewer
        data-image-index="${index}"
        aria-label="查看《${escapeHtml(meme.title)}》第 ${index + 1} 张原图"
      >
        <img
          src="${escapeHtml(image.image_url)}"
          alt="${escapeHtml(meme.title)}第 ${index + 1} 张"
          width="${image.width}"
          height="${image.height}"
        >
        <span class="image-fallback" aria-hidden="true">原图不可用</span>
      </button>
    </article>
  `).join("");
}

function relatedMemesMarkup(state: AppState): string {
  let content = "";
  if (state.relationsLoading) {
    content = `<p class="muted relation-status">正在加载直接关联…</p>`;
  } else if (state.relatedMemes.length) {
    content = `<div class="relation-list">${state.relatedMemes.map((item) => `
      <article class="relation-item">
        <button type="button" class="relation-target" data-related-meme="${item.id}">
          <span class="relation-thumbnail">
            <img
              src="${escapeHtml(item.thumbnail_url || item.image_url)}"
              alt=""
              width="${item.width}"
              height="${item.height}"
            >
          </span>
          <span>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.description || "暂无描述")}</small>
          </span>
        </button>
        <button
          class="button button-ghost relation-remove"
          type="button"
          data-remove-relation="${item.id}"
          ${state.relationRemovingId !== null ? "disabled" : ""}
        >${state.relationRemovingId === item.id ? "正在移除…" : "移除"}</button>
      </article>
    `).join("")}</div>`;
  } else {
    content = `<p class="muted relation-status">暂无直接关联</p>`;
  }
  return `
    <section class="related-memes" aria-labelledby="related-memes-title">
      <div class="related-heading">
        <div>
          <p class="eyebrow">DIRECT ONLY</p>
          <h3 id="related-memes-title">相关 Meme</h3>
        </div>
        <button
          class="button button-secondary"
          type="button"
          data-open-relations
          ${state.relationsLoading ? "disabled" : ""}
        >添加关联</button>
      </div>
      ${content}
      ${state.relationError ? `<p class="form-error relation-error" data-relation-error role="alert">${escapeHtml(state.relationError)}</p>` : ""}
    </section>
  `;
}

function similarMemesMarkup(state: AppState): string {
  const visible = state.similarMemes.slice(0, state.similarExpanded ? 12 : 6);
  let content: string;
  if (state.similarLoading) {
    content = '<p class="muted">正在加载语义相似 Meme…</p>';
  } else if (state.similarError) {
    content = `<p class="muted">${escapeHtml(state.similarError)}</p>
      ${state.similarError.includes("尚未建立") || state.similarError.includes("valid semantic")
        ? `<button class="button button-secondary" type="button" data-rebuild-embedding ${state.rebuildingEmbedding ? "disabled" : ""}>${state.rebuildingEmbedding ? "正在建立…" : "为此 Meme 建立索引"}</button>`
        : ""}`;
  } else if (visible.length) {
    content = `<div class="relation-list">${visible.map(({ meme, score }) => `
      <button type="button" class="relation-target semantic-similar-target" data-similar-meme="${meme.id}">
        <span class="relation-thumbnail"><img src="${escapeHtml(meme.thumbnail_url || meme.image_url)}" alt="" loading="lazy"></span>
        <span><strong>${escapeHtml(meme.title)}</strong><small>相关度 ${score.toFixed(3)}</small></span>
      </button>`).join("")}</div>
      ${state.similarMemes.length > 6 ? `<button class="button button-ghost" type="button" data-toggle-similar>${state.similarExpanded ? "收起" : "展开至 12 个"}</button>` : ""}`;
  } else {
    content = '<p class="muted">没有可比较的语义相似 Meme</p>';
  }
  return `<section class="related-memes semantic-similar" aria-labelledby="semantic-similar-title">
    <div class="related-heading"><div><p class="eyebrow">SEMANTIC · VECTOR</p><h3 id="semantic-similar-title">语义相似 Meme</h3></div></div>
    ${content}
  </section>`;
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
            <h3 id="ai-panel-title">智能标题、描述与标签</h3>
          </div>
          <button
            class="button button-primary"
            type="button"
            data-analyze-meme
            ${state.analyzing ? "disabled" : ""}
          >${state.analyzing ? "正在分析…" : "AI 分析"}</button>
        </div>
        <p class="ai-hint">分析结果仅供预览，确认前不会修改标题、描述、标签或模板。</p>
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
  const suggestedTitle = analysis.suggested_title
    ? `
      <div class="ai-title-suggestion">
        <p><strong>建议标题：${escapeHtml(analysis.suggested_title)}</strong></p>
        <label class="check-row">
          <input
            type="checkbox"
            data-ai-title
            ${state.applyAITitle ? "checked" : ""}
            ${state.confirmingAnalysis ? "disabled" : ""}
          >
          <span>采用建议标题</span>
        </label>
      </div>
    `
    : "";

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
      ${suggestedTitle}
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
        ${detailImage(meme, state)}
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
            <div data-edit-tag-editor></div>
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
        ${detailImage(meme, state)}
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
          ${relatedMemesMarkup(state)}
          ${similarMemesMarkup(state)}
          ${aiAnalysisMarkup(state)}
          <div data-caption-lab-host></div>
          ${detailError(state.actionError)}
          <div class="detail-actions">
            <a class="button button-secondary" href="/api/memes/${meme.id}/download" data-download-meme>${meme.image_count > 1 ? "下载图片组" : "下载图片"}</a>
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
  elements.detailPanel.dispatchEvent(
    new CustomEvent("meme-detail-rendered"),
  );
}

export function openImageViewer(
  elements: AppElements,
  meme: MemeResponse,
  index = 0,
): void {
  const images = meme.images.length ? meme.images : [{ id: 0, image_url: meme.image_url, width: meme.width, height: meme.height }];
  const image = images[index] ?? images[0];
  elements.imageViewerImage.hidden = false;
  elements.imageViewerFrame.classList.remove("is-broken");
  elements.imageViewerError.hidden = true;
  elements.imageViewerError.textContent = "";

  elements.imageViewerImage.src = image.image_url;
  elements.imageViewerImage.alt = meme.title;
  elements.imageViewerImage.width = image.width;
  elements.imageViewerImage.height = image.height;
  elements.imageViewerTitle.textContent = meme.title;
  elements.imageViewerLink.href = image.image_url;
  elements.imageViewerDownload.href = `/api/memes/${meme.id}/images/${image.id}/download`;
  elements.imageViewerPrevious.disabled = index <= 0;
  elements.imageViewerNext.disabled = index >= images.length - 1;

  if (!elements.imageViewerDialog.open) {
    elements.imageViewerDialog.showModal();
  }
}

export function closeImageViewer(elements: AppElements): void {
  if (elements.imageViewerDialog.open) {
    elements.imageViewerDialog.close();
  }
  elements.imageViewerImage.removeAttribute("src");
  elements.imageViewerImage.removeAttribute("width");
  elements.imageViewerImage.removeAttribute("height");
  elements.imageViewerImage.alt = "";
  elements.imageViewerLink.removeAttribute("href");
  elements.imageViewerDownload.removeAttribute("href");
  elements.imageViewerTitle.textContent = "";
  elements.imageViewerPrevious.disabled = true;
  elements.imageViewerNext.disabled = true;
  elements.imageViewerError.hidden = true;
  elements.imageViewerError.textContent = "";
  elements.imageViewerFrame.classList.remove("is-broken");
}

export function renderRelationDialog(
  elements: AppElements,
  state: AppState,
): void {
  const selectedId = state.selectedMeme?.id;
  const relatedIds = new Set(state.relatedMemes.map((item) => item.id));
  const query = state.relationQuery.trim().toLocaleLowerCase();
  const candidates = state.memes.filter((item) => {
    if (item.id === selectedId || relatedIds.has(item.id)) {
      return false;
    }
    if (!query) {
      return true;
    }
    return `${item.title}\n${item.description || ""}`
      .toLocaleLowerCase()
      .includes(query);
  });

  elements.relationSearch.value = state.relationQuery;
  elements.relationSearch.disabled = state.relationsSaving;
  elements.relationCandidates.innerHTML = candidates.length
    ? candidates.map((item) => `
      <label class="relation-choice">
        <input
          type="checkbox"
          data-relation-choice="${item.id}"
          ${state.selectedRelationIds.includes(item.id) ? "checked" : ""}
          ${state.relationsSaving ? "disabled" : ""}
        >
        <span class="relation-thumbnail">
          <img
            src="${escapeHtml(item.thumbnail_url || item.image_url)}"
            alt=""
            width="${item.width}"
            height="${item.height}"
          >
        </span>
        <span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.description || "暂无描述")}</small>
        </span>
      </label>
    `).join("")
    : `<p class="muted relation-empty">没有符合条件的可关联 Meme。</p>`;
  elements.relationSave.disabled =
    state.relationsSaving || state.selectedRelationIds.length === 0;
  elements.relationSave.textContent = state.relationsSaving
    ? "正在添加…"
    : `添加所选${state.selectedRelationIds.length ? `（${state.selectedRelationIds.length}）` : ""}`;
  for (const button of elements.relationDialog.querySelectorAll<HTMLButtonElement>(
    "[data-close-relations]",
  )) {
    button.disabled = state.relationsSaving;
  }
  elements.relationError.hidden = !state.relationError;
  elements.relationError.textContent = state.relationError ?? "";
  bindImageFallbacks(elements.relationCandidates);
}
