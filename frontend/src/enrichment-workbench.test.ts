import { describe, expect, it, vi } from "vitest";
import { EnrichmentWorkbenchController } from "./enrichment-workbench";
import type { EnrichmentJobResponse, EnrichmentSuggestionResponse, MemeResponse } from "./types";

const suggestion: EnrichmentSuggestionResponse = {
  id: 9, meme_id: 1, source: "provider", provider_id: 1, model_record_id: 2,
  model_id_snapshot: "vision", job_id: null, suggested_title: "新标题",
  suggested_description: null, suggested_template_id: null,
  add_tags: ["无语"], remove_tags: [], confidence: {}, reason: "测试",
  status: "pending", source_hash: "a".repeat(64), stale: false,
  applied_fields: [], created_at: new Date().toISOString(), reviewed_at: null, applied_at: null,
};

const meme: MemeResponse = {
  id: 1, title: "旧标题", description: null, source: null,
  original_filename: "one.png", stored_filename: "one.png",
  image_url: "/media/one.png", thumbnail_url: "/thumbs/one.png",
  mime_type: "image/png", file_size: 10, width: 8, height: 8,
  file_hash: "b".repeat(64), created_at: "2026-01-01", updated_at: "2026-01-01",
  tags: [], template: null, image_count: 1,
  images: [{ id: 1, original_filename: "one.png", stored_filename: "one.png",
    image_url: "/media/one.png", thumbnail_url: "/thumbs/one.png",
    mime_type: "image/png", file_size: 10, width: 8, height: 8,
    file_hash: "b".repeat(64), position: 0, created_at: "2026-01-01" }],
};

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const runningJob: EnrichmentJobResponse = {
  id: 7, status: "running", scope: "all", provider_id: 1, model_record_id: 2,
  start_meme_id: null, end_meme_id: null,
  model_id_snapshot: "vision", analyze_title: true, analyze_description: true,
  analyze_tags: true, analyze_template: true, total_count: 10, processed_count: 2,
  success_count: 2, skipped_count: 0, failed_count: 0, input_tokens: 20,
  output_tokens: 10, total_tokens: 30, max_workers: 2, error_message: null,
  created_at: "2026-01-01", started_at: "2026-01-01", completed_at: null,
};

