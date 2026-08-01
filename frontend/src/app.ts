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
  deleteAIModel,
  deleteAIProvider,
  deleteTemplate,
  deleteTemplateReferenceImage,
  deleteCaption,
  getRandomMeme,
  listAIModels,
  listAIProviderPresets,
  listAIProviders,
  listMemes,
  listTags,
  listTemplates,
  listCaptions,
  parseTagInput,
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
  appendMemeImage, deleteMemeImage, reorderMemeImages,
  listMemeRelations, addMemeRelations, deleteMemeRelation,
} from "./api";
import type {
  AIAnalysisConfirmPayload,
  AIAnalysisResponse,
  AppState,
  ListMemesOptions,
  MemeResponse,
  MemeUpdatePayload,
  TagResponse,
  TemplateCreatePayload,
  TemplateResponse,
  TemplateUpdatePayload,
  UploadMemeInput,
} from "./types";
import { BatchUploadController } from "./batch-upload";
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

const PAGE_SIZE = 24;

export interface MemeApi extends AISettingsApi, CaptionLabApi {
  listMemes(options: ListMemesOptions): Promise<MemeResponse[]>;
  listTags(signal?: AbortSignal): Promise<TagResponse[]>;
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
  listMemes,
  listTags,
  listTemplates,
  createTemplate,
  createTemplateWithReferenceImage,
  updateTemplate,
  deleteTemplate,
  uploadTemplateReferenceImage,
  deleteTemplateReferenceImage,
  getRandomMeme,
  uploadMeme,
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
    offset: 0,
    hasMore: false,
    loadingList: false,
    loadingMore: false,
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
  private readonly captionLab: CaptionLabController;
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
      onComplete: async () => {
        await Promise.all([
          this.reloadMemes(),
          this.refreshTags(),
          this.refreshTemplates(),
        ]);
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
      this.batchUpload.open(this.state.availableTemplates);
    });
    this.elements.openSettingsButton.addEventListener("click", () => {
      this.settings.open();
    });
    this.elements.openTemplatesButton.addEventListener("click", () => {
      this.openTemplateManager();
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
      tags: meme.tags.map((tag) => tag.name).join(", "),
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
      templateId: value(form, "template_id"),
    };
    const payload: MemeUpdatePayload = {
      title,
      description: this.editDraft.description.trim() || null,
      source: this.editDraft.source.trim() || null,
      tags: parseTagInput(this.editDraft.tags),
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
      }
      await this.refreshTags();
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
