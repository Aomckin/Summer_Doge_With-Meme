import {
  ApiError,
  analyzeMeme,
  confirmAIAnalysis,
  createCaption,
  createAIModel,
  createAIProvider,
  createTemplate,
  createTemplateWithReferenceImage,
  deleteMeme,
  deleteTag,
  deleteAIModel,
  deleteAIProvider,
  deleteTemplate,
  deleteTemplateReferenceImage,
  deleteCaption,
  getRandomMeme,
  listAIModels,
  listAIProviderPresets,
  listAIProviders,
  listMemePage,
  listMemes,
  listTags,
  mergeTag,
  renameTag,
  cleanupEmptyTags,
  listTemplates,
  listCaptions,
  refreshAIModels,
  generateCaptions,
  rewriteCaption,
  testAIProvider,
  updateAIModel,
  updateAIProvider,
  updateTemplate,
  updateCaption,
  uploadTemplateReferenceImage,
  updateMeme,
  uploadMeme,
  createImportJob, getImportJob, listImportJobItems, cancelImportJob, retryFailedImportJob, deleteImportJob,
  createExportJob, getExportJob, listExportJobItems, cancelExportJob, deleteExportJob,
  appendMemeImage, deleteMemeImage, reorderMemeImages,
  listMemeRelations, addMemeRelations, deleteMemeRelation,
} from "./api";
import type {
  AIAnalysisConfirmPayload,
  AIAnalysisResponse,
  AppState,
  ListMemePageOptions,
  ListMemesOptions,
  MemeCardSize,
  MemePageResponse,
  MemePageSize,
  ListTagsOptions,
  MemeResponse,
  MemeUpdatePayload,
  TagResponse,
  TagCleanupResponse,
  TemplateCreatePayload,
  TemplateResponse,
  TemplateUpdatePayload,
  UploadMemeInput,
  CreateImportJobInput, ImportJobItemPage, ImportJobResponse,
  CreateExportJobInput, ExportJobItemPage, ExportJobResponse,
} from "./types";
import { BatchUploadController } from "./batch-upload";
import { BatchDownloadController } from "./batch-download";
import { TagEditor } from "./tag-editor";
import {
  TagManagerController,
  type TagMutation,
} from "./tag-manager";
import {
  CaptionLabController,
  type CaptionLabApi,
} from "./caption-lab";
import {
  AISettingsController,
  type AISettingsApi,
} from "./settings";
import {
  type AppElements,
  type EditDraft,
  applyMemeCardSize,
  closeImageViewer,
  mountShell,
  openImageViewer,
  renderDetail,
  renderLibrary,
  renderMemeCard,
  renderOperationError,
  renderRelationDialog,
  renderTags,
  renderTemplateManager,
  renderTemplateReferenceInputPreview,
  renderToolbar,
} from "./ui";
import { clampPage } from "./pagination";

const PAGE_SIZE_KEY = "meme-vault.page-size";
const CARD_SIZE_KEY = "meme-vault.card-size";
const SHUFFLE_MODULUS = 2_147_483_647;

function storedPageSize(): MemePageSize {
  const value = Number(localStorage.getItem(PAGE_SIZE_KEY));
  return value === 24 || value === 48 || value === 96 ? value : 24;
}

function storedCardSize(): MemeCardSize {
  const value = localStorage.getItem(CARD_SIZE_KEY);
  return value === "extra-large" || value === "large" || value === "medium" || value === "small"
    ? value
    : "medium";
}

function shuffleSeed(previous: number | null = null): number {
  const values = new Uint32Array(1);
  let seed: number;
  do {
    crypto.getRandomValues(values);
    seed = values[0] % SHUFFLE_MODULUS;
  } while (seed === previous);
  return seed;
}

