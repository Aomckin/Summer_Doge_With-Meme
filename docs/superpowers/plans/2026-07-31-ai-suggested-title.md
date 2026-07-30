# AI Suggested Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Meme AI analysis to generate, preview, persist, and optionally apply one suggested Chinese title.

**Architecture:** Add `title` to the structured AI result, validate it at the AI client boundary, and persist it as a nullable analysis snapshot field for backward compatibility. Expose the snapshot through the existing analysis response and apply it only when the existing confirmation request explicitly sends `apply_title: true`; the frontend keeps this choice unchecked by default.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, SQLite additive migrations, pytest, native TypeScript, Vitest, jsdom.

## Global Constraints

- One analysis produces exactly one suggested Simplified Chinese title with no automatic application.
- Suggested titles are non-empty after trimming and at most 255 characters.
- Existing analysis rows remain valid with `suggested_title = NULL`; no historical backfill is performed.
- The existing analyze and confirm endpoints are reused; no new endpoint is added.
- The AI panel previews but does not edit the suggested title.
- Confirmation defaults to `apply_title = false`.
- Confirmation must not trigger an extra Meme list request.
- Preserve the current dirty working-tree changes from the waterfall-edit fix.
- Do not commit, push, or create a pull request.

## File Structure

- `app/ai/client.py`: AI output contract, prompt, strict schema, parsing and boundary validation.
- `app/models/ai_analysis.py`: nullable persisted suggested-title snapshot.
- `app/repositories/ai_analysis_repository.py`: accepts the normalized title when creating a snapshot.
- `app/schemas/ai_analysis.py`: response and confirmation request fields.
- `app/services/meme_service.py`: normalizes/persists the title and conditionally applies it during confirmation.
- `app/api/memes.py`: maps the snapshot to API responses and forwards `apply_title`.
- `app/database.py`: additive SQLite column migration.
- `frontend/src/types.ts`: frontend response, request and state contracts.
- `frontend/src/api.ts`: serializes the explicit title choice in confirmation requests.
- `frontend/src/app.ts`: title-choice state, event handling, confirmation payload and reset behavior.
- `frontend/src/ui.ts`: suggested-title preview and opt-in checkbox.
- `tests/test_ai_client.py`: strict output and invalid-title regression coverage.
- `tests/test_ai_analysis.py`: service-level snapshot and confirmation behavior.
- `tests/test_meme_api.py`: public API response/default/explicit confirmation behavior.
- `tests/test_template_migrations.py`: old SQLite schema upgrade coverage.
- `tests/test_templates.py`: fixture compatibility for `AIImageResult`.
- `frontend/src/api.test.ts`: serialized confirmation payload contract.
- `frontend/src/app.test.ts`: title preview, opt-in, legacy snapshot and failure-state behavior.

---

### Task 1: Add and validate the AI title output

**Files:**
- Modify: `app/ai/client.py:54-130`
- Modify: `app/ai/client.py:213-250`
- Modify: `app/ai/client.py:443`
- Test: `tests/test_ai_client.py`
- Test fixture updates: `tests/test_ai_analysis.py`
- Test fixture updates: `tests/test_meme_api.py`
- Test fixture updates: `tests/test_templates.py`

**Interfaces:**
- Produces: `AIImageResult.title: str`
- Produces: structured output `{title, description, tags, template_id}`
- Consumes: existing `AIInvalidResponseError` for malformed AI responses

- [ ] **Step 1: Add failing parser and schema assertions**

Update valid fake response JSON in `tests/test_ai_client.py` to include:

```python
"title": "看到需求时的我",
```

Then assert:

```python
assert result.title == "看到需求时的我"
assert ANALYSIS_SCHEMA["required"] == [
    "title",
    "description",
    "tags",
    "template_id",
]
assert ANALYSIS_SCHEMA["properties"]["title"] == {
    "type": "string",
    "minLength": 1,
    "maxLength": 255,
}
```

Add parameterized invalid-response cases that replace `title` with `""`, `"   "`, and `"题" * 256`, each expecting `AIInvalidResponseError`.

- [ ] **Step 2: Run the focused client tests and verify failure**

Run:

```powershell
python -m pytest tests/test_ai_client.py -q
```

Expected: failures because `AIImageResult` has no `title`, the schema does not require it, and invalid titles are accepted.

- [ ] **Step 3: Extend the AI contract and prompts**

Change the dataclass contract to:

