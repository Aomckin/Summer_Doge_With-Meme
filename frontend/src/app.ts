import {
  ApiError,
  analyzeMeme,
  confirmAIAnalysis,
  createAIModel,
  createAIProvider,
  deleteMeme,
  deleteAIModel,
  deleteAIProvider,
  getRandomMeme,
  listAIModels,
  listAIProviderPresets,
  listAIProviders,
  listMemes,
  listTags,
  parseTagInput,
  refreshAIModels,
  testAIProvider,
  updateAIModel,
  updateAIProvider,
  updateMeme,
  uploadMeme,
} from "./api";
import type {
  AIAnalysisConfirmPayload,
  AIAnalysisResponse,
  AppState,
  ListMemesOptions,
  MemeResponse,
  MemeUpdatePayload,
  TagResponse,
  UploadMemeInput,
} from "./types";
import {
  AISettingsController,
  type AISettingsApi,
} from "./settings";
import {
  type AppElements,
  type EditDraft,
  closeImageViewer,
  mountShell,
  openImageViewer,
  renderDetail,
  renderLibrary,
  renderOperationError,
  renderTags,
  renderToolbar,
  setUploadBusy,
} from "./ui";

const PAGE_SIZE = 24;

export interface MemeApi extends AISettingsApi {
  listMemes(options: ListMemesOptions): Promise<MemeResponse[]>;
  listTags(signal?: AbortSignal): Promise<TagResponse[]>;
  getRandomMeme(tags: string[], signal?: AbortSignal): Promise<MemeResponse>;
  uploadMeme(input: UploadMemeInput): Promise<MemeResponse>;
  updateMeme(
    id: number,
    payload: MemeUpdatePayload,
  ): Promise<MemeResponse>;
  deleteMeme(id: number): Promise<void>;
  analyzeMeme(id: number): Promise<AIAnalysisResponse>;
  confirmAIAnalysis(
    memeId: number,
    analysisId: number,
    payload: AIAnalysisConfirmPayload,
  ): Promise<MemeResponse>;
}

const defaultApi: MemeApi = {
  listMemes,
  listTags,
  getRandomMeme,
  uploadMeme,
  updateMeme,
  deleteMeme,
  analyzeMeme,
  confirmAIAnalysis,
  listAIProviderPresets,
  listAIProviders,
  createAIProvider,
  updateAIProvider,
  deleteAIProvider,
  testAIProvider,
  refreshAIModels,
  listAIModels,
  createAIModel,
  updateAIModel,
  deleteAIModel,
};

function initialState(): AppState {
  return {
    memes: [],
    availableTags: [],
    selectedMeme: null,
    query: "",
    selectedTags: [],
    tagsExpanded: false,
    offset: 0,
    hasMore: false,
    loadingList: false,
    loadingMore: false,
    uploading: false,
    saving: false,
    deleting: false,
    randomizing: false,
    analyzing: false,
    confirmingAnalysis: false,
    aiAnalysis: null,
    selectedAITags: [],
    applyAIDescription: false,
    aiError: null,
    listError: null,
    loadMoreError: null,
    actionError: null,
    operationError: null,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function readableError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "网络请求失败，请稍后重试。";
}

function value(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement
  ) {
    return field.value;
  }
  return "";
}

export class MemeVaultApp {
  private readonly elements: AppElements;
  private readonly state = initialState();
  private listController: AbortController | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private editing = false;
  private editDraft: EditDraft | null = null;
  private uploadError: string | null = null;
  private readonly settings: AISettingsController;

  constructor(
    root: HTMLElement,
    private readonly api: MemeApi = defaultApi,
  ) {
    this.elements = mountShell(root);
    this.settings = new AISettingsController(this.elements, this.api);
    this.bindEvents();
    this.render();
  }

  async start(): Promise<void> {
    await Promise.all([this.reloadMemes(), this.refreshTags()]);
  }