export interface MemeApi extends AISettingsApi, CaptionLabApi {
  listMemePage(options: ListMemePageOptions): Promise<MemePageResponse>;
  listMemes(options: ListMemesOptions): Promise<MemeResponse[]>;
  listTags(options?: ListTagsOptions): Promise<TagResponse[]>;
  renameTag(id: number, name: string): Promise<TagResponse>;
  mergeTag(sourceId: number, targetId: number): Promise<TagResponse>;
  deleteTag(id: number): Promise<void>;
  cleanupEmptyTags(): Promise<TagCleanupResponse>;
  listTemplates(): Promise<TemplateResponse[]>;
  createTemplate(payload: TemplateCreatePayload): Promise<TemplateResponse>;
  createTemplateWithReferenceImage(
    payload: TemplateCreatePayload,
    file: File,
  ): Promise<TemplateResponse>;
  updateTemplate(
    id: number,
    payload: TemplateUpdatePayload,
  ): Promise<TemplateResponse>;
  deleteTemplate(id: number): Promise<void>;
  uploadTemplateReferenceImage(id: number, file: File): Promise<TemplateResponse>;
  deleteTemplateReferenceImage(id: number): Promise<void>;
  getRandomMeme(tags: string[], signal?: AbortSignal): Promise<MemeResponse>;
  uploadMeme(input: UploadMemeInput): Promise<MemeResponse>;
  createImportJob(input: CreateImportJobInput): Promise<ImportJobResponse>;
  getImportJob(id: number): Promise<ImportJobResponse>;
  listImportJobItems(id: number, offset?: number, limit?: number, status?: string): Promise<ImportJobItemPage>;
  cancelImportJob(id: number): Promise<ImportJobResponse>;
  retryFailedImportJob(id: number): Promise<ImportJobResponse>;
  deleteImportJob(id: number): Promise<void>;
  createExportJob(input: CreateExportJobInput): Promise<ExportJobResponse>;
  getExportJob(id: number): Promise<ExportJobResponse>;
  listExportJobItems(id: number, offset?: number, limit?: number): Promise<ExportJobItemPage>;
  cancelExportJob(id: number): Promise<ExportJobResponse>;
  deleteExportJob(id: number): Promise<void>;
  updateMeme(
    id: number,
    payload: MemeUpdatePayload,
  ): Promise<MemeResponse>;
  deleteMeme(id: number): Promise<void>;
  appendMemeImage(id: number, file: File): Promise<MemeResponse>;
  deleteMemeImage(id: number, imageId: number): Promise<MemeResponse>;
  reorderMemeImages(id: number, imageIds: number[]): Promise<MemeResponse>;
  listMemeRelations(id: number): Promise<MemeResponse[]>;
  addMemeRelations(id: number, ids: number[]): Promise<MemeResponse[]>;
  deleteMemeRelation(id: number, relatedId: number): Promise<void>;
  analyzeMeme(id: number): Promise<AIAnalysisResponse>;
  confirmAIAnalysis(
    memeId: number,
    analysisId: number,
    payload: AIAnalysisConfirmPayload,
  ): Promise<MemeResponse>;
}

