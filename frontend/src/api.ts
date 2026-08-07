import type {
  CreateImportJobInput,
  ImportJobItemPage,
  ImportJobResponse,
  CreateExportJobInput,
  ExportJobItemPage,
  ExportJobResponse,
  AIAnalysisConfirmPayload,
  AIAnalysisResponse,
  AIConnectionTestResponse,
  AIModelCreatePayload,
  AIModelResponse,
  AIModelUpdatePayload,
  AIProviderCreatePayload,
  AIProviderPreset,
  AIProviderResponse,
  AIProviderUpdatePayload,
  CaptionCandidatesResponse,
  CaptionCreatePayload,
  CaptionGeneratePayload,
  CaptionResponse,
  CaptionRewritePayload,
  CaptionUpdatePayload,
  ListMemePageOptions,
  ListMemesOptions,
  ListTagsOptions,
  MemeResponse,
  MemePageResponse,
  MemeUpdatePayload,
  TagResponse,
  TagCleanupResponse,
  TemplateCreatePayload,
  TemplateResponse,
  TemplateUpdatePayload,
  UploadMemeInput,
  SemanticSearchInput,
  SemanticSearchResponse,
  SemanticIndexStatus,
  EmbeddingJobScope,
  EmbeddingJobResponse,
  EmbeddingJobItemPage,
  ScoredMemeResponse,
  MemeEmbeddingStatus,
} from "./types";

export function semanticSearch(input: SemanticSearchInput): Promise<SemanticSearchResponse> {
  return requestJson<SemanticSearchResponse>("/api/semantic-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: input.query,
      tags: normalizeTags(input.tags),
      page: input.page,
      page_size: input.page_size,
    }),
    signal: input.signal,
  });
}

export function getSemanticIndexStatus(): Promise<SemanticIndexStatus> {
  return requestJson<SemanticIndexStatus>("/api/semantic-index/status");
}

export function createEmbeddingJob(scope: EmbeddingJobScope, maxWorkers: number): Promise<EmbeddingJobResponse> {
  return requestJson<EmbeddingJobResponse>("/api/embedding-jobs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, max_workers: maxWorkers }),
  });
}

export function getEmbeddingJob(id: number): Promise<EmbeddingJobResponse> {
  return requestJson<EmbeddingJobResponse>(`/api/embedding-jobs/${id}`);
}

export function listEmbeddingJobItems(id: number, offset = 0, limit = 50, status = "failed"): Promise<EmbeddingJobItemPage> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit), status });
  return requestJson<EmbeddingJobItemPage>(`/api/embedding-jobs/${id}/items?${params}`);
}

export function cancelEmbeddingJob(id: number): Promise<EmbeddingJobResponse> {
  return requestJson<EmbeddingJobResponse>(`/api/embedding-jobs/${id}/cancel`, { method: "POST" });
}

export function retryFailedEmbeddingJob(id: number): Promise<EmbeddingJobResponse> {
  return requestJson<EmbeddingJobResponse>(`/api/embedding-jobs/${id}/retry-failed`, { method: "POST" });
}

export async function deleteEmbeddingJob(id: number): Promise<void> {
  await requestJson<void>(`/api/embedding-jobs/${id}`, { method: "DELETE" });
}

export function listSimilarMemes(id: number, limit = 12, signal?: AbortSignal): Promise<{ items: ScoredMemeResponse[] }> {
  return requestJson<{ items: ScoredMemeResponse[] }>(`/api/memes/${id}/similar?limit=${limit}`, { signal });
}

export function rebuildMemeEmbedding(id: number): Promise<MemeEmbeddingStatus> {
  return requestJson<MemeEmbeddingStatus>(`/api/memes/${id}/embedding/rebuild`, { method: "POST" });
}