  private bindEvents(): void {
    this.elements.searchInput.addEventListener("input", () => {
      if (this.searchTimer) {
        clearTimeout(this.searchTimer);
      }
      this.searchTimer = setTimeout(() => {
        this.state.query = this.elements.searchInput.value.trim();
        void this.reloadMemes();
      }, 300);
    });

    this.elements.tagFilters.addEventListener("click", (event) => {
      const target = (event.target as Element).closest<HTMLButtonElement>(
        "button",
      );
      if (!target) {
        return;
      }
      if (target.matches("[data-expand-tags]")) {
        this.state.tagsExpanded = !this.state.tagsExpanded;
        renderTags(this.elements, this.state);
        return;
      }
      if (!target.dataset.tag) {
        return;
      }
      const tag = target.dataset.tag;
      this.state.selectedTags = this.state.selectedTags.includes(tag)
        ? this.state.selectedTags.filter((name) => name !== tag)
        : [...this.state.selectedTags, tag];
      renderTags(this.elements, this.state);
      void this.reloadMemes();
    });

    this.elements.memeGrid.addEventListener("click", (event) => {
      const target = (event.target as Element).closest<HTMLButtonElement>(
        "[data-meme-id]",
      );
      const id = Number(target?.dataset.memeId);
      const meme = this.state.memes.find((item) => item.id === id);
      if (meme) {
        this.selectMeme(meme);
      }
    });

    this.elements.listStatus.addEventListener("click", (event) => {
      const target = event.target as Element;
      if (target.closest("[data-retry-list]")) {
        void this.reloadMemes();
      } else if (target.closest("[data-retry-more]")) {
        void this.loadMore();
      }
    });

    this.elements.loadMoreButton.addEventListener("click", () => {
      void this.loadMore();
    });
    this.elements.randomButton.addEventListener("click", () => {
      void this.randomize();
    });
    this.elements.openUploadButton.addEventListener("click", () => {
      this.openUpload();
    });
    this.elements.openSettingsButton.addEventListener("click", () => {
      this.settings.open();
    });
    for (const button of document.querySelectorAll("[data-close-upload]")) {
      button.addEventListener("click", () => this.closeUpload());
    }
    this.elements.uploadForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitUpload();
    });

    this.elements.detailPanel.addEventListener("click", (event) => {
      const target = event.target as Element;
      if (target.closest("[data-open-viewer]")) {
        const meme = this.state.selectedMeme;
        if (meme) {
          openImageViewer(this.elements, meme);
        }
      } else if (target.closest("[data-edit-meme]")) {
        this.beginEdit();
      } else if (target.closest("[data-cancel-edit]")) {
        this.cancelEdit();
      } else if (target.closest("[data-delete-meme]")) {
        void this.removeSelected();
      } else if (target.closest("[data-analyze-meme]")) {
        void this.analyzeSelected();
      } else if (target.closest("[data-confirm-ai]")) {
        void this.confirmAnalysis();
      }
    });
    this.elements.detailPanel.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      const tag = target.dataset.aiTag;
      if (tag) {
        this.state.selectedAITags = target.checked
          ? [...new Set([...this.state.selectedAITags, tag])]
          : this.state.selectedAITags.filter((name) => name !== tag);
      } else if (target.matches("[data-ai-description]")) {
        this.state.applyAIDescription = target.checked;
      }
    });
    this.elements.detailPanel.addEventListener("submit", (event) => {
      const form = (event.target as Element).closest<HTMLFormElement>(
        "#edit-form",
      );
      if (!form) {
        return;
      }
      event.preventDefault();
      void this.submitEdit(form);
    });

    this.elements.imageViewerDialog.addEventListener("click", (event) => {
      if (event.target === this.elements.imageViewerDialog) {
        closeImageViewer(this.elements);
      }
    });
    this.elements.imageViewerDialog
      .querySelector("[data-close-viewer]")
      ?.addEventListener("click", () => closeImageViewer(this.elements));
    this.elements.imageViewerImage.addEventListener("error", () => {
      this.elements.imageViewerImage.hidden = true;
      this.elements.imageViewerFrame.classList.add("is-broken");
      this.elements.imageViewerError.textContent = "原图加载失败";
      this.elements.imageViewerError.hidden = false;
    });
  }

  private render(): void {
    renderToolbar(this.elements, this.state);
    renderOperationError(this.elements, this.state);
    renderTags(this.elements, this.state);
    renderLibrary(this.elements, this.state);
    renderDetail(
      this.elements,
      this.state,
      this.editing,
      this.editDraft,
    );
    setUploadBusy(
      this.elements,
      this.state.uploading,
      this.uploadError,
    );
  }

  private async reloadMemes(): Promise<void> {
    this.listController?.abort();
    const controller = new AbortController();
    this.listController = controller;
    this.state.loadingList = true;
    this.state.loadingMore = false;
    this.state.listError = null;
    this.state.loadMoreError = null;
    this.state.memes = [];
    this.state.offset = 0;
    this.state.hasMore = false;
    renderLibrary(this.elements, this.state);

    try {
      const memes = await this.api.listMemes({
        offset: 0,
        limit: PAGE_SIZE,
        q: this.state.query,
        tags: this.state.selectedTags,
        signal: controller.signal,
      });
      if (this.listController !== controller) {
        return;
      }
      this.state.memes = memes;
      this.state.offset = memes.length;
      this.state.hasMore = memes.length === PAGE_SIZE;
    } catch (error) {
      if (isAbortError(error) || this.listController !== controller) {
        return;
      }
      this.state.listError = readableError(error);
    } finally {
      if (this.listController === controller) {
        this.state.loadingList = false;
        renderLibrary(this.elements, this.state);
      }
    }
  }

  private async loadMore(): Promise<void> {
    if (
      this.state.loadingList ||
      this.state.loadingMore ||
      !this.state.hasMore
    ) {
      return;
    }
    const controller = new AbortController();
    this.listController?.abort();
    this.listController = controller;
    this.state.loadingMore = true;
    this.state.loadMoreError = null;
    renderLibrary(this.elements, this.state);

    try {
      const memes = await this.api.listMemes({
        offset: this.state.offset,
        limit: PAGE_SIZE,
        q: this.state.query,
        tags: this.state.selectedTags,
        signal: controller.signal,
      });
      if (this.listController !== controller) {
        return;
      }
      const knownIds = new Set(this.state.memes.map((meme) => meme.id));
      this.state.memes.push(
        ...memes.filter((meme) => !knownIds.has(meme.id)),
      );
      this.state.offset += memes.length;
      this.state.hasMore = memes.length === PAGE_SIZE;
    } catch (error) {
      if (!isAbortError(error) && this.listController === controller) {
        this.state.loadMoreError = readableError(error);
      }
    } finally {
      if (this.listController === controller) {
        this.state.loadingMore = false;
        renderLibrary(this.elements, this.state);
      }
    }
  }

  private async refreshTags(): Promise<void> {
    try {
      this.state.availableTags = await this.api.listTags();
      renderTags(this.elements, this.state);
    } catch (error) {
      this.state.actionError = readableError(error);
      renderDetail(
        this.elements,
        this.state,
        this.editing,
        this.editDraft,
      );
    }
  }

  private selectMeme(meme: MemeResponse): void {
    this.state.selectedMeme = meme;
    this.state.actionError = null;
    this.state.operationError = null;
    this.editing = false;
    this.editDraft = null;
    this.resetAIAnalysis();
    renderLibrary(this.elements, this.state);
    renderDetail(this.elements, this.state, false, null);
  }

  private async randomize(): Promise<void> {
    if (this.state.randomizing) {
      return;
    }
    this.state.randomizing = true;
    this.state.actionError = null;
    renderToolbar(this.elements, this.state);
    try {
      const meme = await this.api.getRandomMeme(this.state.selectedTags);
      this.selectMeme(meme);
    } catch (error) {
      this.state.actionError = readableError(error);
      renderDetail(
        this.elements,
        this.state,
        this.editing,
        this.editDraft,
      );
    } finally {
      this.state.randomizing = false;
      renderToolbar(this.elements, this.state);
    }
  }

  private openUpload(): void {
    this.uploadError = null;
    this.elements.uploadForm.reset();
    setUploadBusy(this.elements, false, null);
    this.elements.uploadDialog.showModal();
  }

  private closeUpload(): void {
    if (!this.state.uploading) {
      this.elements.uploadDialog.close();
    }
  }

  private async submitUpload(): Promise<void> {
    if (this.state.uploading) {
      return;
    }
    const file = this.elements.uploadFile.files?.[0];
    const title = value(this.elements.uploadForm, "title").trim();
    if (!file || !title) {
      this.uploadError = "请选择图片并填写标题。";
      setUploadBusy(this.elements, false, this.uploadError);
      return;
    }

    this.state.uploading = true;
    this.uploadError = null;
    setUploadBusy(this.elements, true, null);
    try {
      const created = await this.api.uploadMeme({
        file,
        title,
        description: value(this.elements.uploadForm, "description"),
        source: value(this.elements.uploadForm, "source"),
        tags: parseTagInput(value(this.elements.uploadForm, "tags")),
      });
      this.elements.uploadDialog.close();
      this.elements.uploadForm.reset();
      this.selectMeme(created);
      await Promise.all([this.refreshTags(), this.reloadMemes()]);
      this.selectMeme(created);
    } catch (error) {
      this.uploadError = readableError(error);
    } finally {
      this.state.uploading = false;
      setUploadBusy(
        this.elements,
        false,
        this.uploadError,
      );
      renderToolbar(this.elements, this.state);
    }
  }

  private beginEdit(): void {
    const meme = this.state.selectedMeme;
    if (!meme) {
      return;
    }
    this.editing = true;
    this.state.actionError = null;
    this.editDraft = {
      title: meme.title,
      description: meme.description ?? "",
      source: meme.source ?? "",
      tags: meme.tags.map((tag) => tag.name).join(", "),
    };
    renderDetail(
      this.elements,
      this.state,
      this.editing,
      this.editDraft,
    );
  }

  private cancelEdit(): void {
    this.editing = false;
    this.editDraft = null;
    this.state.actionError = null;
    renderDetail(this.elements, this.state, false, null);
  }

  private async submitEdit(form: HTMLFormElement): Promise<void> {
    const meme = this.state.selectedMeme;
    if (!meme || this.state.saving) {
      return;
    }
    const title = value(form, "title").trim();
    if (!title) {
      this.state.actionError = "标题不能为空。";
      renderDetail(
        this.elements,
        this.state,
        this.editing,
        this.editDraft,
      );
      return;
    }

    this.editDraft = {
      title,
      description: value(form, "description"),
      source: value(form, "source"),
      tags: value(form, "tags"),
    };
    const payload: MemeUpdatePayload = {
      title,
      description: this.editDraft.description.trim() || null,
      source: this.editDraft.source.trim() || null,
      tags: parseTagInput(this.editDraft.tags),
    };
    this.state.saving = true;
    this.state.actionError = null;
    this.state.operationError = null;
    renderOperationError(this.elements, this.state);
    renderDetail(
      this.elements,
      this.state,
      this.editing,
      this.editDraft,
    );

    try {
      const targetId = meme.id;
      const updated = await this.api.updateMeme(targetId, payload);
      this.replaceMeme(updated);
      if (this.state.selectedMeme?.id === targetId) {
        this.editing = false;
        this.editDraft = null;
      }
      await Promise.all([this.refreshTags(), this.reloadMemes()]);
    } catch (error) {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.actionError = readableError(error);
      } else {
        this.state.operationError = readableError(error);
      }
    } finally {
      this.state.saving = false;
      renderOperationError(this.elements, this.state);
      renderLibrary(this.elements, this.state);
      renderDetail(
        this.elements,
        this.state,
        this.editing,
        this.editDraft,
      );
    }
  }

  private replaceMeme(updated: MemeResponse): void {
    if (this.state.selectedMeme?.id === updated.id) {
      this.state.selectedMeme = updated;
    }
    const index = this.state.memes.findIndex(
      (meme) => meme.id === updated.id,
    );
    if (index >= 0) {
      this.state.memes[index] = updated;
    }
  }

  private resetAIAnalysis(): void {
    this.state.analyzing = false;
    this.state.confirmingAnalysis = false;
    this.state.aiAnalysis = null;
    this.state.selectedAITags = [];
    this.state.applyAIDescription = false;
    this.state.aiError = null;
  }

  private async analyzeSelected(): Promise<void> {
    const meme = this.state.selectedMeme;
    if (!meme || this.state.analyzing || this.state.confirmingAnalysis) {
      return;
    }
    this.state.analyzing = true;
    this.state.aiError = null;
    renderDetail(this.elements, this.state, this.editing, this.editDraft);
    try {
      const analysis = await this.api.analyzeMeme(meme.id);
      if (this.state.selectedMeme?.id !== meme.id) {
        return;
      }
      this.state.aiAnalysis = analysis;
      this.state.selectedAITags = analysis.suggestions.map(
        (suggestion) => suggestion.name,
      );
      this.state.applyAIDescription = !meme.description;
    } catch (error) {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.aiError = readableError(error);
      }
    } finally {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.analyzing = false;
        renderDetail(
          this.elements,
          this.state,
          this.editing,
          this.editDraft,
        );
      }
    }
  }

  private async confirmAnalysis(): Promise<void> {
    const meme = this.state.selectedMeme;
    const analysis = this.state.aiAnalysis;
    if (
      !meme ||
      !analysis ||
      this.state.analyzing ||
      this.state.confirmingAnalysis
    ) {
      return;
    }
    this.state.confirmingAnalysis = true;
    this.state.aiError = null;
    renderDetail(this.elements, this.state, this.editing, this.editDraft);
    try {
      const updated = await this.api.confirmAIAnalysis(
        meme.id,
        analysis.id,
        {
          tags: this.state.selectedAITags,
          apply_description: this.state.applyAIDescription,
        },
      );
      if (this.state.selectedMeme?.id !== meme.id) {
        return;
      }
      this.replaceMeme(updated);
      this.state.aiAnalysis = null;
      this.state.selectedAITags = [];
      this.state.applyAIDescription = false;
      await this.refreshTags();
    } catch (error) {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.aiError = readableError(error);
      }
    } finally {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.confirmingAnalysis = false;
        renderTags(this.elements, this.state);
        renderLibrary(this.elements, this.state);
        renderDetail(
          this.elements,
          this.state,
          this.editing,
          this.editDraft,
        );
      }
    }
  }

  private async removeSelected(): Promise<void> {
    const meme = this.state.selectedMeme;
    if (
      !meme ||
      this.state.deleting ||
      !confirm(`确定删除“${meme.title}”吗？此操作无法撤销。`)
    ) {
      return;
    }

    this.state.deleting = true;
    this.state.actionError = null;
    this.state.operationError = null;
    renderOperationError(this.elements, this.state);
    renderDetail(this.elements, this.state, false, null);
    try {
      const targetId = meme.id;
      await this.api.deleteMeme(targetId);
      if (this.state.selectedMeme?.id === targetId) {
        this.state.selectedMeme = null;
        this.editing = false;
        this.editDraft = null;
        this.resetAIAnalysis();
      }
      await this.reloadMemes();
    } catch (error) {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.actionError = readableError(error);
      } else {
        this.state.operationError = readableError(error);
      }
    } finally {
      this.state.deleting = false;
      renderOperationError(this.elements, this.state);
      renderLibrary(this.elements, this.state);
      renderDetail(
        this.elements,
        this.state,
        this.editing,
        this.editDraft,
      );
    }
  }
}
