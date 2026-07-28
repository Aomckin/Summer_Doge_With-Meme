export interface TagResponse {
  id: number;
  name: string;
  category: string;
  description: string | null;
  created_at: string;
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
}

export interface MemeUpdatePayload {
  title?: string;
  description?: string | null;
  source?: string | null;
  tags?: string[];
}

export interface UploadMemeInput {
  file: File;
  title: string;
  description?: string;
  source?: string;
  tags?: string[];
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
  description: string;
  suggestions: AITagSuggestionResponse[];
  created_at: string;
  confirmed_at: string | null;
}

export interface AIAnalysisConfirmPayload {
  tags: string[];
  apply_description: boolean;
}

export type AIProviderProtocol =
  | "openai_responses"
  | "openai_chat_completions";

export interface AIPresetModel {
  model_id: string;
  display_name: string;
  supports_vision: boolean;
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
  enabled: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AIModelCreatePayload {
  provider_id: number;
  model_id: string;
  display_name: string;
  supports_vision: boolean;
  enabled: boolean;
  is_active: boolean;
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

export interface AppState {
  memes: MemeResponse[];
  availableTags: TagResponse[];
  selectedMeme: MemeResponse | null;
  query: string;
  selectedTags: string[];
  offset: number;
  hasMore: boolean;
  loadingList: boolean;
  loadingMore: boolean;
  uploading: boolean;
  saving: boolean;
  deleting: boolean;
  randomizing: boolean;
  analyzing: boolean;
  confirmingAnalysis: boolean;
  aiAnalysis: AIAnalysisResponse | null;
  selectedAITags: string[];
  applyAIDescription: boolean;
  aiError: string | null;
  listError: string | null;
  loadMoreError: string | null;
  actionError: string | null;
  operationError: string | null;
}
