import type { AppState, MemeCardSize, MemeResponse } from "./types";
import { buildPaginationTokens, clampPage } from "./pagination";
import { memeCopySource } from "./meme-actions";
import { bindMemeCardTilts, storedCardMotionPreset } from "./card-tilt";
import type { InfiniteFeedState } from "./immersive/immersive-feed";
import { probeAuthAfterMediaError } from "./api";

export interface EditDraft {
  title: string;
  description: string;
  source: string;
  tags: string[];
  templateId: string;
}

export interface AppElements {
  appRoot: HTMLElement;
  topbar: HTMLElement;
  appearanceBackground: HTMLElement;
  searchInput: HTMLInputElement;
  searchMode: HTMLSelectElement;
  semanticSearchButton: HTMLButtonElement;
  randomButton: HTMLButtonElement;
  gifModeButton: HTMLButtonElement;
  openUploadButton: HTMLButtonElement;
  openMemeMakerButton: HTMLButtonElement;
  openDownloadButton: HTMLButtonElement;
  openSettingsButton: HTMLButtonElement;
  openAppearanceButton: HTMLButtonElement;
  openImmersiveButton: HTMLButtonElement;
  openTemplatesButton: HTMLButtonElement;
  browseTemplatesButton: HTMLButtonElement;
  openTagsButton: HTMLButtonElement;
  openSemanticIndexButton: HTMLButtonElement;
  openEnrichmentButton: HTMLButtonElement;
  openChatRecommendationButton: HTMLButtonElement;
  openVaultInspectorButton: HTMLButtonElement;
  openCollectionsButton: HTMLButtonElement;
  operationError: HTMLElement;
  templateFilters: HTMLElement;
  tagFilters: HTMLElement;
  libraryHeading: HTMLElement;
  browsingControls: HTMLElement;
  listStatus: HTMLElement;
  memeGrid: HTMLElement;
  immersiveFeedStatus: HTMLElement;
  immersiveFeedSentinel: HTMLElement;
  managementMenu: HTMLDetailsElement;
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
  appearanceDialog: HTMLDialogElement;
  appearanceContent: HTMLElement;
  immersiveDock: HTMLElement;
  immersiveSearchInput: HTMLInputElement;
  immersiveRandomButton: HTMLButtonElement;
  immersiveAppearanceButton: HTMLButtonElement;
  immersiveTunerButton: HTMLButtonElement;
  immersiveTunerPanel: HTMLElement;
  immersiveExitButton: HTMLButtonElement;
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
  imageViewerCopy: HTMLButtonElement;
  imageViewerForge: HTMLButtonElement;
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
    <div class="appearance-backdrop" aria-hidden="true">
      <div class="appearance-background" data-appearance-background></div>
      <div class="appearance-darkness"></div>
      <div class="appearance-tint"></div>
      <div class="appearance-glow"></div>
      <div class="appearance-vignette"></div>
      <div class="appearance-grain"></div>
    </div>
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">MV</span>
          <div>
            <strong>Meme Vault</strong>
            <span>PRIVATE COLLECTION</span>
          </div>
        </div>
        <div class="toolbar">
          <div class="search-stage">
            <select id="search-mode" aria-label="搜索模式"><option value="keyword">关键词</option><option value="semantic">语义</option></select>
            <label class="search-box" for="meme-search">
              <span class="search-icon" aria-hidden="true">⌕</span>
              <input id="meme-search" type="search" placeholder="搜索你的 Vault…" aria-label="搜索 Meme" autocomplete="off">
              <kbd aria-hidden="true">Ctrl K</kbd>
            </label>
            <button id="semantic-search-button" class="button button-primary semantic-submit" type="button" hidden>语义搜索</button>
          </div>
          <div class="header-actions" aria-label="主要操作">
            <button id="gif-mode-button" class="button header-action header-action-secondary" type="button" aria-pressed="false">动图模式</button>
            <button id="random-button" class="button header-action header-action-secondary" type="button">随机一个</button>
            <button id="open-download" class="button header-action header-action-secondary" type="button">批量下载</button>
            <button id="open-appearance" class="button header-action header-action-secondary" type="button">外观</button>
            <button id="open-upload" class="button button-primary header-add" type="button">+ 图片上传</button>
            <button id="open-immersive" class="button immersive-entry" type="button" aria-pressed="false">沉浸浏览</button>
            <details id="management-menu" class="management-menu">
              <summary class="management-trigger" aria-label="打开更多功能" title="更多功能">
                <span aria-hidden="true">•••</span>
                <span class="visually-hidden">更多功能</span>
              </summary>
              <div class="management-popover" role="menu" aria-label="更多功能">
                <section>
                  <span class="management-group-label">创作与组织</span>
                  <button id="open-meme-maker" type="button" role="menuitem"><span>Meme 制作器</span><small>组合图片与文字</small></button>
                  <button id="open-collections" type="button" role="menuitem"><span>牌组</span><small>整理常用收藏</small></button>
                  <button id="open-chat-recommendation" type="button" role="menuitem"><span>场景召唤</span><small>按聊天语境找 Meme</small></button>
                </section>
                <section>
                  <span class="management-group-label">资料库管理</span>
                  <button id="browse-templates" type="button" role="menuitem"><span>模板浏览</span><small>搜索并筛选模板</small></button>
                  <button id="open-templates" type="button" role="menuitem"><span>模板管理</span><small>维护视觉模板</small></button>
                  <button id="open-tags" type="button" role="menuitem"><span>标签管理</span><small>整理标签体系</small></button>
                  <button id="open-enrichment" type="button" role="menuitem"><span>元数据整理</span><small>审核分析建议</small></button>
                  <button id="open-vault-inspector" type="button" role="menuitem"><span>宝库巡检</span><small>检查相似与重复内容</small></button>
                </section>
                <section class="admin-only-menu-section">
                  <span class="management-group-label">系统</span>
                  <button id="open-semantic-index" type="button" role="menuitem"><span>语义索引</span><small>索引状态与任务</small></button>
                  <button id="open-settings" type="button" role="menuitem"><span>API 设置</span><small>厂商、模型与密钥</small></button>
                </section>
              </div>
            </details>
          </div>
        </div>
      </header>