export async function createImportJob(
  input: CreateImportJobInput,
): Promise<ImportJobResponse> {
  const form = new FormData();
  form.append("archive", input.archive);
  form.append("tags", normalizeTags(input.tags).join(","));
  form.append("template_id", input.template_id?.toString() ?? "");
  form.append("source", input.source);
  form.append("chunk_size", input.chunk_size.toString());
  return requestJson<ImportJobResponse>("/api/import-jobs", {
    method: "POST",
    body: form,
  });
}

export function getImportJob(id: number): Promise<ImportJobResponse> {
  return requestJson<ImportJobResponse>(`/api/import-jobs/${id}`);
}

export function listImportJobItems(
  id: number,
  offset = 0,
  limit = 50,
  status = "failed",
): Promise<ImportJobItemPage> {
  const query = new URLSearchParams({
    offset: offset.toString(),
    limit: limit.toString(),
    status,
  });
  return requestJson<ImportJobItemPage>(
    `/api/import-jobs/${id}/items?${query.toString()}`,
  );
}

export function cancelImportJob(id: number): Promise<ImportJobResponse> {
  return requestJson<ImportJobResponse>(`/api/import-jobs/${id}/cancel`, {
    method: "POST",
  });
}

export function retryFailedImportJob(id: number): Promise<ImportJobResponse> {
  return requestJson<ImportJobResponse>(
    `/api/import-jobs/${id}/retry-failed`,
    { method: "POST" },
  );
}

export async function deleteImportJob(id: number): Promise<void> {
  await requestJson<void>(`/api/import-jobs/${id}`, { method: "DELETE" });
}

export function createExportJob(input: CreateExportJobInput): Promise<ExportJobResponse> {
  return requestJson<ExportJobResponse>("/api/export-jobs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
}

export function getExportJob(id: number): Promise<ExportJobResponse> {
  return requestJson<ExportJobResponse>(`/api/export-jobs/${id}`);
}

export function listExportJobItems(id: number, offset = 0, limit = 50): Promise<ExportJobItemPage> {
  return requestJson<ExportJobItemPage>(`/api/export-jobs/${id}/items?offset=${offset}&limit=${limit}&failed_only=true`);
}

export function cancelExportJob(id: number): Promise<ExportJobResponse> {
  return requestJson<ExportJobResponse>(`/api/export-jobs/${id}/cancel`, { method: "POST" });
}

export async function deleteExportJob(id: number): Promise<void> {
  await requestJson<void>(`/api/export-jobs/${id}`, { method: "DELETE" });
}

interface ValidationDetail {
  loc?: Array<string | number>;
  msg?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function normalizeTags(tags: string[]): string[] {
  return [
    ...new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0),
    ),
  ];
}

export function parseTagInput(value: string): string[] {
  return normalizeTags(value.split(","));
}

function validationMessage(details: ValidationDetail[]): string {
  return details
    .map((detail) => {
      const field = detail.loc?.at(-1);
      return field ? `${field}: ${detail.msg ?? "参数无效"}` : detail.msg;
    })
    .filter((message): message is string => Boolean(message))
    .join("；");
}

