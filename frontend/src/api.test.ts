import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  addMemeRelations,
  analyzeMeme,
  appendMemeImage,
  confirmAIAnalysis,
  createCaption,
  createAIProvider,
  createTemplate,
  createTemplateWithReferenceImage,
  deleteMeme,
  deleteMemeImage,
  deleteMemeRelation,
  deleteCaption,
  deleteTemplate,
  listTemplates,
  listMemes,
  listMemeRelations,
  listCaptions,
  parseTagInput,
  generateCaptions,
  reorderMemeImages,
  testAIProvider,
  rewriteCaption,
  updateAIModel,
  updateAIProvider,
  updateMeme,
  updateCaption,
  updateTemplate,
  uploadMeme,
} from "./api";
import type { MemeResponse } from "./types";

const meme: MemeResponse = {
  id: 7,
  title: "测试 Meme",
  description: null,
  source: null,
  original_filename: "test.png",
  stored_filename: "stored.png",
  image_url: "/media/images/stored.png",
  thumbnail_url: "/media/thumbnails/stored.png",
  mime_type: "image/png",
  file_size: 128,
  width: 320,
  height: 240,
  file_hash: "abc123",
  created_at: "2026-07-25T00:00:00Z",
  updated_at: "2026-07-25T00:00:00Z",
  tags: [],
  template: null,
  images: [],
  image_count: 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listMemes", () => {
  it("serializes repeated tags and omits a blank query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([meme]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listMemes({
      offset: 24,
      limit: 24,
      q: "   ",
      tags: ["funny", "cat"],
    });

    expect(result).toEqual([meme]);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "/api/memes?offset=24&limit=24&tags=funny&tags=cat",
    );
  });
});

describe("uploadMeme", () => {
  it("omits blank optional fields instead of sending null strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(meme, 201));
    vi.stubGlobal("fetch", fetchMock);

    await uploadMeme({
      file: new File(["image"], "test.png", { type: "image/png" }),
      title: "  测试 Meme  ",
      description: "   ",
      source: "",
      tags: [],
      template_id: 3,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = init.body as FormData;
    expect(body.get("title")).toBe("测试 Meme");
    expect(body.has("description")).toBe(false);
    expect(body.has("source")).toBe(false);
    expect(body.has("tags")).toBe(false);
    expect(body.get("template_id")).toBe("3");
    expect([...body.values()]).not.toContain("null");
  });
});

describe("updateMeme", () => {
  it("sends JSON null for cleared optional fields and normalized tags", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(meme));
    vi.stubGlobal("fetch", fetchMock);

    await updateMeme(7, {
      title: "  新标题 ",
      description: null,
      source: null,
      tags: [" Funny ", "cat", "funny"],
      template_id: null,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/memes/7");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      title: "新标题",
      description: null,
      source: null,
      tags: ["funny", "cat"],
      template_id: null,
    });
  });
});

describe("templates", () => {
  it("lists, creates, updates and deletes templates", async () => {
    const template = {
      id: 3,
      name: "Doge",
      description: null,
      created_at: "2026-07-28T00:00:00Z",
      updated_at: "2026-07-28T00:00:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([template]))
      .mockResolvedValueOnce(jsonResponse(template, 201))
      .mockResolvedValueOnce(jsonResponse({ ...template, description: "柴犬" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listTemplates()).resolves.toEqual([template]);
    await createTemplate({ name: "Doge", description: null });
    await updateTemplate(3, { description: "柴犬" });
    await expect(deleteTemplate(3)).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0]).toEqual(["/api/templates", undefined]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      name: "Doge",
      description: null,
    });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/templates/3");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      description: "柴犬",
    });
    expect(fetchMock.mock.calls[3]).toEqual([
      "/api/templates/3",
      { method: "DELETE" },
    ]);
  });
});

describe("deleteMeme", () => {
  it("accepts a 204 response without parsing a body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(deleteMeme(7)).resolves.toBeUndefined();
  });
});

describe("caption API", () => {
  it("uses the nested Meme caption endpoints and preserves null metadata", async () => {
    const caption = {
      id: 4,
      meme_id: 7,
      content: "测试文案",
      scene: null,
      tone: "吐槽",
      length: "short" as const,
      source: "manual" as const,
      created_at: "2026-07-31T00:00:00Z",
      updated_at: "2026-07-31T00:00:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([caption]))
      .mockResolvedValueOnce(jsonResponse(caption, 201))
      .mockResolvedValueOnce(jsonResponse(caption))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await listCaptions(7);
    await createCaption(7, {
      content: " 测试文案 ",
      scene: null,
      tone: " 吐槽 ",
      length: "short",
      source: "manual",
    });
    await updateCaption(7, 4, { content: " 修改 " });
    await deleteCaption(7, 4);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/memes/7/captions");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/memes/7/captions");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      content: "测试文案",
      scene: null,
      tone: "吐槽",
      length: "short",
      source: "manual",
    });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/memes/7/captions/4");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({
      content: "修改",
    });
    expect(fetchMock.mock.calls[3][1].method).toBe("DELETE");
  });

  it("sends generate and rewrite options as JSON", async () => {
    const result = { model_name: "vision", captions: ["候选"] };
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse(result));
    vi.stubGlobal("fetch", fetchMock);

    await generateCaptions(7, {
      count: 5,
      scene: "群聊",
      tone: null,
      length: "medium",
    });
    await rewriteCaption(7, {
      content: "草稿",
      action: "polish",
      scene: null,
      tone: "冷幽默",
      length: null,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/memes/7/captions/generate",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/memes/7/captions/rewrite",
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      content: "草稿",
      action: "polish",
      tone: "冷幽默",
    });
  });

  it("creates a referenced template with multipart form data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: 3, name: "Doge" }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["image"], "doge.png", { type: "image/png" });

    await createTemplateWithReferenceImage(
      { name: "Doge", description: "classic" },
      file,
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/templates/with-reference-image",
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect(body.get("name")).toBe("Doge");
    expect(body.get("description")).toBe("classic");
    expect(body.get("file")).toBe(file);
  });
});

