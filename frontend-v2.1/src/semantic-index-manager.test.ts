import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticIndexManager, type SemanticIndexManagerApi } from "./semantic-index-manager";
import type { EmbeddingJobResponse, SemanticIndexStatus } from "./types";

const status: SemanticIndexStatus = {
  total_memes: 12, ready_count: 5, missing_count: 4, stale_count: 2,
  failed_count: 1, incompatible_count: 0, active_model_id: "qwen3-vl-embedding",
  dimension: 1024, running_job: null,
};

function job(overrides: Partial<EmbeddingJobResponse> = {}): EmbeddingJobResponse {
  return {
    id: 7, status: "running", scope: "missing_or_stale", model_record_id: 2,
    model_id_snapshot: "qwen3-vl-embedding", dimension: 1024, max_workers: 4,
    total_count: 6, processed_count: 2, success_count: 1, skipped_count: 0,
    failed_count: 1, text_tokens: 12, image_tokens: 34, total_tokens: 46,
    error_message: null, created_at: "2026-01-01", started_at: "2026-01-01", completed_at: null,
    ...overrides,
  };
}

function api(overrides: Partial<SemanticIndexManagerApi> = {}): SemanticIndexManagerApi {
  return {
    getStatus: vi.fn().mockResolvedValue(status),
    createJob: vi.fn().mockResolvedValue(job()),
    getJob: vi.fn().mockResolvedValue(job()),
    listItems: vi.fn().mockResolvedValue({
      items: [{ id: 1, job_id: 7, meme_id: 9, source_hash: "x", status: "failed", attempt_count: 1,
        text_tokens: 0, image_tokens: 0, total_tokens: 0, error_message: "upstream failed",
        created_at: "2026-01-01", started_at: null, completed_at: null }],
      total: 1, offset: 0, limit: 50,
    }),
    cancelJob: vi.fn().mockResolvedValue(job({ status: "completed_with_errors" })),
    retryFailed: vi.fn().mockResolvedValue(job({ status: "pending" })),
    deleteJob: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("SemanticIndexManager", () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="open">语义索引</button>';
    vi.stubGlobal("confirm", vi.fn(() => true));
  });
  afterEach(() => vi.useRealTimers());

  it("loads statistics and creates missing-or-stale work with selected concurrency", async () => {
    const mock = api();
    new SemanticIndexManager(document.querySelector("#open")!, mock);
    document.querySelector<HTMLButtonElement>("#open")!.click();
    await vi.waitFor(() => expect(mock.getStatus).toHaveBeenCalled());
    expect(document.body.textContent).toContain("qwen3-vl-embedding");
    expect(document.body.textContent).toContain("待处理 6 个 Meme");
    const workers = document.querySelector<HTMLSelectElement>("[data-index-workers]")!;
    workers.value = "2";
    document.querySelector<HTMLButtonElement>('[data-create-scope="missing_or_stale"]')!.click();
    await vi.waitFor(() => expect(mock.createJob).toHaveBeenCalledWith("missing_or_stale", 2));
    expect(document.body.textContent).toContain("文本 Token 12");
    expect(document.body.textContent).toContain("图片 Token 34");
  });

  it("confirms all work, cancels, retries and displays paged failures", async () => {
    const mock = api();
    new SemanticIndexManager(document.querySelector("#open")!, mock);
    document.querySelector<HTMLButtonElement>("#open")!.click();
    await vi.waitFor(() => expect(mock.getStatus).toHaveBeenCalled());
    document.querySelector<HTMLButtonElement>('[data-create-scope="all"]')!.click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(mock.createJob).toHaveBeenCalledWith("all", 4);
    document.querySelector<HTMLButtonElement>("[data-cancel-index-job]")!.click();
    await vi.waitFor(() => expect(mock.cancelJob).toHaveBeenCalledWith(7));
    document.querySelector<HTMLButtonElement>("[data-show-index-failures]")!.click();
    await vi.waitFor(() => expect(mock.listItems).toHaveBeenCalledWith(7, 0, 50, "failed"));
    expect(document.body.textContent).toContain("upstream failed");
    document.querySelector<HTMLButtonElement>("[data-retry-index-job]")!.click();
    await vi.waitFor(() => expect(mock.retryFailed).toHaveBeenCalledWith(7));
  });

  it("recovers the current running job when reopened", async () => {
    const mock = api({ getStatus: vi.fn().mockResolvedValue({ ...status, running_job: { id: 7, status: "running", processed_count: 2, total_count: 6 } }) });
    new SemanticIndexManager(document.querySelector("#open")!, mock);
    document.querySelector<HTMLButtonElement>("#open")!.click();
    await vi.waitFor(() => expect(mock.getJob).toHaveBeenCalledWith(7));
    expect(document.body.textContent).toContain("任务 #7");
  });
});