```python
@dataclass(frozen=True)
class AIImageResult:
    model_name: str
    title: str
    description: str
    tags: tuple[AITagSuggestion, ...]
    template_id: int | None = None
```

Add a sentence to `SYSTEM_PROMPT` requiring one concise Simplified Chinese Meme title that summarizes the image subject or joke and excludes a `标题：` prefix, filename, and wrapping quotation marks.

Add this schema property before `description`:

```python
"title": {
    "type": "string",
    "minLength": 1,
    "maxLength": 255,
},
```

Set `required` to:

```python
["title", "description", "tags", "template_id"]
```

Update the Chat Completions JSON example to contain `"title": "..."`.

- [ ] **Step 4: Parse and validate the title at the client boundary**

In `_parse_result`, validate type before calling string methods:

```python
raw_title = result["title"]
if not isinstance(raw_title, str):
    raise ValueError
title = raw_title.strip()
if not title or len(title) > 255:
    raise ValueError
```

Return:

```python
return AIImageResult(
    model_name=model_name,
    title=title,
    description=description,
    tags=tags,
    template_id=template_id,
)
```

- [ ] **Step 5: Update all test doubles to satisfy the new required contract**

For every `AIImageResult(...)` in `tests/test_ai_analysis.py`, `tests/test_meme_api.py`, `tests/test_templates.py`, and `tests/test_ai_client.py`, add a meaningful `title`, for example:

```python
title="看到需求时的我",
```

Do not add a default value to `AIImageResult.title`; every newly generated result must explicitly provide it.

- [ ] **Step 6: Run AI client tests and fixture-dependent tests**

Run:

```powershell
python -m pytest tests/test_ai_client.py tests/test_ai_analysis.py tests/test_meme_api.py tests/test_templates.py -q
```

Expected: client parsing/schema tests pass; existing service/API tests remain green with the updated fixture contract.

### Task 2: Persist and optionally apply the suggested title

**Files:**
- Modify: `app/models/ai_analysis.py:25-29`
- Modify: `app/repositories/ai_analysis_repository.py:15-34`
- Modify: `app/schemas/ai_analysis.py:14-29`
- Modify: `app/services/meme_service.py:325-435`
- Modify: `app/api/memes.py:160-182`
- Modify: `app/api/memes.py:355-379`
- Modify: `app/database.py:58-82`
- Test: `tests/test_ai_analysis.py`
- Test: `tests/test_meme_api.py`
- Test: `tests/test_template_migrations.py`

**Interfaces:**
- Consumes: `AIImageResult.title: str` from Task 1
- Produces: `MemeAIAnalysis.suggested_title: str | None`
- Produces: `AIAnalysisResponse.suggested_title: str | None`
- Produces: `AIAnalysisConfirm.apply_title: bool = False`
- Changes: `MemeService.confirm_ai_analysis(..., apply_title: bool = False) -> Meme`

- [ ] **Step 1: Write failing service tests for persistence and opt-in confirmation**

In `tests/test_ai_analysis.py`, extend the analysis snapshot test:

```python
assert analysis.suggested_title == "看到需求时的我"
```

Add a test that confirms the same analysis with:

```python
updated = service.confirm_ai_analysis(
    meme.id,
    analysis.id,
    tags=[],
    apply_description=False,
    apply_title=True,
)
assert updated.title == "看到需求时的我"
```

Add a separate default-path test that omits `apply_title` and asserts the original title is unchanged.

Add a legacy-snapshot test by setting `analysis.suggested_title = None`, flushing, and expecting:

```python
with pytest.raises(ValueError, match="does not have a suggested title"):
    service.confirm_ai_analysis(
        meme.id,
        analysis.id,
        tags=[],
        apply_description=False,
        apply_title=True,
    )
```

- [ ] **Step 2: Write failing API and migration tests**

In `tests/test_meme_api.py`, assert the analysis response contains:

```python
assert analysis["suggested_title"] == "看到需求时的我"
```

Verify a confirmation request without `apply_title` preserves the original title, while a fresh analysis confirmed with `"apply_title": True` returns the suggested title.

Add an API case for a legacy null snapshot with `apply_title: true`, expecting HTTP 422 and a detail containing `does not have a suggested title`.

In `tests/test_template_migrations.py`, create or reuse the old `meme_ai_analyses` table shape and assert after two idempotent migration runs:

```python
assert "suggested_title" in {
    column["name"]
    for column in inspect(engine).get_columns("meme_ai_analyses")
}
```

