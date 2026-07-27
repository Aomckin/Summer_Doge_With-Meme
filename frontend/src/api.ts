import type {
  AIAnalysisConfirmPayload,
  AIAnalysisResponse,
  ListMemesOptions,
  MemeResponse,
  MemeUpdatePayload,
  TagResponse,
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
      }),
    },
  );
}