async function errorMessage(response: Response): Promise<string> {
  const fallback = `请求失败（HTTP ${response.status}）`;
  const text = await response.text();
  if (!text) {
    return fallback;
  }

  try {
    const payload = JSON.parse(text) as {
      detail?: string | ValidationDetail[];
    };
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
    if (Array.isArray(payload.detail)) {
      return validationMessage(payload.detail) || fallback;
    }
  } catch {
    return text;
  }

  return fallback;
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function listMemes(options: ListMemesOptions): Promise<MemeResponse[]> {
  const params = new URLSearchParams({
    offset: String(options.offset),
    limit: String(options.limit),
  });
  const query = options.q?.trim();
  if (query) {
    params.set("q", query);
  }
  for (const tag of normalizeTags(options.tags ?? [])) {
    params.append("tags", tag);
  }

  return requestJson<MemeResponse[]>(`/api/memes?${params}`, {
    signal: options.signal,
  });
}

export function listTags(options: ListTagsOptions = {}): Promise<TagResponse[]> {
  const params = new URLSearchParams();
  if (options.includeEmpty) params.set("include_empty", "true");
  const query = options.q?.trim();
  if (query) params.set("q", query);
  if (options.sort) params.set("sort", options.sort);
  const suffix = params.size ? `?${params}` : "";
  return requestJson<TagResponse[]>(`/api/tags${suffix}`, {
    signal: options.signal,
  });
}

export function listMemePage(
  options: ListMemePageOptions,
): Promise<MemePageResponse> {
  const params = new URLSearchParams({
    page: String(options.page),
    page_size: String(options.pageSize),
    sort: options.sort,
  });
  const query = options.q?.trim();
  if (query) params.set("q", query);
  for (const tag of options.tags ?? []) params.append("tags", tag);
  if (options.sort === "shuffle" && options.shuffleSeed !== null && options.shuffleSeed !== undefined) {
    params.set("shuffle_seed", String(options.shuffleSeed));
  }
  return requestJson<MemePageResponse>(`/api/memes/page?${params}`, {
    signal: options.signal,
  });
}

export function renameTag(id: number, name: string): Promise<TagResponse> {
  return requestJson<TagResponse>(
    `/api/tags/${id}`,
    jsonRequest("PATCH", { name }),
  );
}

export function mergeTag(sourceId: number, targetId: number): Promise<TagResponse> {
  return requestJson<TagResponse>(
    `/api/tags/${sourceId}/merge`,
    jsonRequest("POST", { target_tag_id: targetId }),
  );
}

export function deleteTag(id: number): Promise<void> {
  return requestJson<void>(`/api/tags/${id}`, { method: "DELETE" });
}

export function cleanupEmptyTags(): Promise<TagCleanupResponse> {
  return requestJson<TagCleanupResponse>(
    "/api/tags/cleanup-empty",
    jsonRequest("POST", { confirm: true }),
  );
}

export function listTemplates(): Promise<TemplateResponse[]> {
  return requestJson<TemplateResponse[]>("/api/templates");
}

export function createTemplate(
  payload: TemplateCreatePayload,
): Promise<TemplateResponse> {
  return requestJson<TemplateResponse>(
    "/api/templates",
    jsonRequest("POST", payload),
  );
}

export function updateTemplate(
  id: number,
  payload: TemplateUpdatePayload,
): Promise<TemplateResponse> {
  return requestJson<TemplateResponse>(
    `/api/templates/${id}`,
    jsonRequest("PATCH", payload),
  );
}

export function deleteTemplate(id: number): Promise<void> {
  return requestJson<void>(`/api/templates/${id}`, { method: "DELETE" });
}

export function createTemplateWithReferenceImage(
  payload: TemplateCreatePayload,
  file: File,
): Promise<TemplateResponse> {
  const body = new FormData();
  body.append("name", payload.name);
  if (payload.description) {
    body.append("description", payload.description);
  }
  body.append("file", file);
  return requestJson<TemplateResponse>(
    "/api/templates/with-reference-image",
    { method: "POST", body },
  );
}

export function uploadTemplateReferenceImage(id: number, file: File): Promise<TemplateResponse> {
  const body = new FormData();
  body.append("file", file);
  return requestJson<TemplateResponse>(`/api/templates/${id}/reference-image`, { method: "POST", body });
}

export function deleteTemplateReferenceImage(id: number): Promise<void> {
  return requestJson<void>(`/api/templates/${id}/reference-image`, { method: "DELETE" });
}

export function getRandomMeme(
  tags: string[],
  signal?: AbortSignal,
): Promise<MemeResponse> {
  const params = new URLSearchParams();
  for (const tag of normalizeTags(tags)) {
    params.append("tags", tag);
  }
  const query = params.size ? `?${params}` : "";
  return requestJson<MemeResponse>(`/api/memes/random${query}`, { signal });
}

export function uploadMeme(input: UploadMemeInput): Promise<MemeResponse> {
  const body = new FormData();
  body.append("file", input.file);
  body.append("title", input.title.trim());

  const description = input.description?.trim();
  if (description) {
    body.append("description", description);
  }
  const source = input.source?.trim();
  if (source) {
    body.append("source", source);
  }
  const tags = normalizeTags(input.tags ?? []);
  if (tags.length) {
    body.append("tags", tags.join(","));
  }
  if (typeof input.template_id === "number") {
    body.append("template_id", String(input.template_id));
  }

  return requestJson<MemeResponse>("/api/memes", {
    method: "POST",
    body,
  });
}

export function updateMeme(
  id: number,
  payload: MemeUpdatePayload,
): Promise<MemeResponse> {
  const body: MemeUpdatePayload = {};
  if (Object.hasOwn(payload, "title")) {
    body.title = payload.title?.trim();
  }
  if (Object.hasOwn(payload, "description")) {
    body.description = payload.description?.trim() || null;
  }
  if (Object.hasOwn(payload, "source")) {
    body.source = payload.source?.trim() || null;
  }
  if (Object.hasOwn(payload, "tags")) {
    body.tags = normalizeTags(payload.tags ?? []);
  }
  if (Object.hasOwn(payload, "template_id")) {
    body.template_id = payload.template_id ?? null;
  }

  return requestJson<MemeResponse>(`/api/memes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteMeme(id: number): Promise<void> {
  return requestJson<void>(`/api/memes/${id}`, { method: "DELETE" });
}

function normalizeCaptionMetadata<T extends {
  content?: string;
  scene?: string | null;
  tone?: string | null;
}>(payload: T): T {
  return {
    ...payload,
    ...(Object.hasOwn(payload, "content")
      ? { content: payload.content?.trim() }
      : {}),
    ...(Object.hasOwn(payload, "scene")
      ? { scene: payload.scene?.trim() || null }
      : {}),
    ...(Object.hasOwn(payload, "tone")
      ? { tone: payload.tone?.trim() || null }
      : {}),
  };
}

export function listCaptions(
  memeId: number,
  signal?: AbortSignal,
): Promise<CaptionResponse[]> {
  return requestJson<CaptionResponse[]>(
    `/api/memes/${memeId}/captions`,
    { signal },
  );
}

export function createCaption(
  memeId: number,
  payload: CaptionCreatePayload,
): Promise<CaptionResponse> {
  return requestJson<CaptionResponse>(
    `/api/memes/${memeId}/captions`,
    jsonRequest("POST", normalizeCaptionMetadata(payload)),
  );
}

export function updateCaption(
  memeId: number,
  captionId: number,
  payload: CaptionUpdatePayload,
): Promise<CaptionResponse> {
  return requestJson<CaptionResponse>(
    `/api/memes/${memeId}/captions/${captionId}`,
    jsonRequest("PATCH", normalizeCaptionMetadata(payload)),
  );
}

export function deleteCaption(
  memeId: number,
  captionId: number,
): Promise<void> {
  return requestJson<void>(
    `/api/memes/${memeId}/captions/${captionId}`,
    { method: "DELETE" },
  );
}

export function generateCaptions(
  memeId: number,
  payload: CaptionGeneratePayload,
): Promise<CaptionCandidatesResponse> {
  return requestJson<CaptionCandidatesResponse>(
    `/api/memes/${memeId}/captions/generate`,
    jsonRequest("POST", normalizeCaptionMetadata(payload)),
  );
}

export function rewriteCaption(
  memeId: number,
  payload: CaptionRewritePayload,
): Promise<CaptionCandidatesResponse> {
  return requestJson<CaptionCandidatesResponse>(
    `/api/memes/${memeId}/captions/rewrite`,
    jsonRequest("POST", normalizeCaptionMetadata(payload)),
  );
}

export function appendMemeImage(id: number, file: File): Promise<MemeResponse> {
  const body = new FormData();
  body.append("file", file);
  return requestJson<MemeResponse>(`/api/memes/${id}/images`, { method: "POST", body });
}

export function reorderMemeImages(id: number, imageIds: number[]): Promise<MemeResponse> {
  return requestJson<MemeResponse>(`/api/memes/${id}/images/order`, jsonRequest("PATCH", { image_ids: imageIds }));
}

export function deleteMemeImage(id: number, imageId: number): Promise<MemeResponse> {
  return requestJson<MemeResponse>(`/api/memes/${id}/images/${imageId}`, { method: "DELETE" });
}

export function listMemeRelations(id: number): Promise<MemeResponse[]> {
  return requestJson<MemeResponse[]>(`/api/memes/${id}/relations`);
}

export function addMemeRelations(id: number, memeIds: number[]): Promise<MemeResponse[]> {
  return requestJson<MemeResponse[]>(`/api/memes/${id}/relations`, jsonRequest("POST", { meme_ids: memeIds }));
}

export function deleteMemeRelation(id: number, relatedId: number): Promise<void> {
  return requestJson<void>(`/api/memes/${id}/relations/${relatedId}`, { method: "DELETE" });
}

export function analyzeMeme(id: number): Promise<AIAnalysisResponse> {
  return requestJson<AIAnalysisResponse>(`/api/memes/${id}/analyze`, {
    method: "POST",
  });
}

export function confirmAIAnalysis(
  memeId: number,
  analysisId: number,
  payload: AIAnalysisConfirmPayload,
): Promise<MemeResponse> {
  return requestJson<MemeResponse>(
    `/api/memes/${memeId}/analyses/${analysisId}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tags: normalizeTags(payload.tags),
        apply_description: payload.apply_description,
        apply_title: payload.apply_title,
        template_id: payload.template_id,
        apply_template: payload.apply_template,
      }),
    },
  );
}