const defaultApi: MemeApi = {
  listMemePage,
  listMemes,
  listTags,
  renameTag,
  mergeTag,
  deleteTag,
  cleanupEmptyTags,
  listTemplates,
  createTemplate,
  createTemplateWithReferenceImage,
  updateTemplate,
  deleteTemplate,
  uploadTemplateReferenceImage,
  deleteTemplateReferenceImage,
  getRandomMeme,
  uploadMeme,
  createImportJob, getImportJob, listImportJobItems, cancelImportJob, retryFailedImportJob, deleteImportJob,
  createExportJob, getExportJob, listExportJobItems, cancelExportJob, deleteExportJob,
  updateMeme,
  deleteMeme,
  listCaptions,
  createCaption,
  updateCaption,
  deleteCaption,
  generateCaptions,
  rewriteCaption,
  appendMemeImage, deleteMemeImage, reorderMemeImages,
  listMemeRelations, addMemeRelations, deleteMemeRelation,
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
    relatedMemes: [],
    relationQuery: "",
    selectedRelationIds: [],
    relationsLoading: false,
    relationsSaving: false,
    relationRemovingId: null,
    relationError: null,
    imageOperation: null,
    imageError: null,
    memes: [],
    availableTags: [],
    availableTemplates: [],
    selectedMeme: null,
    query: "",
    selectedTags: [],
    tagsExpanded: false,
    page: 1,
    pageSize: storedPageSize(),
    totalMemes: 0,
    totalPages: 0,
    listSort: "default",
    shuffleSeed: null,
    cardSize: storedCardSize(),
    templatePage: 1,
    loadingList: false,
    saving: false,
    deleting: false,
    randomizing: false,
    analyzing: false,
    confirmingAnalysis: false,
    aiAnalysis: null,
    selectedAITags: [],
    applyAIDescription: false,
    applyAITitle: false,
    selectedAITemplateId: null,
    applyAITemplate: false,
    aiError: null,
    listError: null,
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
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
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
  private templateEditingId: number | null = null;
  private templateBusy = false;
  private templateError: string | null = null;
  private viewerIndex = 0;
  private viewerMeme: MemeResponse | null = null;
  private draggedImageId: number | null = null;
  private relationRemovalToken: symbol | null = null;
  private readonly settings: AISettingsController;
  private readonly batchUpload: BatchUploadController;
  private readonly batchDownload: BatchDownloadController;
  private readonly captionLab: CaptionLabController;
  private readonly tagManager: TagManagerController;
  private editTagEditor: TagEditor | null = null;
  private templateReferencePreviewToken = 0;

  constructor(
    root: HTMLElement,
    private readonly api: MemeApi = defaultApi,
  ) {
    this.elements = mountShell(root);
    this.settings = new AISettingsController(this.elements, this.api);
    this.captionLab = new CaptionLabController(this.elements.detailPanel, this.api);
    this.batchUpload = new BatchUploadController({
      uploadMeme: (input) => this.api.uploadMeme(input),
      createImportJob: (input) => this.api.createImportJob(input),
      getImportJob: (id) => this.api.getImportJob(id),
      listImportJobItems: (id, offset, limit, status) =>
        this.api.listImportJobItems(id, offset, limit, status),
      cancelImportJob: (id) => this.api.cancelImportJob(id),
      retryFailedImportJob: (id) => this.api.retryFailedImportJob(id),
      deleteImportJob: (id) => this.api.deleteImportJob(id),
      onComplete: async () => {
        await Promise.all([
          this.reloadMemes(),
          this.refreshTags(),
          this.refreshTemplates(),
        ]);
      },
    });
    this.batchDownload = new BatchDownloadController({
      createExportJob: input => this.api.createExportJob(input),
      getExportJob: id => this.api.getExportJob(id),
      listExportJobItems: (id, offset, limit) => this.api.listExportJobItems(id, offset, limit),
      cancelExportJob: id => this.api.cancelExportJob(id),
      deleteExportJob: id => this.api.deleteExportJob(id),
    });
    this.tagManager = new TagManagerController(this.api, {
      onMutation: (mutation) => this.applyTagMutation(mutation),
      onFilterTag: async (name) => {
        this.state.selectedTags = [name];
        this.state.page = 1;
        renderTags(this.elements, this.state);
        await this.reloadMemes();
      },
    });
    this.bindEvents();
    this.render();
  }

  async start(): Promise<void> {
    await Promise.all([
      this.reloadMemes(),
      this.refreshTags(),
      this.refreshTemplates(),
    ]);
  }

  private bindEvents(): void {
    this.elements.searchInput.addEventListener("input", () => {
      if (this.searchTimer) {
        clearTimeout(this.searchTimer);
      }
      this.searchTimer = setTimeout(() => {
        this.state.query = this.elements.searchInput.value.trim();
        this.state.page = 1;
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
      this.state.page = 1;
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
      }
    });
    this.elements.browsingControls.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (target.matches("[data-list-sort]")) {
        this.state.listSort = target.value === "shuffle" ? "shuffle" : "default";
        this.state.shuffleSeed = this.state.listSort === "shuffle" ? shuffleSeed() : null;
        this.state.page = 1;
        void this.reloadMemes();
      } else if (target.matches("[data-page-size]")) {
        const size = Number(target.value);
        if (size === 24 || size === 48 || size === 96) {
          this.state.pageSize = size;
          this.state.page = 1;
          localStorage.setItem(PAGE_SIZE_KEY, String(size));
          void this.reloadMemes();
        }
      } else if (target.matches("[data-card-size]")) {
        const size = target.value;
        if (size === "extra-large" || size === "large" || size === "medium" || size === "small") {
          this.state.cardSize = size;
          localStorage.setItem(CARD_SIZE_KEY, size);
          applyMemeCardSize(this.elements, size);
        }
      }
    });
    this.elements.browsingControls.addEventListener("click", (event) => {
      if (!(event.target as Element).closest("[data-reshuffle]")) return;
      this.state.shuffleSeed = shuffleSeed(this.state.shuffleSeed);
      this.state.page = 1;
      void this.reloadMemes();
    });
    this.elements.pagination.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-page]");
      if (button) void this.goToPage(Number(button.dataset.page));
    });
    this.elements.pagination.addEventListener("keydown", (event) => {
      const input = event.target;
      if (event.key === "Enter" && input instanceof HTMLInputElement && input.matches("[data-page-input]")) {
        event.preventDefault();
        if (input.value.trim()) void this.goToPage(Number(input.value));
      }
    });
    this.elements.randomButton.addEventListener("click", () => {
      void this.randomize();
    });
    this.elements.openUploadButton.addEventListener("click", () => {
      this.batchUpload.open(
        this.state.availableTemplates,
        this.state.availableTags,
      );
    });
    this.elements.openSettingsButton.addEventListener("click", () => {
      this.settings.open();
    });
    this.elements.openTemplatesButton.addEventListener("click", () => {
      this.openTemplateManager();
    });
    this.elements.openTagsButton.addEventListener("click", () => {
      this.tagManager.open();
    });
    for (const button of document.querySelectorAll("[data-close-templates]")) {
      button.addEventListener("click", () => {
        if (!this.templateBusy) {
          this.elements.templateDialog.close();
        }
      });
    }
    this.elements.templateForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitTemplate();
    });
    this.elements.openDownloadButton.addEventListener("click", () => {
      this.batchDownload.open({
        query: this.state.query,
        tags: this.state.selectedTags,
        templateId: null,
      });
    });
    this.elements.templateForm
      .querySelector<HTMLInputElement>('[name="reference_image"]')
      ?.addEventListener("change", (event) => {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file) {
          this.previewTemplateReference(file);
        } else {
          this.renderCurrentTemplateReference();
        }
      });
    this.elements.templateForm
      .querySelector("[data-cancel-template-edit]")
      ?.addEventListener("click", () => {
        this.templateEditingId = null;
        this.templateError = null;
        this.clearTemplateReferenceInput();
        renderTemplateManager(
          this.elements,
          this.state,
          null,
          false,
          null,
        );
      });
    this.elements.templateList.addEventListener("click", (event) => {
      const target = event.target as Element;
      const editButton =
        target.closest<HTMLButtonElement>("[data-edit-template]");
      const deleteButton =
        target.closest<HTMLButtonElement>("[data-delete-template]");
      if (editButton) {
        this.templateEditingId = Number(editButton.dataset.editTemplate);
        this.templateError = null;
        this.clearTemplateReferenceInput();
        renderTemplateManager(
          this.elements,
          this.state,
          this.templateEditingId,
          false,
          null,
        );
      } else if (deleteButton) {
        void this.removeTemplate(Number(deleteButton.dataset.deleteTemplate));
      }
    });
    this.elements.detailPanel.addEventListener("click", (event) => {
      const target = event.target as Element;
      if (target.closest("[data-open-viewer]")) {
        const meme = this.state.selectedMeme;
        if (meme) {
          this.viewerMeme = meme;
          this.viewerIndex = Number(target.closest<HTMLElement>("[data-image-index]")?.dataset.imageIndex ?? 0);
          openImageViewer(this.elements, meme, this.viewerIndex);
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
      } else if (target.closest("[data-related-meme]")) {
        const id = Number(target.closest<HTMLElement>("[data-related-meme]")?.dataset.relatedMeme);
        const meme = this.state.relatedMemes.find((item) => item.id === id);
        if (meme) this.selectMeme(meme);
      } else if (target.closest("[data-remove-relation]")) {
        const id = Number(target.closest<HTMLElement>("[data-remove-relation]")?.dataset.removeRelation);
        void this.removeRelation(id);
      } else if (target.closest("[data-open-relations]")) {
        this.openRelationDialog();
      } else if (target.closest("[data-delete-image]")) {
        const imageId = Number(target.closest<HTMLElement>("[data-delete-image]")?.dataset.deleteImage);
        void this.deleteSelectedImage(imageId);
      }
    });
    this.elements.detailPanel.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement;
      if (!target.matches("[data-append-image]") || !target.files?.[0] || !this.state.selectedMeme) return;
      void this.appendSelectedImage(target.files[0]);
    });
    this.elements.detailPanel.addEventListener("dragstart", (event) => {
      const card = (event.target as Element).closest<HTMLElement>("[data-image-id]");
      if (card && this.state.imageOperation === null) {
        this.draggedImageId = Number(card.dataset.imageId);
        card.classList.add("is-dragging");
      }
    });
    this.elements.detailPanel.addEventListener("dragover", (event) => {
      const card = (event.target as Element).closest<HTMLElement>("[data-image-id]");
      if (card && this.draggedImageId !== null) {
        event.preventDefault();
        for (const item of this.elements.detailPanel.querySelectorAll(".is-drag-over")) {
          item.classList.remove("is-drag-over");
        }
        card.classList.add("is-drag-over");
      }
    });
    this.elements.detailPanel.addEventListener("drop", (event) => {
      event.preventDefault();
      const target = (event.target as Element).closest<HTMLElement>("[data-image-id]");
      const meme = this.state.selectedMeme;
      if (!target || !meme || this.draggedImageId === null) {
        this.clearImageDragState();
        return;
      }
      const targetId = Number(target.dataset.imageId);
      const ids = meme.images.map((image) => image.id);
      const from = ids.indexOf(this.draggedImageId);
      const to = ids.indexOf(targetId);
      this.clearImageDragState();
      if (from < 0 || to < 0 || from === to) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      void this.reorderSelectedImages(ids);
    });
    this.elements.detailPanel.addEventListener("dragend", () => {
      this.clearImageDragState();
    });
    this.elements.detailPanel.addEventListener("change", (event) => {
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.matches("[data-ai-template]")) {
        this.state.selectedAITemplateId = target.value
          ? Number(target.value)
          : null;
        return;
      }
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
      } else if (target.matches("[data-ai-title]")) {
        this.state.applyAITitle = target.checked;
      } else if (target.matches("[data-ai-apply-template]")) {
        this.state.applyAITemplate = target.checked;
        renderDetail(
          this.elements,
          this.state,
          this.editing,
          this.editDraft,
        );
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
    this.elements.templatePagination.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-template-page]");
      if (!button || this.templateBusy) return;
      this.state.templatePage = clampPage(
        Number(button.dataset.templatePage),
        Math.ceil(this.state.availableTemplates.length / 12),
      );
      renderTemplateManager(this.elements, this.state, this.templateEditingId, false, this.templateError);
    });
    this.elements.templatePagination.addEventListener("keydown", (event) => {
      const input = event.target;
      if (event.key !== "Enter" || !(input instanceof HTMLInputElement) || !input.matches("[data-template-page-input]") || !input.value.trim()) return;
      event.preventDefault();
      this.state.templatePage = clampPage(
        Number(input.value),
        Math.ceil(this.state.availableTemplates.length / 12),
      );
      renderTemplateManager(this.elements, this.state, this.templateEditingId, false, this.templateError);
    });
    this.elements.detailPanel.addEventListener("meme-detail-rendered", () => {
      this.mountEditTagEditor();
    });

    for (const button of this.elements.relationDialog.querySelectorAll(
      "[data-close-relations]",
    )) {
      button.addEventListener("click", () => this.closeRelationDialog());
    }
    this.elements.relationDialog.addEventListener("click", (event) => {
      if (event.target === this.elements.relationDialog) {
        this.closeRelationDialog();
      }
    });
    this.elements.relationSearch.addEventListener("input", () => {
      this.state.relationQuery = this.elements.relationSearch.value;
      renderRelationDialog(this.elements, this.state);
    });
    this.elements.relationCandidates.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.matches("[data-relation-choice]")) {
        return;
      }
      const id = Number(target.dataset.relationChoice);
      this.state.selectedRelationIds = target.checked
        ? [...new Set([...this.state.selectedRelationIds, id])]
        : this.state.selectedRelationIds.filter((item) => item !== id);
      renderRelationDialog(this.elements, this.state);
    });
    this.elements.relationSave.addEventListener("click", () => {
      void this.saveRelations();
    });

    const closeViewer = () => {
      closeImageViewer(this.elements);
      this.viewerMeme = null;
      this.viewerIndex = 0;
    };
    this.elements.imageViewerDialog.addEventListener("click", (event) => {
      if (event.target === this.elements.imageViewerDialog) {
        closeViewer();
      }
    });
    this.elements.imageViewerDialog
      .querySelector("[data-close-viewer]")
      ?.addEventListener("click", closeViewer);
    this.elements.imageViewerDialog.addEventListener("close", () => {
      this.viewerMeme = null;
      this.viewerIndex = 0;
      closeImageViewer(this.elements);
    });
    const moveViewer = (delta: number) => {
      const meme = this.viewerMeme;
      const count = meme?.images.length || 1;
      this.viewerIndex = Math.max(0, Math.min(count - 1, this.viewerIndex + delta));
      if (meme) openImageViewer(this.elements, meme, this.viewerIndex);
    };
    this.elements.imageViewerPrevious.addEventListener("click", () => moveViewer(-1));
    this.elements.imageViewerNext.addEventListener("click", () => moveViewer(1));
    document.addEventListener("keydown", (event) => {
      if (this.elements.imageViewerDialog.open && event.key === "ArrowLeft") moveViewer(-1);
      if (this.elements.imageViewerDialog.open && event.key === "ArrowRight") moveViewer(1);
    });
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
    renderRelationDialog(this.elements, this.state);
  }

  private async refreshTemplates(): Promise<void> {
    try {
      this.state.availableTemplates = await this.api.listTemplates();
      this.state.templatePage = clampPage(
        this.state.templatePage,
        Math.ceil(this.state.availableTemplates.length / 12),
      );
      if (this.state.aiAnalysis?.suggested_template) {
        const currentSuggestion = this.state.availableTemplates.find(
          (template) =>
            template.id === this.state.aiAnalysis?.suggested_template?.id,
        );
        this.state.aiAnalysis = {
          ...this.state.aiAnalysis,
          suggested_template: currentSuggestion ?? null,
        };
        if (!currentSuggestion) {
          this.state.selectedAITemplateId = null;
          this.state.applyAITemplate = false;
        }
      }
      this.batchUpload.setTemplates(this.state.availableTemplates);
      renderDetail(
        this.elements,
        this.state,
        this.editing,
        this.editDraft,
      );
      if (this.elements.templateDialog.open) {
        renderTemplateManager(
          this.elements,
          this.state,
          this.templateEditingId,
          this.templateBusy,
          this.templateError,
        );
      }
    } catch (error) {
      this.state.operationError = `模板加载失败：${readableError(error)}`;
      renderOperationError(this.elements, this.state);
    }
  }

  private openTemplateManager(): void {
    this.templateEditingId = null;
    this.templateError = null;
    this.state.templatePage = 1;
    this.clearTemplateReferenceInput();
    renderTemplateManager(this.elements, this.state, null, false, null);
    this.elements.templateDialog.showModal();
  }

  private async submitTemplate(): Promise<void> {
    if (this.templateBusy) {
      return;
    }
    const name = value(this.elements.templateForm, "name").trim();
    const description =
      value(this.elements.templateForm, "description").trim() || null;
    const reference = this.elements.templateForm.elements.namedItem("reference_image");
    const file = reference instanceof HTMLInputElement ? reference.files?.[0] : undefined;
    if (!name) {
      this.templateError = "模板名称不能为空。";
      this.elements.templateError.hidden = false;
      this.elements.templateError.textContent = this.templateError;
      return;
    }
    this.templateBusy = true;
    this.templateError = null;
    this.elements.templateSubmit.disabled = true;
    this.elements.templateSubmit.textContent = "正在保存…";
    try {
      const creating = this.templateEditingId === null;
      if (this.templateEditingId === null) {
        if (file) {
          await this.api.createTemplateWithReferenceImage(
            { name, description },
            file,
          );
        } else {
          await this.api.createTemplate({ name, description });
        }
      } else {
        await this.api.updateTemplate(this.templateEditingId, {
          name,
          description,
        });
        if (file) await this.api.uploadTemplateReferenceImage(this.templateEditingId, file);
      }
      this.templateEditingId = null;
      this.clearTemplateReferenceInput();
      await this.refreshTemplates();
      if (creating) {
        this.state.templatePage = Math.max(
          1,
          Math.ceil(this.state.availableTemplates.length / 12),
        );
      }
    } catch (error) {
      this.templateError = readableError(error);
    } finally {
      this.templateBusy = false;
      renderTemplateManager(
        this.elements,
        this.state,
        this.templateEditingId,
        false,
        this.templateError,
      );
      if (this.templateError && file) {
        this.previewTemplateReference(file);
      }
    }
  }

  private clearTemplateReferenceInput(): void {
    this.templateReferencePreviewToken += 1;
    const input = this.elements.templateForm.elements.namedItem(
      "reference_image",
    );
    if (input instanceof HTMLInputElement) {
      input.value = "";
    }
  }

  private renderCurrentTemplateReference(): void {
    this.templateReferencePreviewToken += 1;
    const template = this.state.availableTemplates.find(
      (item) => item.id === this.templateEditingId,
    );
    renderTemplateReferenceInputPreview(
      this.elements,
      template?.reference_thumbnail_url ?? null,
      template ? `${template.name} 当前参考图` : "参考图预览",
    );
  }

  private previewTemplateReference(file: File): void {
    const token = ++this.templateReferencePreviewToken;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (token !== this.templateReferencePreviewToken) {
        return;
      }
      const source = typeof reader.result === "string" ? reader.result : null;
      renderTemplateReferenceInputPreview(
        this.elements,
        source,
        `${file.name} 预览`,
      );
    });
    reader.readAsDataURL(file);
  }

  private async removeTemplate(templateId: number): Promise<void> {
    const template = this.state.availableTemplates.find(
      (item) => item.id === templateId,
    );
    if (
      !template ||
      this.templateBusy ||
      !confirm(`确定删除模板“${template.name}”吗？相关 Meme 将变为未归类。`)
    ) {
      return;
    }
    this.templateBusy = true;
    this.templateError = null;
    renderTemplateManager(
      this.elements,
      this.state,
      this.templateEditingId,
      true,
      null,
    );
    try {
      await this.api.deleteTemplate(templateId);
      this.state.availableTemplates = this.state.availableTemplates.filter(
        (item) => item.id !== templateId,
      );
      this.state.templatePage = clampPage(
        this.state.templatePage,
        Math.ceil(this.state.availableTemplates.length / 12),
      );
      if (this.state.selectedMeme?.template?.id === templateId) {
        this.state.selectedMeme = {
          ...this.state.selectedMeme,
          template: null,
        };
      }
      if (this.state.aiAnalysis?.suggested_template?.id === templateId) {
        this.state.aiAnalysis = {
          ...this.state.aiAnalysis,
          suggested_template: null,
        };
        this.state.selectedAITemplateId = null;
        this.state.applyAITemplate = false;
      }
      this.templateEditingId = null;
      await Promise.all([this.refreshTemplates(), this.reloadMemes()]);
    } catch (error) {
      this.templateError = readableError(error);
    } finally {
      this.templateBusy = false;
      renderTemplateManager(
        this.elements,
        this.state,
        this.templateEditingId,
        false,
        this.templateError,
      );
      renderDetail(
        this.elements,
        this.state,
        this.editing,
        this.editDraft,
      );
    }
  }

  private async reloadMemes(scrollAfter = false): Promise<void> {
    this.listController?.abort();
    const controller = new AbortController();
    this.listController = controller;
    this.state.loadingList = true;
    this.state.listError = null;
    this.state.memes = [];
    renderLibrary(this.elements, this.state);

    try {
      const response = await this.api.listMemePage({
        page: this.state.page,
        pageSize: this.state.pageSize,
        q: this.state.query,
        tags: this.state.selectedTags,
        sort: this.state.listSort,
        shuffleSeed: this.state.shuffleSeed,
        signal: controller.signal,
      });
      if (this.listController !== controller) {
        return;
      }
      this.state.memes = response.items;
      this.state.totalMemes = response.total;
      this.state.totalPages = response.total_pages;
      this.state.page = response.page;
      this.state.pageSize = response.page_size;
      this.state.listSort = response.sort;
      this.state.shuffleSeed = response.shuffle_seed;
      if (scrollAfter) {
        this.elements.libraryHeading.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }
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

  private async goToPage(page: number): Promise<void> {
    if (this.state.loadingList || this.state.totalPages === 0 || !Number.isInteger(page)) return;
    const target = clampPage(page, this.state.totalPages);
    if (target === this.state.page) return;
    this.state.page = target;
    await this.reloadMemes(true);
  }

  private async refreshTags(): Promise<void> {
    try {
      this.state.availableTags = await this.api.listTags();
      this.batchUpload.setAvailableTags(this.state.availableTags);
      this.editTagEditor?.setAvailableTags(this.state.availableTags);
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
    if (!this.captionLab.setMeme(meme.id)) {
      return;
    }
    this.state.selectedMeme = meme;
    this.state.actionError = null;
    this.state.operationError = null;
    this.state.imageError = null;
    this.state.relatedMemes = [];
    this.state.relationQuery = "";
    this.state.selectedRelationIds = [];
    this.state.relationError = null;
    this.state.relationsLoading = true;
    this.state.relationRemovingId = null;
    this.relationRemovalToken = null;
    this.editing = false;
    this.editDraft = null;
    this.editTagEditor = null;
    this.resetAIAnalysis();
    renderLibrary(this.elements, this.state);
    renderDetail(this.elements, this.state, false, null);
    void this.loadRelations(meme.id);
  }

  private clearImageDragState(): void {
    this.draggedImageId = null;
    for (const item of this.elements.detailPanel.querySelectorAll(
      ".is-dragging, .is-drag-over",
    )) {
      item.classList.remove("is-dragging", "is-drag-over");
    }
  }

  private async appendSelectedImage(file: File): Promise<void> {
    const meme = this.state.selectedMeme;
    if (!meme || this.state.imageOperation !== null) {
      return;
    }
    this.state.imageOperation = "append";
    this.state.imageError = null;
    renderDetail(this.elements, this.state, this.editing, this.editDraft);
    try {
      const updated = await this.api.appendMemeImage(meme.id, file);
      this.replaceMeme(updated);
    } catch (error) {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.imageError = readableError(error);
      }
    } finally {
      this.state.imageOperation = null;
      renderLibrary(this.elements, this.state);
      renderDetail(this.elements, this.state, this.editing, this.editDraft);
    }
  }

  private async deleteSelectedImage(imageId: number): Promise<void> {
    const meme = this.state.selectedMeme;
    if (!meme || this.state.imageOperation !== null) {
      return;
    }
    this.state.imageOperation = imageId;
    this.state.imageError = null;
    renderDetail(this.elements, this.state, this.editing, this.editDraft);
    try {
      const updated = await this.api.deleteMemeImage(meme.id, imageId);
      this.replaceMeme(updated);
    } catch (error) {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.imageError = readableError(error);
      }
    } finally {
      this.state.imageOperation = null;
      renderLibrary(this.elements, this.state);
      renderDetail(this.elements, this.state, this.editing, this.editDraft);
    }
  }

  private async reorderSelectedImages(imageIds: number[]): Promise<void> {
    const meme = this.state.selectedMeme;
    if (!meme || this.state.imageOperation !== null) {
      return;
    }
    this.state.imageOperation = "reorder";
    this.state.imageError = null;
    renderDetail(this.elements, this.state, this.editing, this.editDraft);
    try {
      const updated = await this.api.reorderMemeImages(meme.id, imageIds);
      this.replaceMeme(updated);
    } catch (error) {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.imageError = readableError(error);
      }
    } finally {
      this.state.imageOperation = null;
      renderLibrary(this.elements, this.state);
      renderDetail(this.elements, this.state, this.editing, this.editDraft);
    }
  }

  private async loadRelations(memeId: number): Promise<void> {
    try {
      const relations = await this.api.listMemeRelations(memeId);
      if (this.state.selectedMeme?.id !== memeId) {
        return;
      }
      this.state.relatedMemes = relations;
    } catch (error) {
      if (this.state.selectedMeme?.id !== memeId) {
        return;
      }
      this.state.relatedMemes = [];
      this.state.relationError = readableError(error);
    } finally {
      if (this.state.selectedMeme?.id === memeId) {
        this.state.relationsLoading = false;
        renderDetail(this.elements, this.state, this.editing, this.editDraft);
      }
    }
  }

  private openRelationDialog(): void {
    if (!this.state.selectedMeme || this.state.relationsLoading) {
      return;
    }
    this.state.relationQuery = "";
    this.state.selectedRelationIds = [];
    this.state.relationError = null;
    renderRelationDialog(this.elements, this.state);
    this.elements.relationDialog.showModal();
    this.elements.relationSearch.focus();
  }

  private closeRelationDialog(): void {
    if (this.state.relationsSaving) {
      return;
    }
    if (this.elements.relationDialog.open) {
      this.elements.relationDialog.close();
    }
    this.state.relationQuery = "";
    this.state.selectedRelationIds = [];
    this.state.relationError = null;
  }

  private async saveRelations(): Promise<void> {
    const meme = this.state.selectedMeme;
    const ids = [...this.state.selectedRelationIds];
    if (!meme || !ids.length || this.state.relationsSaving) {
      return;
    }
    this.state.relationsSaving = true;
    this.state.relationError = null;
    renderRelationDialog(this.elements, this.state);
    try {
      const relations = await this.api.addMemeRelations(meme.id, ids);
      if (this.state.selectedMeme?.id !== meme.id) {
        return;
      }
      this.state.relatedMemes = relations;
      this.state.selectedRelationIds = [];
      this.state.relationQuery = "";
      this.elements.relationDialog.close();
    } catch (error) {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.relationError = readableError(error);
      }
    } finally {
      this.state.relationsSaving = false;
      renderDetail(this.elements, this.state, this.editing, this.editDraft);
      renderRelationDialog(this.elements, this.state);
    }
  }

  private async removeRelation(relatedId: number): Promise<void> {
    const meme = this.state.selectedMeme;
    if (!meme || this.state.relationRemovingId !== null) {
      return;
    }
    const removalToken = Symbol("relation-removal");
    this.relationRemovalToken = removalToken;
    this.state.relationRemovingId = relatedId;
    this.state.relationError = null;
    renderDetail(this.elements, this.state, this.editing, this.editDraft);
    try {
      await this.api.deleteMemeRelation(meme.id, relatedId);
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.relatedMemes = this.state.relatedMemes.filter(
          (item) => item.id !== relatedId,
        );
      }
    } catch (error) {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.relationError = readableError(error);
      }
    } finally {
      if (this.relationRemovalToken !== removalToken) {
        return;
      }
      this.relationRemovalToken = null;
      this.state.relationRemovingId = null;
      renderDetail(this.elements, this.state, this.editing, this.editDraft);
    }
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
      tags: meme.tags.map((tag) => tag.name),
      templateId: meme.template ? String(meme.template.id) : "",
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
    this.editTagEditor = null;
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
      tags: this.editTagEditor?.getTags() ?? this.editDraft?.tags ?? [],
      templateId: value(form, "template_id"),
    };
    const payload: MemeUpdatePayload = {
      title,
      description: this.editDraft.description.trim() || null,
      source: this.editDraft.source.trim() || null,
      tags: this.editDraft.tags,
      template_id: this.editDraft.templateId
        ? Number(this.editDraft.templateId)
        : null,
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
      const previousTags = meme.tags.map((tag) => tag.name).sort();
      const submittedTags = [...this.editDraft.tags].sort();
      const tagsChanged = previousTags.join("\0") !== submittedTags.join("\0");
      const updated = await this.api.updateMeme(targetId, payload);
      this.replaceMeme(updated);
      renderMemeCard(
        this.elements,
        updated,
        this.state.selectedMeme?.id === targetId,
      );
      if (this.state.selectedMeme?.id === targetId) {
        this.editing = false;
        this.editDraft = null;
        this.editTagEditor = null;
      }
      await this.refreshTags();
      if (tagsChanged) {
        this.state.page = 1;
        await this.reloadMemes();
      }
    } catch (error) {
      if (this.state.selectedMeme?.id === meme.id) {
        this.state.actionError = readableError(error);
      } else {
        this.state.operationError = readableError(error);
      }
    } finally {
      this.state.saving = false;
      renderOperationError(this.elements, this.state);
      renderDetail(
        this.elements,
        this.state,
        this.editing,
        this.editDraft,
      );
    }
  }

  private mountEditTagEditor(): void {
    const host = this.elements.detailPanel.querySelector<HTMLElement>(
      "[data-edit-tag-editor]",
    );
    if (!host || !this.editing || !this.editDraft) {
      this.editTagEditor = null;
      return;
    }
    this.editTagEditor = new TagEditor(host, {
      tags: this.editDraft.tags,
      availableTags: this.state.availableTags,
      label: "Meme 标签",
      disabled: this.state.saving,
      onChange: (tags) => {
        if (this.editDraft) this.editDraft.tags = tags;
      },
    });
  }

  private mapMemeTagMutation(
    meme: MemeResponse,
    mutation: TagMutation,
  ): MemeResponse {
    const replacement =
      mutation.type === "rename" || mutation.type === "merge"
        ? { from: mutation.from, to: mutation.to }
        : null;
    const removed =
      mutation.type === "delete"
        ? new Set([mutation.name])
        : mutation.type === "cleanup"
          ? new Set(mutation.names)
          : new Set<string>();
    const tags = meme.tags
      .filter((tag) => !removed.has(tag.name))
      .map((tag) =>
        replacement && tag.name === replacement.from
          ? { ...tag, name: replacement.to }
          : tag,
      )
      .filter(
        (tag, index, items) =>
          items.findIndex((candidate) => candidate.name === tag.name) === index,
      );
    return tags === meme.tags ? meme : { ...meme, tags };
  }

  private async applyTagMutation(mutation: TagMutation): Promise<void> {
    if (mutation.type === "rename" || mutation.type === "merge") {
      this.state.selectedTags = [
        ...new Set(
          this.state.selectedTags.map((tag) =>
            tag === mutation.from ? mutation.to : tag,
          ),
        ),
      ];
    } else {
      const removed = new Set(
        mutation.type === "delete" ? [mutation.name] : mutation.names,
      );
      this.state.selectedTags = this.state.selectedTags.filter(
        (tag) => !removed.has(tag),
      );
    }
    this.state.memes = this.state.memes.map((meme) =>
      this.mapMemeTagMutation(meme, mutation),
    );
    this.state.relatedMemes = this.state.relatedMemes.map((meme) =>
      this.mapMemeTagMutation(meme, mutation),
    );
    if (this.state.selectedMeme) {
      this.state.selectedMeme = this.mapMemeTagMutation(
        this.state.selectedMeme,
        mutation,
      );
    }
    await this.refreshTags();
    renderTags(this.elements, this.state);
    renderLibrary(this.elements, this.state);
    renderDetail(this.elements, this.state, this.editing, this.editDraft);
    this.state.page = 1;
    await this.reloadMemes();
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
    this.state.applyAITitle = false;
    this.state.selectedAITemplateId = null;
    this.state.applyAITemplate = false;
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
      this.state.applyAITitle = false;
      this.state.selectedAITemplateId =
        analysis.suggested_template?.id ?? null;
      this.state.applyAITemplate = analysis.suggested_template !== null;
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
          apply_title: this.state.applyAITitle,
          template_id: this.state.selectedAITemplateId,
          apply_template: this.state.applyAITemplate,
        },
      );
      if (this.state.selectedMeme?.id !== meme.id) {
        return;
      }
      this.replaceMeme(updated);
      this.state.aiAnalysis = null;
      this.state.selectedAITags = [];
      this.state.applyAIDescription = false;
      this.state.applyAITitle = false;
      this.state.selectedAITemplateId = null;
      this.state.applyAITemplate = false;
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
        this.captionLab.clear();
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