- [ ] **Step 3: Run focused service/API/migration tests and verify failure**

Run:

```powershell
python -m pytest tests/test_ai_analysis.py tests/test_meme_api.py tests/test_template_migrations.py -q
```

Expected: failures for the missing model column, schema fields, service argument, response mapping and migration.

- [ ] **Step 4: Add the nullable snapshot column and repository input**

In `MemeAIAnalysis`:

```python
suggested_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
```

Extend `AIAnalysisRepository.create`:

```python
def create(
    self,
    meme: Meme,
    *,
    model_name: str,
    suggested_title: str,
    description: str,
    suggestions: Sequence[dict[str, object]],
    suggested_template_id: int | None = None,
) -> MemeAIAnalysis:
```

Pass `suggested_title=suggested_title` into `MemeAIAnalysis(...)`.

- [ ] **Step 5: Add the additive migration**

Update the migration docstring version wording if it names an older release, then append:

```python
(
    "meme_ai_analyses",
    "suggested_title",
    "ALTER TABLE meme_ai_analyses ADD COLUMN suggested_title VARCHAR(255)",
),
```

Keep the operation nullable and idempotent; do not write a backfill.

- [ ] **Step 6: Extend schemas and API mapping**

Add:

```python
class AIAnalysisResponse(BaseModel):
    # existing fields
    suggested_title: str | None


class AIAnalysisConfirm(BaseModel):
    # existing fields
    apply_title: bool = False
```

Map the response with:

```python
suggested_title=analysis.suggested_title,
```

Forward confirmation with:

```python
apply_title=payload.apply_title,
```

- [ ] **Step 7: Normalize, persist and conditionally apply the title**

In `analyze_meme`, add service-boundary defense:

```python
suggested_title = result.title.strip()
if not suggested_title or len(suggested_title) > 255:
    raise AIInvalidResponseError("AI title must contain 1 to 255 characters")
```

Pass `suggested_title=suggested_title` to `ai_analysis_repository.create`.

Extend confirmation without breaking existing callers:

```python
def confirm_ai_analysis(
    self,
    meme_id: int,
    analysis_id: int,
    *,
    tags: Sequence[str],
    apply_description: bool,
    apply_title: bool = False,
    template_id: int | None = None,
    apply_template: bool = False,
) -> Meme:
```

Before entering the write transaction:

```python
if apply_title and analysis.suggested_title is None:
    raise ValueError(
        f"AI analysis {analysis_id} does not have a suggested title"
    )
```

Inside the transaction, before marking the analysis confirmed:

```python
if apply_title:
    self.repository.update(meme, {"title": analysis.suggested_title})
```

- [ ] **Step 8: Run backend focused tests**

Run:

```powershell
python -m pytest tests/test_ai_client.py tests/test_ai_analysis.py tests/test_meme_api.py tests/test_template_migrations.py tests/test_templates.py -q
```

Expected: all selected backend tests pass, including the HTTP 422 legacy snapshot case.

### Task 3: Preview and explicitly select the title in the frontend

**Files:**
- Modify: `frontend/src/types.ts:92-108`
- Modify: `frontend/src/types.ts:229-236`
- Modify: `frontend/src/api.ts:261-278`
- Modify: `frontend/src/app.ts:150-165`
- Modify: `frontend/src/app.ts:420-450`
- Modify: `frontend/src/app.ts:1140-1223`
- Modify: `frontend/src/ui.ts:775-877`
- Test: `frontend/src/api.test.ts`
- Test: `frontend/src/app.test.ts`

**Interfaces:**
- Consumes: `AIAnalysisResponse.suggested_title: string | null`
- Produces: `AIAnalysisConfirmPayload.apply_title: boolean`
- Produces: `AppState.applyAITitle: boolean`
- Produces: checkbox selector `[data-ai-title]`

- [ ] **Step 1: Update frontend fixtures and write failing API contract assertions**

Add `suggested_title: "看到需求时的我"` to current analysis fixtures in `frontend/src/api.test.ts` and `frontend/src/app.test.ts`. Use `suggested_title: null` only in the explicit legacy-snapshot test.

In the API confirmation test, send:

```typescript
apply_title: true,
```

and assert the serialized body includes:

```typescript
apply_title: true,
```

- [ ] **Step 2: Write failing application interaction tests**

Extend the main AI preview test to assert:

