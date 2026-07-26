import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  deleteMeme,
  listMemes,
  parseTagInput,
  updateMeme,
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
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = init.body as FormData;
    expect(body.get("title")).toBe("测试 Meme");
    expect(body.has("description")).toBe(false);
    expect(body.has("source")).toBe(false);
    expect(body.has("tags")).toBe(false);
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
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/memes/7");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      title: "新标题",
      description: null,
      source: null,
      tags: ["funny", "cat"],
    });
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