function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export function listAIProviderPresets(): Promise<AIProviderPreset[]> {
  return requestJson<AIProviderPreset[]>("/api/ai-settings/presets");
}

export function listAIProviders(): Promise<AIProviderResponse[]> {
  return requestJson<AIProviderResponse[]>("/api/ai-settings/providers");
}

export function createAIProvider(
  payload: AIProviderCreatePayload,
): Promise<AIProviderResponse> {
  return requestJson<AIProviderResponse>(
    "/api/ai-settings/providers",
    jsonRequest("POST", payload),
  );
}

export function updateAIProvider(
  id: number,
  payload: AIProviderUpdatePayload,
): Promise<AIProviderResponse> {
  return requestJson<AIProviderResponse>(
    `/api/ai-settings/providers/${id}`,
    jsonRequest("PATCH", payload),
  );
}

export function deleteAIProvider(id: number): Promise<void> {
  return requestJson<void>(`/api/ai-settings/providers/${id}`, {
    method: "DELETE",
  });
}

export function testAIProvider(
  id: number,
): Promise<AIConnectionTestResponse> {
  return requestJson<AIConnectionTestResponse>(
    `/api/ai-settings/providers/${id}/test`,
    { method: "POST" },
  );
}

export function refreshAIModels(id: number): Promise<AIModelResponse[]> {
  return requestJson<AIModelResponse[]>(
    `/api/ai-settings/providers/${id}/refresh-models`,
    { method: "POST" },
  );
}

export function listAIModels(): Promise<AIModelResponse[]> {
  return requestJson<AIModelResponse[]>("/api/ai-settings/models");
}

export function createAIModel(
  payload: AIModelCreatePayload,
): Promise<AIModelResponse> {
  return requestJson<AIModelResponse>(
    "/api/ai-settings/models",
    jsonRequest("POST", payload),
  );
}

export function updateAIModel(
  id: number,
  payload: AIModelUpdatePayload,
): Promise<AIModelResponse> {
  return requestJson<AIModelResponse>(
    `/api/ai-settings/models/${id}`,
    jsonRequest("PATCH", payload),
  );
}

export function deleteAIModel(id: number): Promise<void> {
  return requestJson<void>(`/api/ai-settings/models/${id}`, {
    method: "DELETE",
  });
}
