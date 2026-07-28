import type {
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
  ListMemesOptions,
  MemeResponse,
  MemeUpdatePayload,
  TagResponse,
  TemplateCreatePayload,
  TemplateResponse,
  TemplateUpdatePayload,
  UploadMemeInput,
} from "./types";

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

function normalizeTags(tags: string[]): string[] {
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

export function listTags(signal?: AbortSignal): Promise<TagResponse[]> {
  return requestJson<TagResponse[]>("/api/tags", { signal });
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
