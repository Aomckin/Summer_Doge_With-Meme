import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchDownloadController } from "./batch-download";
import type { ExportJobResponse } from "./types";

function job(status: ExportJobResponse["status"]): ExportJobResponse {
  return {
    id: 12, status, scope: "filtered", query: "震惊", tags: ["doge", "reaction"],
    template_id: null, organization: "tag", include_manifest: true,
    archive_name: "震惊反应图", total_memes: 80, total_images: 120,
    processed_memes: status === "ready" ? 80 : 10,
    processed_images: status === "ready" ? 120 : 15,
    success_count: status === "ready" ? 120 : 15, skipped_count: 0, failed_count: 0,
    estimated_bytes: 1024 * 1024, archive_size: status === "ready" ? 900000 : null,
    current_meme_id: status === "ready" ? null : 10,
    current_filename: status === "ready" ? null : "tags/doge/a.png",
    error_message: null, created_at: "2026-08-06T00:00:00Z",
    started_at: "2026-08-06T00:00:01Z",
    completed_at: status === "ready" ? "2026-08-06T00:01:00Z" : null,
    expires_at: status === "ready" ? "2026-08-07T00:01:00Z" : null,
  };
}

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ""; });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; localStorage.clear(); });

describe("BatchDownloadController", () => {
  it("submits server-side filters without current Meme ids and warns for tag organization", async () => {
    const createExportJob = vi.fn().mockResolvedValue(job("running"));
    const controller = new BatchDownloadController({
      createExportJob, getExportJob: vi.fn().mockResolvedValue(job("running")),
      listExportJobItems: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 25 }),
      cancelExportJob: vi.fn(), deleteExportJob: vi.fn(),
    });
    controller.open({ query: "震惊", tags: ["doge", "reaction"], templateId: null });
    const filtered = document.querySelector<HTMLInputElement>('[name="scope"][value="filtered"]')!;
    filtered.checked = true; filtered.dispatchEvent(new Event("change", { bubbles: true }));
    const tag = document.querySelector<HTMLInputElement>('[name="organization"][value="tag"]')!;
    tag.checked = true; tag.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector<HTMLElement>("[data-tag-warning]")?.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>("[data-start-export]")!.click();
    await vi.waitFor(() => expect(createExportJob).toHaveBeenCalledOnce());
    expect(createExportJob.mock.calls[0][0]).toMatchObject({
      scope: "filtered", query: "震惊", tags: ["doge", "reaction"], organization: "tag",
    });
    expect(createExportJob.mock.calls[0][0]).not.toHaveProperty("meme_ids");
  });

  it("stops polling when closed and resumes to a direct ZIP link", async () => {
    vi.useFakeTimers();
    const getExportJob = vi.fn().mockResolvedValue(job("ready"));
    const api = {
      createExportJob: vi.fn().mockResolvedValue(job("running")), getExportJob,
      listExportJobItems: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 25 }),
      cancelExportJob: vi.fn(), deleteExportJob: vi.fn(),
    };
    const controller = new BatchDownloadController(api);
    controller.open({ query: "", tags: [], templateId: null });
    document.querySelector<HTMLButtonElement>("[data-start-export]")!.click();
    await Promise.resolve(); await Promise.resolve();
    document.querySelector<HTMLButtonElement>("[data-close-export]")!.click();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getExportJob).not.toHaveBeenCalled();
    expect(api.cancelExportJob).not.toHaveBeenCalled();

    controller.open({ query: "", tags: [], templateId: null });
    await vi.advanceTimersByTimeAsync(1);
    expect(getExportJob).toHaveBeenCalledWith(12);
    const link = document.querySelector<HTMLAnchorElement>("[data-download-export]");
    expect(link?.hidden).toBe(false);
    expect(link?.getAttribute("href")).toBe("/api/export-jobs/12/download");
  });
});