      <div id="operation-error" class="operation-error" role="alert" aria-live="assertive" hidden></div>

      <main class="workspace">
        <section class="library" aria-label="Meme 资料库">
          <div id="library-heading" class="section-heading">
            <div>
              <p class="eyebrow">LIBRARY</p>
              <h1>我的 Meme</h1>
              <p class="library-summary">
                <span data-meme-total>0 个 Meme</span>
                <span data-filter-summary hidden></span>
              </p>
            </div>
          </div>
          <div class="library-filter-toolbar" aria-label="资料库筛选">
            <div id="template-filters" class="tag-filters template-filters" aria-label="模板筛选"></div>
            <div id="tag-filters" class="tag-filters" aria-label="标签筛选"></div>
          </div>
          <div id="browsing-controls" class="browsing-controls" aria-label="资料库视图设置">
            <span class="browsing-controls-label">视图</span>
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
            <label>卡片动态效果
              <select data-card-motion-preset aria-label="卡片动态效果">
                <option value="off">关闭</option>
                <option value="subtle">微弱</option>
                <option value="normal">普通</option>
                <option value="strong">强烈</option>
                <option value="drunk">喝了假酒</option>
              </select>
            </label>
          </div>
          <div id="list-status" class="list-status" aria-live="polite"></div>
          <div id="meme-grid" class="meme-grid" data-card-size="medium"></div>
          <div class="infinite-feed-status" data-infinite-feed-status aria-live="polite"></div>
          <div class="infinite-feed-sentinel" data-infinite-feed-sentinel aria-hidden="true"></div>
          <nav id="library-pagination" class="pagination" aria-label="资料库分页"></nav>
        </section>

