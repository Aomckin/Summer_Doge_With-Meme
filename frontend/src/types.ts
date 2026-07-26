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
  listError: string | null;
  loadMoreError: string | null;
  actionError: string | null;
  operationError: string | null;
}
