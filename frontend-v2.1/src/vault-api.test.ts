import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createExportJob,
  createImportJob,
  createVault,
  deleteVault,
  getRandomMeme,
  listMemePage,
  listTags,
  listVaults,
  semanticSearch,
  uploadMeme,
} from "./api";

const vault = {
  id: 2,
  name: "二次元收藏",
  slug: "anime",
  type: "generic",
  profile: "anime",
  capabilities: { semanticSearch: true, favorite: true },
  description: null,
  icon: "🌸",
  meme_count: 0,
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

describe("vault management api", () => {
  it("lists vaults from /api/vaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([vault]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listVaults();

    expect(result).toEqual([vault]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/vaults");
  });

  it("creates a vault via POST /api/vaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(vault, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createVault({ name: "二次元收藏", slug: "anime", profile: "anime", icon: "🌸" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/vaults");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ slug: "anime", profile: "anime" });
  });

  it("deletes with explicit force query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteVault(2, true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/vaults/2?force=true");
    expect(init.method).toBe("DELETE");
  });
});

describe("vault-scoped asset api", () => {
  it("routes listMemePage to the vault endpoint when vaultId is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ items: [], total: 0, page: 1, page_size: 24, total_pages: 0, sort: "default", shuffle_seed: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listMemePage({ page: 1, pageSize: 24, sort: "default", vaultId: 2 });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/vaults/2/memes/page?page=1&page_size=24&sort=default");
  });

  it("keeps the legacy listMemePage endpoint without vaultId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ items: [], total: 0, page: 1, page_size: 24, total_pages: 0, sort: "default", shuffle_seed: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listMemePage({ page: 1, pageSize: 24, sort: "default" });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/memes/page?page=1&page_size=24&sort=default");
  });

  it("routes listTags to the vault endpoint when vaultId is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await listTags({ vaultId: 2 });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/vaults/2/tags");
  });

  it("routes semanticSearch to the vault endpoint when vaultId is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ items: [], total: 0, page: 1, page_size: 24, total_pages: 0, indexed_count: 0, missing_count: 0, model_id: "m" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await semanticSearch({ query: "猫", tags: [], template_id: null, page: 1, page_size: 24, vaultId: 2 });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/vaults/2/semantic-search");
  });

  it("routes uploadMeme to the vault endpoint when vaultId is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 201));
    vi.stubGlobal("fetch", fetchMock);

    await uploadMeme({
      file: new File(["x"], "a.png", { type: "image/png" }),
      title: "A",
      vaultId: 2,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/vaults/2/memes");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("routes ZIP import to the target vault via the vault_id form field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 202));
    vi.stubGlobal("fetch", fetchMock);

    await createImportJob({
      archive: new File(["zip"], "a.zip", { type: "application/zip" }),
      tags: [],
      template_id: null,
      source: "upload",
      chunk_size: 100,
      vaultId: 2,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/import-jobs");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("vault_id")).toBe("2");
  });

  it("omits vault_id from ZIP import for the default vault", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 202));
    vi.stubGlobal("fetch", fetchMock);

    await createImportJob({
      archive: new File(["zip"], "a.zip", { type: "application/zip" }),
      tags: [],
      template_id: null,
      source: "upload",
      chunk_size: 100,
    });

    const form = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(form.get("vault_id")).toBeNull();
  });

  it("includes vault_id in export job payloads for non-default vaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 202));
    vi.stubGlobal("fetch", fetchMock);

    await createExportJob({
      scope: "all",
      query: null,
      tags: [],
      template_id: null,
      organization: "flat",
      include_manifest: true,
      archive_name: "export",
      vaultId: 2,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ vault_id: 2, scope: "all" });
  });

  it("routes getRandomMeme to the vault endpoint when vaultId is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await getRandomMeme([], null, false, undefined, 2);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/vaults/2/memes/random");
  });
});