describe("composite images and direct relations", () => {
  it("uses the image lifecycle endpoint contracts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(meme))
      .mockResolvedValueOnce(jsonResponse(meme))
      .mockResolvedValueOnce(jsonResponse(meme));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["image"], "next.png", { type: "image/png" });

    await appendMemeImage(7, file);
    await reorderMemeImages(7, [4, 2, 9]);
    await deleteMemeImage(7, 4);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/memes/7/images");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].body.get("file")).toBe(file);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/memes/7/images/order");
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      image_ids: [4, 2, 9],
    });
    expect(fetchMock.mock.calls[2]).toEqual([
      "/api/memes/7/images/4",
      { method: "DELETE" },
    ]);
  });

  it("uses the direct relation endpoint contracts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([meme]))
      .mockResolvedValueOnce(jsonResponse([meme]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await listMemeRelations(7);
    await addMemeRelations(7, [2, 3]);
    await deleteMemeRelation(7, 2);

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/memes/7/relations",
      undefined,
    ]);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/memes/7/relations");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      meme_ids: [2, 3],
    });
    expect(fetchMock.mock.calls[2]).toEqual([
      "/api/memes/7/relations/2",
      { method: "DELETE" },
    ]);
  });
});

describe("AI analysis", () => {
  it("requests analysis and confirms normalized selected tags", async () => {
    const analysis = {
      id: 3,
      meme_id: 7,
      model_name: "gpt-5.6-luna-test",
      suggested_title: "看到需求时的我",
      description: "AI 描述",
      suggestions: [
        { name: "reaction", confidence: 0.91, existing: true },
      ],
      created_at: "2026-07-27T00:00:00Z",
      confirmed_at: null,
      suggested_template: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(analysis))
      .mockResolvedValueOnce(jsonResponse(meme));
    vi.stubGlobal("fetch", fetchMock);

    await expect(analyzeMeme(7)).resolves.toEqual(analysis);
    await confirmAIAnalysis(7, 3, {
      tags: [" Reaction ", "reaction", "NEW"],
      apply_description: true,
      apply_title: true,
      template_id: null,
      apply_template: false,
    });

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/memes/7/analyze",
      { method: "POST" },
    ]);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/memes/7/analyses/3/confirm");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      tags: ["reaction", "new"],
      apply_description: true,
      apply_title: true,
      template_id: null,
      apply_template: false,
    });
  });
});

describe("AI settings", () => {
  it("creates a provider and omits an unchanged API key on patch", async () => {
    const provider = {
      id: 2,
      name: "Qwen",
      protocol: "openai_chat_completions",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      has_api_key: true,
      api_key_hint: "••••1234",
      timeout_seconds: 30,
      max_retries: 1,
      retry_delay_seconds: 1,
      enabled: true,
      created_at: "2026-07-27T00:00:00Z",
      updated_at: "2026-07-27T00:00:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(provider))
      .mockResolvedValueOnce(jsonResponse(provider));
    vi.stubGlobal("fetch", fetchMock);

    await createAIProvider({
      preset_id: "qwen",
      name: "Qwen",
      protocol: "openai_chat_completions",
      base_url: provider.base_url,
      api_key: "secret",
      timeout_seconds: 30,
      max_retries: 1,
      retry_delay_seconds: 1,
      enabled: true,
    });
    await updateAIProvider(2, { name: "Qwen 主账号" });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai-settings/providers");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(
      expect.objectContaining({ preset_id: "qwen", api_key: "secret" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      name: "Qwen 主账号",
    });
    expect(fetchMock.mock.calls[1][1].body).not.toContain("api_key");
  });

  it("tests providers and activates a selected model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, message: "连接成功", model_count: 3 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 4,
          provider_id: 2,
          model_id: "qwen3.6-flash",
          display_name: "Qwen3.6 Flash",
          supports_vision: true,
          enabled: true,
          is_active: true,
          created_at: "2026-07-27T00:00:00Z",
          updated_at: "2026-07-27T00:00:00Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await testAIProvider(2);
    await updateAIModel(4, { is_active: true });

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/ai-settings/providers/2/test",
      { method: "POST" },
    ]);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/ai-settings/models/4");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      is_active: true,
    });
  });
});

describe("API errors", () => {
  it("turns FastAPI validation details into a readable ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            detail: [
              { loc: ["body", "title"], msg: "Field required", type: "missing" },
              { loc: ["body", "file"], msg: "Invalid image", type: "value_error" },
            ],
          },
          422,
        ),
      ),
    );

    const error = await listMemes({ offset: 0, limit: 24 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      message: "title: Field required；file: Invalid image",
    });
  });
});

describe("parseTagInput", () => {
  it("trims, lowercases and deduplicates comma-separated tags", () => {
    expect(parseTagInput(" Funny, cat, funny, , Reaction ")).toEqual([
      "funny",
      "cat",
      "reaction",
    ]);
  });
});
