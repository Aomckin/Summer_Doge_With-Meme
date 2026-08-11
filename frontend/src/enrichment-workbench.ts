import type {
  EnrichmentField, EnrichmentJobCreateInput, EnrichmentJobResponse,
  EnrichmentSuggestionResponse, MemeResponse, TemplateResponse,
} from "./types";

const JOB_KEY = "meme-vault-enrichment-job-id";

export interface EnrichmentWorkbenchApi {
  createJob(input: EnrichmentJobCreateInput): Promise<EnrichmentJobResponse>;
  estimateJob(input: EnrichmentJobCreateInput): Promise<{total_count: number; estimated_requests: number}>;
  getJob(id: number): Promise<EnrichmentJobResponse>;
  cancelJob(id: number): Promise<EnrichmentJobResponse>;
  retryFailed(id: number): Promise<EnrichmentJobResponse>;
  listSuggestions(status?: string, source?: string): Promise<{items: EnrichmentSuggestionResponse[]}>;
  applySuggestion(id: number, fields: EnrichmentField[], allowStale?: boolean): Promise<EnrichmentSuggestionResponse>;
  rejectSuggestion(id: number): Promise<EnrichmentSuggestionResponse>;
  reanalyzeSuggestion(id: number): Promise<EnrichmentSuggestionResponse>;
  getMeme(id: number): Promise<MemeResponse>;
  listTemplates(): Promise<TemplateResponse[]>;
}

