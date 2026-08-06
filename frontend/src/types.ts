export interface TagResponse {
  id: number;
  name: string;
  category: string;
  description: string | null;
  created_at: string;
  usage_count: number;
}

export type TagSort = "name_asc" | "name_desc" | "usage_asc" | "usage_desc";

export interface ListTagsOptions {
  includeEmpty?: boolean;
  q?: string;
  sort?: TagSort;
  signal?: AbortSignal;
}

export interface TagCleanupResponse {
  deleted_count: number;
  deleted_tags: string[];
}

export interface TemplateResponse {
  id: number;
  name: string;
  description: string | null;
  reference_image_url: string | null;
  reference_thumbnail_url: string | null;
  reference_mime_type: string | null;
  reference_width: number | null;
  reference_height: number | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateCreatePayload {
  name: string;
  description?: string | null;
}

export interface TemplateUpdatePayload {
  name?: string;
  description?: string | null;
}

export interface MemeResponse {
  id: number;
  title: string;
  description: string | null;
  source: string | null;
  original_filename: string;
  stored_filename: string;
  image_url: string;
  thumbnail_url: string | null;
  mime_type: string;
  file_size: number;
  width: number;
  height: number;
  file_hash: string;
  created_at: string;
  updated_at: string;
  tags: TagResponse[];
  template: TemplateResponse | null;
  images: MemeImageResponse[];
  image_count: number;
}

export interface MemeImageResponse {
  id: number;
  original_filename: string;
  stored_filename: string;
  image_url: string;
  thumbnail_url: string | null;
  mime_type: string;
  file_size: number;
  width: number;
  height: number;
  file_hash: string;
  position: number;
  created_at: string;
}

export interface MemeUpdatePayload {
  title?: string;
  description?: string | null;
  source?: string | null;
  tags?: string[];
  template_id?: number | null;
}

export interface UploadMemeInput {
  file: File;
  title: string;
  description?: string;
  source?: string;
  tags?: string[];
  template_id?: number | null;
}

export interface AITagSuggestionResponse {
  name: string;
  confidence: number;
  existing: boolean;
}

export interface AIAnalysisResponse {
  id: number;
  meme_id: number;
  model_name: string;
  suggested_title: string | null;
  description: string;
  suggestions: AITagSuggestionResponse[];
  created_at: string;
  confirmed_at: string | null;
  suggested_template: TemplateResponse | null;
}

export interface AIAnalysisConfirmPayload {
  tags: string[];
  apply_description: boolean;
  apply_title: boolean;
  template_id: number | null;
  apply_template: boolean;
}

export interface CreateImportJobInput {
  archive: File;
  tags: string[];
  template_id: number | null;
  source: string;
  chunk_size: number;
}

export type ImportJobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface ImportJobResponse {
  id: number;
  original_filename: string;
  status: ImportJobStatus;
  total_entries: number;
  image_entries: number;
  processed_count: number;
  success_count: number;
  skipped_count: number;
  failed_count: number;
  chunk_size: number;
  tags: string[];
  template_id: number | null;
  source: string | null;
  current_filename: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ImportJobItemResponse {
  id: number;
  entry_index: number;
  filename: string;
  status: "success" | "skipped" | "failed";
  meme_id: number | null;
  error_message: string | null;
  created_at: string;
}

export interface ImportJobItemPage {
  items: ImportJobItemResponse[];
  total: number;
  offset: number;
  limit: number;
}

export type ExportScope = "all" | "filtered";
export type ExportOrganization = "flat" | "template" | "tag";

export interface CreateExportJobInput {
  scope: ExportScope;
  query: string | null;
  tags: string[];
  template_id: number | null;
  organization: ExportOrganization;
  include_manifest: true;
  archive_name: string;
}

export interface ExportJobResponse {
  id: number;
  status: "pending" | "running" | "ready" | "completed_with_errors" | "cancelling" | "cancelled" | "interrupted" | "failed" | "expired";
  scope: ExportScope;
  query: string | null;
  tags: string[];
  template_id: number | null;
  organization: ExportOrganization;
  include_manifest: boolean;
  archive_name: string;
  total_memes: number;
  total_images: number;
  processed_memes: number;
  processed_images: number;
  success_count: number;
  skipped_count: number;
  failed_count: number;
  estimated_bytes: number;
  archive_size: number | null;
  current_meme_id: number | null;
  current_filename: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
}

export interface ExportJobItemResponse {
  id: number;
  meme_id: number;
  image_id: number;
  status: string;
  archive_filename: string | null;
  file_size: number;
  error_message: string | null;
  created_at: string;
}

export interface ExportJobItemPage {
  items: ExportJobItemResponse[];
  total: number;
  offset: number;
  limit: number;
}

export type CaptionLength = "short" | "medium" | "long";
export type CaptionSource = "manual" | "ai";
export type CaptionRewriteAction = "polish" | "shorten" | "expand" | "retone";

export interface CaptionResponse {
  id: number;
  meme_id: number;
  content: string;
  scene: string | null;
  tone: string | null;
  length: CaptionLength | null;
  source: CaptionSource;
  created_at: string;
  updated_at: string;
}

export interface CaptionCreatePayload {
  content: string;
  scene: string | null;
  tone: string | null;
  length: CaptionLength | null;
  source: CaptionSource;
}

export type CaptionUpdatePayload = Omit<
  Partial<CaptionCreatePayload>,
  "source"
>;

export interface CaptionGeneratePayload {
  count: 3 | 5 | 8;
  scene: string | null;
  tone: string | null;
  length: CaptionLength | null;
}

export interface CaptionRewritePayload
  extends Omit<CaptionGeneratePayload, "count"> {
  content: string;
  action: CaptionRewriteAction;
}

export interface CaptionCandidatesResponse {
  model_name: string;
  captions: string[];
}

export type AIProviderProtocol =
  | "openai_responses"
  | "openai_chat_completions"
  | "dashscope_multimodal_embedding";

export interface AIPresetModel {
  model_id: string;
  display_name: string;
  supports_vision: boolean;
  supports_image_embedding: boolean;
}

export interface AIProviderPreset {
  id: string;
  name: string;
  base_url: string;
  protocol: AIProviderProtocol;
  description: string;
  models: AIPresetModel[];
}

export interface AIProviderResponse {
  id: number;
  name: string;
  protocol: AIProviderProtocol;
  base_url: string;
  has_api_key: boolean;
  api_key_hint: string | null;
  timeout_seconds: number;
  max_retries: number;
  retry_delay_seconds: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AIProviderCreatePayload {
  preset_id?: string | null;
  name: string;
  protocol: AIProviderProtocol;
  base_url: string;
  api_key?: string | null;
  timeout_seconds: number;
  max_retries: number;
  retry_delay_seconds: number;
  enabled: boolean;
}

export type AIProviderUpdatePayload = Partial<
  Omit<AIProviderCreatePayload, "preset_id">
>;

export interface AIModelResponse {
  id: number;
  provider_id: number;
  model_id: string;
  display_name: string;
  supports_vision: boolean;
  supports_image_embedding: boolean;
  enabled: boolean;
  is_active: boolean;
  is_embedding_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AIModelCreatePayload {
  provider_id: number;
  model_id: string;
  display_name: string;
  supports_vision: boolean;
  supports_image_embedding: boolean;
  enabled: boolean;
  is_active: boolean;
  is_embedding_active: boolean;
}

export type AIModelUpdatePayload = Partial<
  Omit<AIModelCreatePayload, "provider_id">
>;

export interface AIConnectionTestResponse {
  ok: boolean;
  message: string;
  model_count: number;
}

export interface ListMemesOptions {
  offset: number;
  limit: number;
  q?: string;
  tags?: string[];
  signal?: AbortSignal;
}

export type MemeListSort = "default" | "shuffle";
export type MemeCardSize = "extra-large" | "large" | "medium" | "small";
export type MemePageSize = 24 | 48 | 96;

export interface MemePageResponse {
  items: MemeResponse[];
  total: number;
  page: number;
  page_size: MemePageSize;
  total_pages: number;
  sort: MemeListSort;
  shuffle_seed: number | null;
}

export interface ListMemePageOptions {
  page: number;
  pageSize: MemePageSize;
  q?: string;
  tags?: string[];
  sort: MemeListSort;
  shuffleSeed?: number | null;
  signal?: AbortSignal;
}

export interface AppState {
  relatedMemes: MemeResponse[];
  relationQuery: string;
  selectedRelationIds: number[];
  relationsLoading: boolean;
  relationsSaving: boolean;
  relationRemovingId: number | null;
  relationError: string | null;
  imageOperation: "append" | "reorder" | number | null;
  imageError: string | null;
  memes: MemeResponse[];
  availableTags: TagResponse[];
  availableTemplates: TemplateResponse[];
  selectedMeme: MemeResponse | null;
  query: string;
  selectedTags: string[];
  tagsExpanded: boolean;
  page: number;
  pageSize: MemePageSize;
  totalMemes: number;
  totalPages: number;
  listSort: MemeListSort;
  shuffleSeed: number | null;
  cardSize: MemeCardSize;
  templatePage: number;
  loadingList: boolean;
  saving: boolean;
  deleting: boolean;
  randomizing: boolean;
  analyzing: boolean;
  confirmingAnalysis: boolean;
  aiAnalysis: AIAnalysisResponse | null;
  selectedAITags: string[];
  applyAIDescription: boolean;
  applyAITitle: boolean;
  selectedAITemplateId: number | null;
  applyAITemplate: boolean;
  aiError: string | null;
  listError: string | null;
  actionError: string | null;
  operationError: string | null;
}