```typescript
expect(elements.detailPanel.textContent).toContain("看到需求时的我");
const titleChoice = elements.detailPanel.querySelector<HTMLInputElement>(
  "[data-ai-title]",
);
expect(titleChoice?.checked).toBe(false);
```

Confirm once while unchecked and assert:

```typescript
expect(api.confirmAIAnalysis).toHaveBeenCalledWith(
  1,
  1,
  expect.objectContaining({ apply_title: false }),
);
```

In a fresh test, check the box, dispatch `change`, confirm, and assert `apply_title: true`. Make the mocked returned Meme use the suggested title and assert both `app.state.selectedMeme?.title` and the visible detail contain it.

Add a legacy-response test using `suggested_title: null` and assert:

```typescript
expect(
  elements.detailPanel.querySelector("[data-ai-title]"),
).toBeNull();
```

Extend the confirmation-failure test: check `[data-ai-title]`, reject the API call, and assert the checkbox remains checked after rerender.

- [ ] **Step 3: Run focused frontend tests and verify failure**

Run:

```powershell
npm.cmd --prefix frontend test -- src/api.test.ts src/app.test.ts
```

Expected: TypeScript/test failures for missing `suggested_title`, `apply_title`, `applyAITitle` and title checkbox behavior.

- [ ] **Step 4: Extend frontend contracts and initial state**

Add:

```typescript
export interface AIAnalysisResponse {
  // existing fields
  suggested_title: string | null;
}

export interface AIAnalysisConfirmPayload {
  // existing fields
  apply_title: boolean;
}

export interface AppState {
  // existing fields
  applyAITitle: boolean;
}
```

Initialize `applyAITitle: false` beside the other AI-choice state.

- [ ] **Step 5: Render the suggested title and opt-in control**

Update the empty-panel hint to mention the title.

Before the description preview, compute:

```typescript
const suggestedTitle = analysis.suggested_title
  ? `
    <div class="ai-title-suggestion">
      <p><strong>建议标题：${escapeHtml(analysis.suggested_title)}</strong></p>
      <label class="check-row">
        <input
          type="checkbox"
          data-ai-title
          ${state.applyAITitle ? "checked" : ""}
          ${state.confirmingAnalysis ? "disabled" : ""}
        >
        <span>采用建议标题</span>
      </label>
    </div>
  `
  : "";
```

Insert `${suggestedTitle}` before the existing description and tag controls. Do not render an editable title input.

- [ ] **Step 6: Wire selection, reset and confirmation state**

In the delegated `change` handler:

```typescript
} else if (target.matches("[data-ai-title]")) {
  this.state.applyAITitle = target.checked;
```

Set `applyAITitle = false` in:

- initial application state;
- `resetAIAnalysis`;
- the successful `analyzeSelected` result setup;
- successful confirmation cleanup.

Send:

```typescript
apply_title: this.state.applyAITitle,
```

with the existing confirmation payload.

Do not reset `applyAITitle` in the catch path; the final rerender must retain the user's checked choice after a failed confirmation.

- [ ] **Step 7: Run frontend focused tests**

Run:

```powershell
npm.cmd --prefix frontend test -- src/api.test.ts src/app.test.ts
```

Expected: all focused frontend tests pass, including default-off, opt-in, legacy null and retry-state cases.

### Task 4: Full regression verification and worktree review

**Files:**
- Verify only; no additional production files should be introduced unless a test exposes a directly related defect.

**Interfaces:**
- Consumes: completed backend and frontend feature from Tasks 1-3
- Produces: verification evidence and a cleanly scoped uncommitted diff

- [ ] **Step 1: Run frontend type checking**

Run:

```powershell
npm.cmd --prefix frontend run typecheck
```

Expected: exit code 0.

- [ ] **Step 2: Run the complete frontend test suite**

Run:

```powershell
npm.cmd --prefix frontend test
```

Expected: all tests pass, including upload, waterfall, composite Meme, template and AI tests.

- [ ] **Step 3: Build the frontend**

Run:

```powershell
npm.cmd --prefix frontend run build
```

Expected: exit code 0 and a successful Vite production build.

- [ ] **Step 4: Run the complete backend test suite**

Run:

```powershell
python -m pytest -q
```

Expected: all tests pass.

- [ ] **Step 5: Check formatting and unintended changes**

Run:

```powershell
git diff --check
git status -sb
git diff --stat
```

Expected: `git diff --check` exits 0; status contains the pre-existing waterfall-edit changes, this feature's source/tests, and the design/plan documents only. Do not stage, commit, push, or open a pull request.