export interface EnrichmentContext {
  query: string;
  tags: string[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char] ?? char);
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export class EnrichmentWorkbenchController {
  private readonly dialog: HTMLDialogElement;
  private context: EnrichmentContext = { query: "", tags: [] };
  private job: EnrichmentJobResponse | null = null;
  private suggestions: EnrichmentSuggestionResponse[] = [];
  private index = 0;
  private currentMeme: MemeResponse | null = null;
  private templates: TemplateResponse[] = [];
  private selected = new Set<EnrichmentField>();
  private error: string | null = null;
  private busy = false;
  private pollTimer: number | null = null;
  private generation = 0;
  private estimateGeneration = 0;
  private estimateCount: number | null = null;
  private estimateRequests: number | null = null;
  private composing = false;
  private jobDraft: EnrichmentJobCreateInput = {
    scope: "all", query: null, tags: [], start_meme_id: null, end_meme_id: null, analyze_title: true,
    analyze_description: true, analyze_tags: true, analyze_template: true,
    max_workers: 2,
  };

  constructor(
    trigger: HTMLButtonElement,
    private readonly api: EnrichmentWorkbenchApi,
    private readonly onApplied: (memeId: number) => Promise<void>,
    private readonly contextProvider: () => EnrichmentContext = () => this.context,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "settings-dialog enrichment-dialog";
    this.dialog.setAttribute("aria-label", "元数据整理");
    document.body.append(this.dialog);
    trigger.addEventListener("click", () => this.open(this.contextProvider()));
    this.dialog.addEventListener("click", event => this.handleClick(event));
    this.dialog.addEventListener("change", event => this.handleChange(event));
    this.dialog.addEventListener("submit", event => this.handleSubmit(event));
    this.dialog.addEventListener("close", () => this.stopPolling());
    this.dialog.addEventListener("compositionstart", () => { this.composing = true; });
    this.dialog.addEventListener("compositionend", () => { this.composing = false; });
    document.addEventListener("keydown", event => this.handleShortcut(event));
  }

  open(context: EnrichmentContext): void {
    this.context = context;
    this.error = null;
    this.render("review");
    if (!this.dialog.open) this.dialog.showModal();
    void this.loadSuggestions();
    void this.refreshEstimate();
    const saved = Number(localStorage.getItem(JOB_KEY));
    if (saved > 0) void this.resumeJob(saved);
  }

  async openSuggestion(suggestion: EnrichmentSuggestionResponse): Promise<void> {
    this.suggestions = [suggestion];
    this.index = 0;
    this.error = null;
    this.render("review");
    if (!this.dialog.open) this.dialog.showModal();
    await this.loadCurrent();
  }

  private render(tab: "jobs" | "review" = (this.dialog.dataset.tab as "jobs" | "review") || "review"): void {
    this.dialog.dataset.tab = tab;
    this.dialog.innerHTML = `
      <div class="settings-shell enrichment-shell">
        <header class="settings-header"><div><p class="eyebrow">AI + LUNA · SAFE REVIEW</p><h2>元数据整理</h2>
        <p>所有分析只生成建议，只有人工审核后才写入 Meme。</p></div>
        <button class="icon-button" type="button" data-close-enrichment aria-label="关闭">×</button></header>
        <nav class="enrichment-tabs"><button type="button" data-tab="jobs" class="button ${tab === "jobs" ? "button-primary" : "button-secondary"}">任务</button>
        <button type="button" data-tab="review" class="button ${tab === "review" ? "button-primary" : "button-secondary"}">建议审核</button></nav>
        ${this.error ? `<p class="form-error" role="alert">${escapeHtml(this.error)}</p>` : ""}
        ${tab === "jobs" ? this.jobMarkup() : this.reviewMarkup()}
      </div>`;
  }

  private jobMarkup(): string {
    const job = this.job;
    const draft = this.jobDraft;
    const scopes: Array<[EnrichmentJobCreateInput["scope"], string]> = [
      ["all","全部 Meme"],["filtered","当前筛选结果"],["missing_description","缺少描述"],
      ["missing_tags","缺少标签"],["missing_template","缺少模板"],["filename_title","标题疑似文件名"],
      ["never_analyzed","从未分析"],["stale_suggestions","已有建议已过期"],["id_range","Meme ID 范围"],
    ];
    return `<section class="enrichment-jobs">
      <form data-enrichment-job-form class="modal-card">
        <h3>批量 AI 整理</h3>
        <label>范围<select name="scope">${scopes.map(([value,label]) => `<option value="${value}" ${draft.scope === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <div class="enrichment-id-range" data-id-range-fields ${draft.scope === "id_range" ? "" : "hidden"}>
          <label>开始 ID<input type="number" name="start_meme_id" min="1" step="1" value="${draft.start_meme_id ?? ""}" ${draft.scope === "id_range" ? "required" : "disabled"}></label>
          <label>结束 ID<input type="number" name="end_meme_id" min="1" step="1" value="${draft.end_meme_id ?? ""}" ${draft.scope === "id_range" ? "required" : "disabled"}></label>
        </div>
        <fieldset><legend>分析内容</legend>${(["title","description","tags","template"] as const).map(value => `<div class="check-row"><input id="enrichment-analyze-${value}" type="checkbox" name="analyze_${value}" ${draft[`analyze_${value}`] ? "checked" : ""}><label for="enrichment-analyze-${value}">${({title:"标题",description:"描述",tags:"标签",template:"模板"})[value]}</label></div>`).join("")}</fieldset>
        <label>并发<select name="max_workers">${[1,2,4,8].map(value => `<option ${draft.max_workers === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <p class="notice">将调用当前 AI Provider 并产生 Token / API 费用。任务只生成建议，不自动修改 Meme。</p>
        <p><strong>预计处理 Meme：<span data-estimate-count>${this.estimateCount ?? "计算中…"}</span></strong><br>预计请求：<span data-estimate-requests>${this.estimateRequests ?? "计算中…"}</span></p>
        <button class="button button-primary" type="submit" ${this.busy ? "disabled" : ""}>开始任务</button>
      </form>
      <div class="modal-card enrichment-progress" data-enrichment-progress>${this.jobProgressMarkup(job)}</div>
    </section>`;
  }

  private jobProgressMarkup(job: EnrichmentJobResponse | null): string {
    return job ? `<h3>任务 #${job.id} · ${escapeHtml(job.status)}</h3>
        <progress max="${Math.max(job.total_count, 1)}" value="${job.processed_count}"></progress>
        <p>处理 ${job.processed_count} / ${job.total_count}</p><p>成功 ${job.success_count} · 跳过 ${job.skipped_count} · 失败 ${job.failed_count}</p>
        <p>Input ${job.input_tokens} · Output ${job.output_tokens} · Total ${job.total_tokens}</p>
        ${job.error_message ? `<p class="form-error">${escapeHtml(job.error_message)}</p>` : ""}
        <div class="modal-actions"><button type="button" class="button button-secondary" data-cancel-job ${!["pending","running","cancelling"].includes(job.status) ? "disabled" : ""}>取消</button>
        <button type="button" class="button button-secondary" data-retry-job ${job.failed_count ? "" : "disabled"}>重试失败项</button></div>` : "<p class=\"muted\">暂无任务。关闭窗口不会取消后台任务。</p>";
  }

  private reviewMarkup(): string {
    const item = this.suggestions[this.index];
    const meme = this.currentMeme?.id === item?.meme_id ? this.currentMeme : null;
    const filter = this.dialog.dataset.filter || "pending";
    const filterOptions = [["all","全部"],["pending","待审核"],["high","高改动量"],["removals","包含删除标签"],["title","包含标题修改"],["template","包含模板变更"],["stale","过期建议"],["provider","Provider 来源"],["luna","Luna 来源"]];
    if (!item) return `<section><div class="enrichment-review-toolbar"><label>筛选<select data-review-filter>${filterOptions.map(([v,l]) => `<option value="${v}" ${filter===v?"selected":""}>${l}</option>`).join("")}</select></label><button type="button" class="button button-secondary" data-refresh-suggestions>刷新</button></div><p class="muted">没有符合条件的建议。</p></section>`;
    const templateName = this.templates.find(value => value.id === item.suggested_template_id)?.name ?? (item.suggested_template_id ? `#${item.suggested_template_id}` : "无变更");
    const field = (name: EnrichmentField, label: string, current: string, proposed: string | null) => proposed === null ? "" : `<label class="enrichment-field"><input type="checkbox" data-field="${name}" ${this.selected.has(name) ? "checked" : ""}><span><strong>${label}</strong><small>当前：${escapeHtml(current)}</small><b>建议：${escapeHtml(proposed)}</b></span></label>`;
    const images = meme ? meme.images.map(image => `<img src="${escapeHtml(image.image_url)}" alt="${escapeHtml(meme.title)} 第 ${image.position + 1} 张">`).join("") : "<p>正在加载图片…</p>";
    return `<section>
      <div class="enrichment-review-toolbar"><label>筛选<select data-review-filter>${filterOptions.map(([v,l]) => `<option value="${v}" ${filter===v?"selected":""}>${l}</option>`).join("")}</select></label>
      <button type="button" class="button button-secondary" data-refresh-suggestions>刷新</button><button type="button" class="button button-secondary" data-batch-add-tags>批量采用新增标签</button>
      <span>${this.index + 1} / ${this.suggestions.length}</span></div>
      ${item.stale || item.status === "stale" ? '<p class="notice warning">该建议生成后 Meme 已被修改，请重新分析或人工确认后继续。</p>' : ""}
      <div class="enrichment-review-grid"><div class="enrichment-images">${images}</div><div class="enrichment-fields">
        <p><strong>来源：</strong>${item.source === "provider" ? "Provider" : item.source === "luna" ? "Luna" : "手动导入"} · ${escapeHtml(item.model_id_snapshot || "本地")}</p>
        ${field("title","标题",meme?.title || "",item.suggested_title)}
        ${field("description","描述",meme?.description || "（空）",item.suggested_description)}
        ${field("add_tags","新增标签",meme?.tags.map(tag => tag.name).join("、") || "（无）",item.add_tags.length ? item.add_tags.map(tag => `+ ${tag}`).join("、") : null)}
        ${field("remove_tags","移除标签",meme?.tags.map(tag => tag.name).join("、") || "（无）",item.remove_tags.length ? item.remove_tags.map(tag => `- ${tag}`).join("、") : null)}
        ${field("template","模板",meme?.template?.name || "未归类",item.suggested_template_id !== null ? templateName : null)}
        ${item.reason ? `<p class="enrichment-reason">${escapeHtml(item.reason)}</p>` : ""}
      </div></div>
      <div class="modal-actions"><button type="button" class="button button-secondary" data-previous>上一条 K / ←</button><button type="button" class="button button-primary" data-apply-all>全部采用 A</button><button type="button" class="button button-primary" data-apply-selected>保存所选 S</button><button type="button" class="button button-secondary" data-reject>拒绝 R</button><button type="button" class="button button-secondary" data-reanalyze>重新分析</button><button type="button" class="button button-secondary" data-next>下一条 J / →</button></div>
    </section>`;
  }

  private async loadSuggestions(): Promise<void> {
    const generation = ++this.generation;
    try {
      const page = await this.api.listSuggestions();
      if (generation !== this.generation) return;
      this.suggestions = this.filter(page.items, this.dialog.dataset.filter || "pending");
      this.index = Math.min(this.index, Math.max(0, this.suggestions.length - 1));
      await this.loadCurrent(generation);
    } catch (error) { if (generation === this.generation) { this.error = readable(error); this.render("review"); } }
  }

  private filter(items: EnrichmentSuggestionResponse[], filter: string): EnrichmentSuggestionResponse[] {
    return items.filter(item => filter === "all" ||
      (filter === "pending" && ["pending","partially_accepted"].includes(item.status)) ||
      (filter === "high" && [item.suggested_title,item.suggested_description,item.suggested_template_id,...item.add_tags,...item.remove_tags].filter(Boolean).length >= 3) ||
      (filter === "removals" && item.remove_tags.length > 0) || (filter === "title" && item.suggested_title !== null) ||
      (filter === "template" && item.suggested_template_id !== null) || (filter === "stale" && (item.stale || item.status === "stale")) ||
      filter === item.source);
  }

  private async loadCurrent(generation = this.generation): Promise<void> {
    const item = this.suggestions[this.index];
    this.selected.clear();
    if (!item) { this.currentMeme = null; if (this.dialog.dataset.tab === "review") this.render("review"); return; }
    for (const [field, available] of [["title",item.suggested_title !== null],["description",item.suggested_description !== null],["add_tags",item.add_tags.length > 0],["remove_tags",item.remove_tags.length > 0],["template",item.suggested_template_id !== null]] as const) if (available) this.selected.add(field);
    if (this.dialog.dataset.tab === "review") this.render("review");
    try {
      const [meme, templates] = await Promise.all([this.api.getMeme(item.meme_id), this.templates.length ? Promise.resolve(this.templates) : this.api.listTemplates()]);
      if (generation !== this.generation || this.suggestions[this.index]?.id !== item.id) return;
      this.currentMeme = meme; this.templates = templates; if (this.dialog.dataset.tab === "review") this.render("review");
    } catch (error) { if (generation === this.generation) { this.error = readable(error); if (this.dialog.dataset.tab === "review") this.render("review"); } }
  }

  private async startJob(form: HTMLFormElement): Promise<void> {
    const input = this.jobInput(form); this.busy = true; this.error = null; this.render("jobs");
    try {
      this.job = await this.api.createJob(input);
      localStorage.setItem(JOB_KEY, String(this.job.id)); this.startPolling();
    } catch (error) { this.error = readable(error); } finally { this.busy = false; this.render("jobs"); }
  }

  private jobInput(form?: HTMLFormElement): EnrichmentJobCreateInput {
    const data = form ? new FormData(form) : null;
    const workers = Number(data?.get("max_workers") ?? 2);
    const scope = (data?.get("scope") || "all") as EnrichmentJobCreateInput["scope"];
    const parseId = (value: FormDataEntryValue | null): number | null => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };
    const input: EnrichmentJobCreateInput = {
      scope,
      query: this.context.query || null, tags: this.context.tags,
      start_meme_id: scope === "id_range" ? parseId(data?.get("start_meme_id") ?? null) : null,
      end_meme_id: scope === "id_range" ? parseId(data?.get("end_meme_id") ?? null) : null,
      analyze_title: data ? data.has("analyze_title") : true,
      analyze_description: data ? data.has("analyze_description") : true,
      analyze_tags: data ? data.has("analyze_tags") : true,
      analyze_template: data ? data.has("analyze_template") : true,
      max_workers: (workers === 1 || workers === 4 || workers === 8 ? workers : 2),
    };
    if (form) this.jobDraft = input;
    else this.jobDraft = { ...this.jobDraft, query: this.context.query || null, tags: this.context.tags };
    return form ? input : this.jobDraft;
  }

  private async refreshEstimate(form?: HTMLFormElement): Promise<void> {
    const generation = this.generation;
    const estimateGeneration = ++this.estimateGeneration;
    const input = this.jobInput(form);
    if (input.scope === "id_range" && (input.start_meme_id === null || input.end_meme_id === null)) {
      this.estimateCount = null;
      this.estimateRequests = null;
      this.updateEstimateDisplay();
      return;
    }
    try {
      const result = await this.api.estimateJob(input);
      if (generation !== this.generation || estimateGeneration !== this.estimateGeneration) return;
      this.estimateCount = result.total_count;
      this.estimateRequests = result.estimated_requests;
      this.updateEstimateDisplay();
    } catch (error) {
      if (generation === this.generation && estimateGeneration === this.estimateGeneration) this.error = readable(error);
    }
  }

  private updateEstimateDisplay(): void {
    const count = this.dialog.querySelector<HTMLElement>("[data-estimate-count]");
    const requests = this.dialog.querySelector<HTMLElement>("[data-estimate-requests]");
    if (count) count.textContent = String(this.estimateCount ?? "计算中…");
    if (requests) requests.textContent = String(this.estimateRequests ?? "计算中…");
  }

  private updateJobProgress(): void {
    const progress = this.dialog.querySelector<HTMLElement>("[data-enrichment-progress]");
    if (progress) progress.innerHTML = this.jobProgressMarkup(this.job);
  }

  private async resumeJob(id: number): Promise<void> {
    try { this.job = await this.api.getJob(id); if (this.dialog.dataset.tab === "jobs") this.updateJobProgress(); if (["pending","running","cancelling"].includes(this.job.status)) this.startPolling(); }
    catch { localStorage.removeItem(JOB_KEY); }
  }
  private startPolling(): void { this.stopPolling(); this.pollTimer = window.setInterval(() => { if (this.job) void this.resumeJob(this.job.id); }, 1200); }
  private stopPolling(): void { if (this.pollTimer !== null) window.clearInterval(this.pollTimer); this.pollTimer = null; }

  private async apply(fields: EnrichmentField[]): Promise<void> {
    const item = this.suggestions[this.index]; if (!item || !fields.length || this.busy) return;
    if ((item.stale || item.status === "stale") && !confirm("该建议已经过期。确定基于当前 Meme 人工继续采用所选字段吗？")) return;
    this.busy = true;
    try { await this.api.applySuggestion(item.id, fields, item.stale || item.status === "stale"); await this.onApplied(item.meme_id); this.suggestions.splice(this.index, 1); this.index = Math.min(this.index, Math.max(0, this.suggestions.length - 1)); await this.loadCurrent(); }
    catch (error) { this.error = readable(error); this.render("review"); } finally { this.busy = false; }
  }

  private allAvailableFields(): EnrichmentField[] {
    const item = this.suggestions[this.index];
    if (!item) return [];
    const fields: EnrichmentField[] = [];
    if (item.suggested_title !== null) fields.push("title");
    if (item.suggested_description !== null) fields.push("description");
    if (item.add_tags.length) fields.push("add_tags");
    if (item.remove_tags.length) fields.push("remove_tags");
    if (item.suggested_template_id !== null) fields.push("template");
    return fields;
  }

  private async mutate(action: "reject"|"reanalyze"): Promise<void> {
    const item = this.suggestions[this.index]; if (!item || this.busy) return; this.busy = true;
    try { const next = action === "reject" ? await this.api.rejectSuggestion(item.id) : await this.api.reanalyzeSuggestion(item.id); if (action === "reject") this.suggestions.splice(this.index, 1); else this.suggestions[this.index] = next; await this.loadCurrent(); }
    catch (error) { this.error = readable(error); this.render("review"); } finally { this.busy = false; }
  }

  private async batchAddTags(): Promise<void> {
    const safe = this.suggestions.filter(item => item.add_tags.length && !item.stale && ["pending","partially_accepted"].includes(item.status));
    if (!safe.length || !confirm(`确定为 ${safe.length} 条建议批量采用“新增标签”吗？不会覆盖标题、描述、模板或删除标签。`)) return;
    this.busy = true; let failures = 0;
    for (const item of safe) { try { await this.api.applySuggestion(item.id, ["add_tags"]); await this.onApplied(item.meme_id); } catch { failures += 1; } }
    this.busy = false; this.error = failures ? `${failures} 条建议应用失败，请逐条检查。` : null; await this.loadSuggestions();
  }

  private handleClick(event: Event): void {
    const target = event.target as Element;
    if (target.closest("[data-close-enrichment]")) this.dialog.close();
    const tab = target.closest<HTMLButtonElement>("button[data-tab]")?.dataset.tab as "jobs"|"review"|undefined;
    if (tab) { this.render(tab); if (tab === "review") void this.loadSuggestions(); }
    if (target.closest("[data-refresh-suggestions]")) void this.loadSuggestions();
    if (target.closest("[data-previous]")) this.move(-1); if (target.closest("[data-next]")) this.move(1);
    if (target.closest("[data-apply-all]")) void this.apply(this.allAvailableFields());
    if (target.closest("[data-apply-selected]")) void this.apply([...this.selected]);
    if (target.closest("[data-reject]")) void this.mutate("reject"); if (target.closest("[data-reanalyze]")) void this.mutate("reanalyze");
    if (target.closest("[data-batch-add-tags]")) void this.batchAddTags();
    if (target.closest("[data-cancel-job]") && this.job) void this.api.cancelJob(this.job.id).then(job => { this.job = job; this.render("jobs"); }).catch(error => { this.error = readable(error); this.render("jobs"); });
    if (target.closest("[data-retry-job]") && this.job) void this.api.retryFailed(this.job.id).then(job => { this.job = job; this.startPolling(); this.render("jobs"); }).catch(error => { this.error = readable(error); this.render("jobs"); });
  }
  private handleChange(event: Event): void { const target = event.target; if (target instanceof HTMLInputElement && target.dataset.field) { const field = target.dataset.field as EnrichmentField; target.checked ? this.selected.add(field) : this.selected.delete(field); } if (target instanceof HTMLSelectElement && target.matches("[data-review-filter]")) { this.dialog.dataset.filter = target.value; void this.loadSuggestions(); } const form = target instanceof Element ? target.closest<HTMLFormElement>("[data-enrichment-job-form]") : null; if (form) { if (target instanceof HTMLSelectElement && target.name === "scope") this.toggleIdRangeFields(form, target.value === "id_range"); void this.refreshEstimate(form); } }
  private toggleIdRangeFields(form: HTMLFormElement, visible: boolean): void { const fields = form.querySelector<HTMLElement>("[data-id-range-fields]"); if (!fields) return; fields.hidden = !visible; for (const input of fields.querySelectorAll<HTMLInputElement>("input")) { input.disabled = !visible; input.required = visible; } }
  private handleSubmit(event: Event): void { const form = event.target; if (form instanceof HTMLFormElement && form.matches("[data-enrichment-job-form]")) { event.preventDefault(); void this.startJob(form); } }
  private move(delta: number): void { if (!this.suggestions.length) return; this.index = Math.max(0, Math.min(this.suggestions.length - 1, this.index + delta)); void this.loadCurrent(); }
  private handleShortcut(event: KeyboardEvent): void { if (!this.dialog.open || this.composing || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return; const target = event.target; if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return; const key = event.key.toLowerCase(); if (key === "a") { event.preventDefault(); void this.apply(this.allAvailableFields()); } else if (key === "s") { event.preventDefault(); void this.apply([...this.selected]); } else if (key === "r") { event.preventDefault(); void this.mutate("reject"); } else if (key === "j" || event.key === "ArrowRight") { event.preventDefault(); this.move(1); } else if (key === "k" || event.key === "ArrowLeft") { event.preventDefault(); this.move(-1); } }
}