describe("EnrichmentWorkbenchController", () => {
  it("reviews selected fields and ignores shortcuts during IME composition", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const applySuggestion = vi.fn().mockResolvedValue({ ...suggestion, status: "applied" });
    const rejectSuggestion = vi.fn().mockResolvedValue({ ...suggestion, status: "rejected" });
    const controller = new EnrichmentWorkbenchController(trigger, {
      createJob: vi.fn(), estimateJob: vi.fn().mockResolvedValue({ total_count: 1, estimated_requests: 1 }), getJob: vi.fn(), cancelJob: vi.fn(), retryFailed: vi.fn(),
      listSuggestions: vi.fn().mockResolvedValue({ items: [suggestion] }),
      applySuggestion, rejectSuggestion, reanalyzeSuggestion: vi.fn(),
      getMeme: vi.fn().mockResolvedValue(meme), listTemplates: vi.fn().mockResolvedValue([]),
    }, vi.fn().mockResolvedValue(undefined));

    await controller.openSuggestion(suggestion);
    const dialogs = document.querySelectorAll<HTMLDialogElement>(".enrichment-dialog");
    const dialog = dialogs[dialogs.length - 1]!;
    expect(dialog.textContent).toContain("新标题");
    expect(dialog.querySelector<HTMLImageElement>(".enrichment-images img")?.getAttribute("src"))
      .toBe("/media/one.png");
    const title = dialog.querySelector<HTMLInputElement>('[data-field="title"]')!;
    title.checked = false;
    title.dispatchEvent(new Event("change", { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>("[data-apply-selected]")!.click();
    await tick();
    expect(applySuggestion).toHaveBeenCalledWith(9, ["add_tags"], false);

    await controller.openSuggestion(suggestion);
    dialog.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    expect(rejectSuggestion).not.toHaveBeenCalled();
    dialog.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    await tick();
    expect(rejectSuggestion).toHaveBeenCalledWith(9);
  });

  it("keeps job controls mounted while estimates and polling refresh", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const firstEstimate = deferred<{ total_count: number; estimated_requests: number }>();
    const changedEstimate = deferred<{ total_count: number; estimated_requests: number }>();
    const resumedJob = deferred<EnrichmentJobResponse>();
    const estimateJob = vi.fn()
      .mockReturnValueOnce(firstEstimate.promise)
      .mockReturnValueOnce(changedEstimate.promise);
    localStorage.setItem("meme-vault-enrichment-job-id", "7");
    const controller = new EnrichmentWorkbenchController(trigger, {
      createJob: vi.fn(), estimateJob, getJob: vi.fn().mockReturnValue(resumedJob.promise),
      cancelJob: vi.fn(), retryFailed: vi.fn(), listSuggestions: vi.fn().mockResolvedValue({ items: [] }),
      applySuggestion: vi.fn(), rejectSuggestion: vi.fn(), reanalyzeSuggestion: vi.fn(),
      getMeme: vi.fn(), listTemplates: vi.fn(),
    }, vi.fn().mockResolvedValue(undefined));

    controller.open({ query: "", tags: [] });
    const dialogs = document.querySelectorAll<HTMLDialogElement>(".enrichment-dialog");
    const dialog = dialogs[dialogs.length - 1]!;
    dialog.querySelector<HTMLButtonElement>('[data-tab="jobs"]')!.click();
    const scope = dialog.querySelector<HTMLSelectElement>('select[name="scope"]')!;
    const title = dialog.querySelector<HTMLInputElement>('input[name="analyze_title"]')!;
    scope.value = "missing_tags";
    title.click();
    expect(title.checked).toBe(false);
    expect(dialog.querySelector('select[name="scope"]')).toBe(scope);

    firstEstimate.resolve({ total_count: 99, estimated_requests: 99 });
    await tick();
    expect(dialog.querySelector('select[name="scope"]')).toBe(scope);
    resumedJob.resolve(runningJob);
    await tick();
    expect(dialog.querySelector('select[name="scope"]')).toBe(scope);
    expect(dialog.querySelector('input[name="analyze_title"]')).toBe(title);
    expect(scope.value).toBe("missing_tags");
    expect(title.checked).toBe(false);

    changedEstimate.resolve({ total_count: 12, estimated_requests: 8 });
    await tick();
    expect(dialog.querySelector('select[name="scope"]')).toBe(scope);
    expect(dialog.querySelector('[data-estimate-count]')?.textContent).toBe("12");
    expect(dialog.querySelector('[data-estimate-requests]')?.textContent).toBe("8");
    expect(dialog.querySelector('[data-enrichment-progress]')?.textContent).toContain("任务 #7");
    dialog.close();
    localStorage.removeItem("meme-vault-enrichment-job-id");
  });

  it("shows an inclusive Meme ID range and sends it to estimation", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const estimateJob = vi.fn().mockResolvedValue({ total_count: 21, estimated_requests: 21 });
    const controller = new EnrichmentWorkbenchController(trigger, {
      createJob: vi.fn(), estimateJob, getJob: vi.fn(), cancelJob: vi.fn(), retryFailed: vi.fn(),
      listSuggestions: vi.fn().mockResolvedValue({ items: [] }), applySuggestion: vi.fn(),
      rejectSuggestion: vi.fn(), reanalyzeSuggestion: vi.fn(), getMeme: vi.fn(), listTemplates: vi.fn(),
    }, vi.fn().mockResolvedValue(undefined));

    controller.open({ query: "", tags: [] });
    const dialogs = document.querySelectorAll<HTMLDialogElement>(".enrichment-dialog");
    const dialog = dialogs[dialogs.length - 1]!;
    dialog.querySelector<HTMLButtonElement>('[data-tab="jobs"]')!.click();
    const scope = dialog.querySelector<HTMLSelectElement>('select[name="scope"]')!;
    scope.value = "id_range";
    scope.dispatchEvent(new Event("change", { bubbles: true }));
    const start = dialog.querySelector<HTMLInputElement>('input[name="start_meme_id"]')!;
    const end = dialog.querySelector<HTMLInputElement>('input[name="end_meme_id"]')!;
    expect(start.disabled).toBe(false);
    expect(end.disabled).toBe(false);
    start.value = "100";
    end.value = "120";
    end.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    expect(estimateJob).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: "id_range", start_meme_id: 100, end_meme_id: 120,
    }));
    dialog.close();
  });
});
