import type { AppState, MemeResponse } from "./types";

export interface EditDraft {
  title: string;
  description: string;
  source: string;
  tags: string;
}

export interface AppElements {
  searchInput: HTMLInputElement;
  randomButton: HTMLButtonElement;
  openUploadButton: HTMLButtonElement;
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
        <p id="upload-error" class="form-error" role="alert" hidden></p>
        <div class="modal-actions">
          <button class="button button-ghost" type="button" data-close-upload>取消</button>
          <button id="upload-submit" class="button button-primary" type="submit">开始上传</button>
        </div>
      </form>
    </dialog>
  `;

  return {
    searchInput: required(root, "#meme-search"),
    randomButton: required(root, "#random-button"),
    openUploadButton: required(root, "#open-upload"),
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

export function renderTags(elements: AppElements, state: AppState): void {
  if (!state.availableTags.length) {
    elements.tagFilters.innerHTML =
      '<span class="muted">还没有可筛选的标签</span>';
    return;
  }
  elements.tagFilters.innerHTML = state.availableTags
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
    <div class="detail-image">
      <img src="${escapeHtml(meme.image_url)}" alt="${escapeHtml(meme.title)}">
      <span class="image-fallback" aria-hidden="true">原图不可用</span>
    </div>
  `;
}

function detailError(message: string | null): string {
  return message
    ? `<p class="form-error detail-error" role="alert" data-action-error>${escapeHtml(message)}</p>`
    : "";
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
            <div><dt>尺寸</dt><dd>${meme.width} × ${meme.height}</dd></div>
            <div><dt>文件</dt><dd>${formatFileSize(meme.file_size)} · ${escapeHtml(meme.mime_type)}</dd></div>
            <div><dt>创建</dt><dd>${escapeHtml(formatDate(meme.created_at))}</dd></div>
            <div><dt>更新</dt><dd>${escapeHtml(formatDate(meme.updated_at))}</dd></div>
          </dl>
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