        <aside id="detail-panel" class="detail-panel" aria-label="Meme 详情"></aside>
      </main>
    </div>

    <nav id="immersive-dock" class="immersive-dock" aria-label="沉浸浏览工具" aria-hidden="true" data-visible="false" tabindex="-1">
      <label class="immersive-search" for="immersive-search-input">
        <span aria-hidden="true">⌕</span>
        <input id="immersive-search-input" type="search" autocomplete="off" placeholder="搜索 Meme…" aria-label="在沉浸模式中搜索 Meme">
      </label>
      <button class="immersive-dock-button" type="button" data-immersive-random aria-label="随机一个 Meme">随机</button>
      <button class="immersive-dock-button" type="button" data-immersive-appearance aria-label="打开外观设置">外观</button>
      <button class="immersive-dock-button" type="button" data-immersive-tuner aria-label="打开 Free Gallery 调参工具" aria-expanded="false">调参</button>
      <button class="immersive-dock-button immersive-exit" type="button" data-exit-immersive aria-label="退出沉浸浏览">退出</button>
    </nav>

    <aside class="gallery-tuner" data-gallery-tuner hidden aria-label="Free Gallery 调参工具"></aside>

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

    <dialog id="appearance-dialog" class="settings-dialog appearance-dialog" aria-labelledby="appearance-title">
      <div class="settings-shell appearance-shell">
        <header class="settings-header">
          <div>
            <p class="eyebrow">APPEARANCE · LOCAL</p>
            <h2 id="appearance-title">外观</h2>
            <p>调整背景、面板材质与氛围。所有设置仅保存在当前浏览器。</p>
          </div>
          <div class="appearance-header-actions">
            <button class="button button-ghost" type="button" data-reset-appearance>恢复默认</button>
            <button class="icon-button" type="button" data-close-appearance aria-label="关闭外观设置">×</button>
          </div>
        </header>
        <div id="appearance-content" class="settings-content appearance-content"></div>
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
            <button class="button button-secondary" type="button" data-viewer-copy>复制当前图</button>
            <button class="button button-secondary" type="button" data-viewer-forge>加入 Meme Forge</button>
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
    appRoot: root,
    topbar: required(root, ".topbar"),
    appearanceBackground: required(root, "[data-appearance-background]"),
    searchInput: required(root, "#meme-search"),
    searchMode: required(root, "#search-mode"),
    semanticSearchButton: required(root, "#semantic-search-button"),
    randomButton: required(root, "#random-button"),
    gifModeButton: required(root, "#gif-mode-button"),
    openUploadButton: required(root, "#open-upload"),
    openMemeMakerButton: required(root, "#open-meme-maker"),
    openDownloadButton: required(root, "#open-download"),
    openSettingsButton: required(root, "#open-settings"),
    openAppearanceButton: required(root, "#open-appearance"),
    openImmersiveButton: required(root, "#open-immersive"),
    openTemplatesButton: required(root, "#open-templates"),
    browseTemplatesButton: required(root, "#browse-templates"),
    openTagsButton: required(root, "#open-tags"),
    openSemanticIndexButton: required(root, "#open-semantic-index"),
    openEnrichmentButton: required(root, "#open-enrichment"),
    openChatRecommendationButton: required(root, "#open-chat-recommendation"),
    openVaultInspectorButton: required(root, "#open-vault-inspector"),
    openCollectionsButton: required(root, "#open-collections"),
    operationError: required(root, "#operation-error"),
    templateFilters: required(root, "#template-filters"),
    tagFilters: required(root, "#tag-filters"),
    libraryHeading: required(root, "#library-heading"),
    browsingControls: required(root, "#browsing-controls"),
    listStatus: required(root, "#list-status"),
    memeGrid: required(root, "#meme-grid"),
    immersiveFeedStatus: required(root, "[data-infinite-feed-status]"),
    immersiveFeedSentinel: required(root, "[data-infinite-feed-sentinel]"),
    managementMenu: required(root, "#management-menu"),
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
    appearanceDialog: required(document, "#appearance-dialog"),
    appearanceContent: required(document, "#appearance-content"),
    immersiveDock: required(root, "#immersive-dock"),
    immersiveSearchInput: required(root, "#immersive-search-input"),
    immersiveRandomButton: required(root, "[data-immersive-random]"),
    immersiveAppearanceButton: required(root, "[data-immersive-appearance]"),
    immersiveTunerButton: required(root, "[data-immersive-tuner]"),
    immersiveTunerPanel: required(root, "[data-gallery-tuner]"),
    immersiveExitButton: required(root, "[data-exit-immersive]"),
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
    imageViewerCopy: required(document, "[data-viewer-copy]"),
    imageViewerForge: required(document, "[data-viewer-forge]"),
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
  elements.gifModeButton.classList.toggle("is-active", state.gifOnly);
  elements.gifModeButton.setAttribute("aria-pressed", String(state.gifOnly));
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

export const TEMPLATE_PAGE_SIZE = 6;

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
  const totalPages = Math.ceil(state.availableTemplates.length / TEMPLATE_PAGE_SIZE);
  const page = clampPage(state.templatePage, totalPages);
  const start = (page - 1) * TEMPLATE_PAGE_SIZE;
  const templates = state.availableTemplates.slice(start, start + TEMPLATE_PAGE_SIZE);
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
const COLLAPSED_TEMPLATE_LIMIT = 8;

export function renderTemplateFilters(elements: AppElements, state: AppState): void {
  if (!state.availableTemplates.length) {
    elements.templateFilters.innerHTML =
      '<span class="filter-kind">模板</span><span class="muted">还没有可筛选的模板</span>';
    return;
  }
  const collapsed = state.availableTemplates.length > COLLAPSED_TEMPLATE_LIMIT;
  const visibleTemplates = state.templatesExpanded
    ? state.availableTemplates
    : state.availableTemplates.filter(
        (template, index) =>
          index < COLLAPSED_TEMPLATE_LIMIT || template.id === state.selectedTemplateId,
      );
  const hiddenCount = state.availableTemplates.length - visibleTemplates.length;
  const allSelected = state.selectedTemplateId === null;
  const templates = visibleTemplates.map((template) => {
    const selected = template.id === state.selectedTemplateId;
    return `<button class="filter-chip${selected ? " is-active" : ""}" type="button" data-template-filter="${template.id}" aria-pressed="${selected}">${escapeHtml(template.name)}</button>`;
  }).join("");
  const toggle = collapsed
    ? `<button class="filter-toggle" type="button" data-expand-templates aria-expanded="${state.templatesExpanded}">${state.templatesExpanded ? "收起模板" : `展开全部模板（+${hiddenCount}）`}</button>`
    : "";
  elements.templateFilters.toggleAttribute("data-expanded", state.templatesExpanded);
  elements.templateFilters.innerHTML = `<span class="filter-kind">模板</span><div class="filter-chip-track"><input type="search" data-template-filter-search placeholder="搜索模板…" aria-label="搜索资料库模板"><div class="filter-chip-scroll"><button class="filter-chip${allSelected ? " is-active" : ""}" type="button" data-template-filter="" aria-pressed="${allSelected}">全部</button>${templates}</div>${toggle}</div>`;
}

export function renderTags(elements: AppElements, state: AppState): void {
  if (!state.availableTags.length) {
    elements.tagFilters.innerHTML =
      '<span class="filter-kind">标签</span><span class="muted">还没有可筛选的标签</span>';
    return;
  }
  const collapsed = state.availableTags.length > COLLAPSED_TAG_LIMIT;
  const query = state.tagSearchQuery.trim().toLocaleLowerCase();
  const defaultVisibleCount = state.availableTags.filter(
    (tag, index) => state.tagsExpanded
      || index < COLLAPSED_TAG_LIMIT
      || state.selectedTags.includes(tag.name),
  ).length;
  const hiddenCount = state.availableTags.length - defaultVisibleCount;
  let matchedCount = 0;
  const tags = state.availableTags
    .map((tag, index) => {
      const selected = state.selectedTags.includes(tag.name);
      const collapsedHidden = !state.tagsExpanded
        && index >= COLLAPSED_TAG_LIMIT
        && !selected;
      const matches = !query || tag.name.toLocaleLowerCase().includes(query);
      if (matches) matchedCount += 1;
      return `
        <button
          class="filter-chip${selected ? " is-active" : ""}"
          type="button"
          data-tag="${escapeHtml(tag.name)}"
          ${collapsedHidden ? "data-collapsed-hidden" : ""}
          ${query ? (matches ? "" : "hidden") : (collapsedHidden ? "hidden" : "")}
          aria-pressed="${selected}"
        ><span>${escapeHtml(tag.name)}</span><small>${tag.usage_count}</small></button>
      `;
    })
    .join("");
  const toggle = collapsed
    ? `
      <button
        class="filter-toggle"
        type="button"
        data-expand-tags
        ${query ? "hidden" : ""}
        aria-expanded="${state.tagsExpanded}"
      >${state.tagsExpanded ? "收起标签" : `展开全部标签（+${hiddenCount}）`}</button>
    `
    : "";
  elements.tagFilters.toggleAttribute("data-expanded", state.tagsExpanded);
  elements.tagFilters.innerHTML = `<span class="filter-kind">标签</span><div class="filter-chip-track"><input type="search" data-tag-filter-search value="${escapeHtml(state.tagSearchQuery)}" placeholder="搜索标签…" aria-label="搜索资料库标签"><div class="filter-chip-scroll">${tags}<span class="filter-search-empty muted" data-tag-search-empty ${matchedCount ? "hidden" : ""}>没有匹配的标签</span></div>${toggle}</div>`;
}

export function memeCardMarkup(
  meme: MemeResponse,
  selected: boolean,
  cardSize: MemeCardSize,
  score?: number,
  showQuickActions = true,
  preferThumbnail = false,
): string {
  const thumbnail = meme.thumbnail_url ?? meme.image_url;
  const image = !preferThumbnail && cardSize === "extra-large" ? meme.image_url : thumbnail;
  const copySource = memeCopySource(meme);
  const isGif = (meme.images[0]?.mime_type ?? meme.mime_type)
    .toLowerCase().startsWith("image/gif");
  const focusImages = meme.images?.length
    ? meme.images
    : [{
        image_url: meme.image_url,
        thumbnail_url: meme.thumbnail_url,
        width: meme.width,
        height: meme.height,
      }];
  const focusManifest = focusImages.map((media, index) => `
    <span
      data-focus-media
      data-thumbnail-src="${escapeHtml(media.thumbnail_url ?? media.image_url)}"
      data-original-src="${escapeHtml(media.image_url)}"
      data-width="${media.width}"
      data-height="${media.height}"
      data-alt="${escapeHtml(`${meme.title} ${index + 1}/${focusImages.length}`)}"
    ></span>
  `).join("");
  return `
    <div class="immersive-layout-item gallery-layout-item" data-immersive-layout-id="${meme.id}">
      <div class="meme-card-physics">
        <article
          class="meme-card${selected ? " is-selected" : ""}"
          data-meme-id="${meme.id}"
          data-card-width="${meme.width}"
          data-card-height="${meme.height}"
          data-card-image-count="${meme.image_count}"
        >
          ${selected ? '<span class="card-selected-indicator" aria-hidden="true">✓</span>' : ""}
          <button class="meme-card-main" type="button" data-open-meme aria-label="查看 ${escapeHtml(meme.title)}">
            <span class="card-image">
              <img data-card-image data-thumbnail-src="${escapeHtml(thumbnail)}" data-original-src="${escapeHtml(meme.image_url)}" src="${escapeHtml(image)}" alt="${escapeHtml(meme.title)}" width="${meme.width}" height="${meme.height}" loading="lazy">
              <span class="image-fallback" aria-hidden="true">图片不可用</span>
              ${isGif || meme.image_count > 1 ? `<span class="card-media-badges">${isGif ? '<span class="media-type-badge">GIF</span>' : ""}${meme.image_count > 1 ? `<span class="image-count-badge">${meme.image_count} 张</span>` : ""}</span>` : ""}
            </span>
            <span class="card-overlay"><strong>${escapeHtml(meme.title)}</strong>${score === undefined ? "" : `<span class="semantic-score">相关度 ${score.toFixed(3)}</span>`}<span class="card-tags">${tagMarkup(meme.tags.map((tag) => tag.name))}</span></span>
          </button>
          ${showQuickActions ? `<span class="meme-card-quick-actions" aria-label="快捷操作">
            ${copySource ? `<button type="button" data-copy-meme="${meme.id}" ${isGif ? 'disabled title="不支持直接复制 GIF，请使用下载"' : ""}>${isGif ? "GIF" : "复制"}</button>` : ""}
            <a href="/api/memes/${meme.id}/download" data-quick-download="${meme.id}">下载</a>
          </span>` : ""}
          <template data-focus-media-manifest>${focusManifest}</template>
        </article>
      </div>
    </div>
  `;
}

function bindImageFallbacks(container: ParentNode): void {
  for (const image of container.querySelectorAll<HTMLImageElement>("img")) {
    image.addEventListener("error", () => {
      image.hidden = true;
      image.parentElement?.classList.add("is-broken");
      if (image.currentSrc.includes("/media/") || image.src.includes("/media/")) {
        probeAuthAfterMediaError();
      }
    });
  }
}

export function renderLibrary(
  elements: AppElements,
  state: AppState,
): void {
  applyMemeCardSize(elements, state.cardSize);
  elements.memeGrid.setAttribute("aria-busy", String(state.loadingList));
  const total = new Intl.NumberFormat("zh-CN").format(state.totalMemes);
  const totalNode = elements.libraryHeading.querySelector<HTMLElement>("[data-meme-total]");
  if (totalNode) totalNode.textContent = `${total} 个 Meme`;
  const filterSummary = elements.libraryHeading.querySelector<HTMLElement>("[data-filter-summary]");
  if (filterSummary) {
    const parts = [
      state.selectedTemplateId === null ? "" : "1 个模板",
      state.selectedTags.length ? `${state.selectedTags.length} 个标签` : "",
    ].filter(Boolean);
    filterSummary.hidden = parts.length === 0;
    filterSummary.textContent = parts.length ? `· ${parts.join(" · ")}` : "";
  }
  const sort = elements.browsingControls.querySelector<HTMLSelectElement>("[data-list-sort]");
  const pageSize = elements.browsingControls.querySelector<HTMLSelectElement>("[data-page-size]");
  const cardSize = elements.browsingControls.querySelector<HTMLSelectElement>("[data-card-size]");
  const cardMotionPreset = elements.browsingControls.querySelector<HTMLSelectElement>("[data-card-motion-preset]");
  const reshuffle = elements.browsingControls.querySelector<HTMLButtonElement>("[data-reshuffle]");
  elements.searchMode.value = state.searchMode;
  elements.semanticSearchButton.hidden = state.searchMode !== "semantic";
  elements.searchInput.placeholder = state.searchMode === "semantic"
    ? "描述想找的场景、情绪或用途…"
    : "搜索你的 Vault…";
  if (sort) {
    sort.value = state.listSort;
    sort.disabled = state.loadingList || state.searchMode === "semantic";
    const label = sort.closest("label");
    if (label) label.hidden = state.searchMode === "semantic";
  }
  if (pageSize) { pageSize.value = String(state.pageSize); pageSize.disabled = state.loadingList; }
  if (cardSize) cardSize.value = state.cardSize;
  if (cardMotionPreset) cardMotionPreset.value = storedCardMotionPreset();
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
    const hasActiveFilter = Boolean(
      state.query
      || state.selectedTags.length
      || state.selectedTemplateId !== null,
    );
    if (state.memes.length) {
      elements.listStatus.textContent = `第 ${state.page} / ${state.totalPages} 页`;
    } else if (hasActiveFilter) {
      elements.listStatus.innerHTML = `
        <div class="library-empty-state">
          <strong>没有找到 Meme</strong>
          <span>换个关键词，或者清除当前筛选后再看看。</span>
          <button class="button button-secondary" type="button" data-clear-library-filters>清除筛选</button>
        </div>
      `;
    } else {
      elements.listStatus.innerHTML = `
        <div class="library-empty-state">
          <strong>Vault 还是空的</strong>
          <span>上传第一张 Meme，开始建立你的私人收藏。</span>
          <button class="button button-primary" type="button" data-empty-upload>上传第一张 Meme</button>
        </div>
      `;
    }
    elements.memeGrid.innerHTML = state.memes
      .map((meme) => memeCardMarkup(
        meme,
        meme.id === state.selectedMeme?.id,
        state.cardSize,
        state.searchMode === "semantic" ? state.semanticScores[meme.id] : undefined,
      ))
      .join("");
    bindImageFallbacks(elements.memeGrid);
    bindMemeCardTilts(elements.memeGrid);
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

export function renderImmersiveFeed(
  elements: AppElements,
  memes: readonly MemeResponse[],
  selectedMemeId: number | null,
  scores: Readonly<Record<number, number>> = {},
): void {
  const cardSize = (elements.memeGrid.dataset.cardSize as MemeCardSize | undefined) ?? "medium";
  elements.memeGrid.innerHTML = memes.map(meme => memeCardMarkup(
    meme,
    meme.id === selectedMemeId,
    cardSize,
    scores[meme.id],
    true,
    true,
  )).join("");
  bindImageFallbacks(elements.memeGrid);
  bindMemeCardTilts(elements.memeGrid);
}

export function appendImmersiveFeed(
  elements: AppElements,
  memes: readonly MemeResponse[],
  selectedMemeId: number | null,
  scores: Readonly<Record<number, number>> = {},
): void {
  if (!memes.length) return;
  const cardSize = (elements.memeGrid.dataset.cardSize as MemeCardSize | undefined) ?? "medium";
  const template = document.createElement("template");
  template.innerHTML = memes.map(meme => memeCardMarkup(
    meme,
    meme.id === selectedMemeId,
    cardSize,
    scores[meme.id],
    true,
    true,
  )).join("");
  bindImageFallbacks(template.content);
  elements.memeGrid.append(template.content);
  bindMemeCardTilts(elements.memeGrid);
}

export function renderInfiniteFeedState(
  elements: AppElements,
  state: Readonly<InfiniteFeedState>,
): void {
  elements.immersiveFeedSentinel.hidden = !state.hasMore || Boolean(state.error)
    || (state.offset === 0 && state.loading);
  if (state.error) {
    elements.immersiveFeedStatus.innerHTML = `
      <span>${escapeHtml(state.error)}</span>
      <button class="button button-secondary" type="button" data-retry-infinite-feed>重试</button>
    `;
  } else if (state.loading) {
    elements.immersiveFeedStatus.innerHTML = state.offset
      ? '<span class="status-line"><span class="infinite-feed-pulse" aria-hidden="true"></span>继续翻找 Meme…</span>'
      : '<span class="status-line"><span class="infinite-feed-pulse" aria-hidden="true"></span>正在打开沉浸宝库…</span>';
  } else if (state.offset === 0 && !state.hasMore) {
    elements.immersiveFeedStatus.textContent = "这里暂时没有 Meme。";
  } else if (!state.hasMore) {
    elements.immersiveFeedStatus.textContent = "已经翻到 Vault 最深处了。";
  } else {
    elements.immersiveFeedStatus.textContent = "";
  }
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
  template.innerHTML = memeCardMarkup(meme, selected, size ?? "medium").trim();
  const replacement = template.content.firstElementChild;
  if (!(replacement instanceof HTMLElement)) {
    return;
  }
  const currentItem = current.closest<HTMLElement>(".immersive-layout-item") ?? current;
  if (currentItem.dataset.galleryOrder) {
    replacement.dataset.galleryOrder = currentItem.dataset.galleryOrder;
  }
  currentItem.replaceWith(replacement);
  bindImageFallbacks(replacement);
  bindMemeCardTilts(elements.memeGrid);
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
  const isVisitor = document.documentElement.dataset.authRole === "visitor";
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
          <section class="detail-primary">
            <div class="detail-heading">
              <div>
                <p class="eyebrow">MEME <span class="detail-id">#${meme.id}</span></p>
                <h2 data-detail-title>${escapeHtml(meme.title)}</h2>
                <p class="detail-filename">${escapeHtml(meme.original_filename)}</p>
              </div>
            </div>
            <div class="detail-tags">${tagMarkup(meme.tags.map((tag) => tag.name))}</div>
            <p class="detail-description">${escapeHtml(meme.description || "暂无描述")}</p>
          </section>
          <section class="detail-section detail-metadata">
            <p class="detail-section-label">信息</p>
            <dl class="metadata">
              <div><dt>来源</dt><dd>${escapeHtml(meme.source || "未填写")}</dd></div>
              <div><dt>模板</dt><dd>${escapeHtml(meme.template?.name || "未归类")}</dd></div>
              <div><dt>尺寸</dt><dd>${meme.width} × ${meme.height}</dd></div>
              <div><dt>文件</dt><dd>${formatFileSize(meme.file_size)} · ${escapeHtml(meme.mime_type)}</dd></div>
              <div><dt>创建</dt><dd>${escapeHtml(formatDate(meme.created_at))}</dd></div>
              <div><dt>更新</dt><dd>${escapeHtml(formatDate(meme.updated_at))}</dd></div>
            </dl>
          </section>
          <section class="detail-section detail-action-section">
            <p class="detail-section-label">操作</p>
            <div class="detail-actions">
              ${meme.image_count === 1 ? '<button class="button button-secondary" type="button" data-copy-detail>复制图片</button>' : '<button class="button button-secondary" type="button" data-open-viewer data-image-index="0">选择图片复制</button>'}
              <a class="button button-secondary" href="${escapeHtml(meme.image_url)}" target="_blank" rel="noopener noreferrer">打开原图</a>
              ${meme.image_count === 1 || !isVisitor ? `<a class="button button-secondary" href="/api/memes/${meme.id}/download" data-download-meme>${meme.image_count > 1 ? "下载图片组" : "下载图片"}</a>` : ""}
              ${isVisitor ? "" : '<button class="button button-secondary" type="button" data-manage-meme-collections>加入牌组</button><button class="button button-secondary" type="button" data-edit-meme>编辑</button>'}
            </div>
          </section>
          ${relatedMemesMarkup(state)}
          ${similarMemesMarkup(state)}
          ${isVisitor ? "" : aiAnalysisMarkup(state)}
          <div data-caption-lab-host></div>
          ${detailError(state.actionError)}
          ${isVisitor ? "" : `<section class="detail-danger-zone">
            <div>
              <strong>删除 Meme</strong>
              <span>此操作会同时删除资料记录与本地图片。</span>
            </div>
            <button class="button button-danger" type="button" data-delete-meme ${state.deleting ? "disabled" : ""}>
              ${state.deleting ? "正在删除…" : "删除"}
            </button>
          </section>`}
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
  elements.imageViewerCopy.disabled = false;
  elements.imageViewerCopy.textContent = "复制当前图";
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
