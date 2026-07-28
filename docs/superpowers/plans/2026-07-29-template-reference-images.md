# Template Reference Images and Visual Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each template optionally own one reference image, use cloud-generated visual embeddings to select the Top-10 image templates, then let the configured vision LLM make the final image-based template decision while retaining description-only category templates.

**Architecture:** Store reference-image metadata and embedding data with `Template`; create isolated reference-image storage; extend the existing provider/model settings with a separately active multimodal-embedding model; use that API to vectorize both template references and incoming Memes. `MemeService` ranks all compatible stored vectors, sends only the Top-10 real image candidates to the existing multimodal LLM clients, and includes description-only templates as text candidates. The frontend extends existing API settings and template-management dialogs rather than introducing a new configuration surface.

**Tech Stack:** FastAPI, SQLAlchemy, SQLite startup migrations, Pillow, httpx, existing Fernet-backed API settings, OpenAI Responses, OpenAI-compatible Chat Completions, Alibaba Cloud Model Studio multimodal embedding API, TypeScript, Vite, Vitest/jsdom, pytest.

## Global Constraints

- One optional reference image per template; no gallery or local GPU/model dependency.
- Reference images use the existing image validation and thumbnail rules, but live under dedicated template-image directories and static URL prefixes.
- SHA-256 is for file identity and cache invalidation only, never visual similarity.
- Select Top-K by cosine similarity across all compatible stored image vectors; `TOP_TEMPLATE_IMAGE_CANDIDATES = 10`.
- No visual-vector model or API failure may cause random template selection. Keep description-only templates available and surface the visual-match-unavailable state.
- Reuse the existing provider/key encryption/settings UI. Visual analysis and image embedding have separate active model selections.
- Existing JSON template CRUD, manual Meme assignment, AI-preview confirmation, and non-embedding providers remain backward compatible.
- Preserve the user’s current uncommitted v0.3.3 work; stage only files belonging to each implementation task.

---

## Task 1: Add persistent reference-image and embedding state

**Files:**
- Modify: `app/models/template.py`
- Modify: `app/models/ai_settings.py`
- Modify: `app/database.py`
- Modify: `app/repositories/template_repository.py`
- Modify: `app/repositories/ai_settings_repository.py`
- Create: `tests/test_template_reference_migrations.py`
- Modify: `tests/test_template_migrations.py`
- Modify: `tests/test_ai_settings.py`

**Interfaces:**
- Consumes: existing `Template`, `AIModel`, and SQLite startup migration conventions.
- Produces: nullable template reference metadata plus stored embedding payload/model identity; `AIModel.supports_image_embedding` and independently unique `AIModel.is_embedding_active`.

- [ ] Write migration tests for an old SQLite `templates` table and old `ai_models` table; assert each new column is added without dropping existing rows.
- [ ] Run `\.venv\Scripts\python.exe -m pytest tests/test_template_reference_migrations.py tests/test_template_migrations.py -q` and confirm the missing-column assertions fail before implementation.
- [ ] Extend `Template` with nullable `reference_stored_filename`, `reference_thumbnail_filename`, `reference_mime_type`, `reference_file_size`, `reference_width`, `reference_height`, `reference_file_hash`, `reference_embedding_json`, and `reference_embedding_model_id` fields. Keep vectors as JSON text, not a SQLite vector extension.
- [ ] Extend `AIModel` with non-null booleans defaulting to `False`:
  ```python
  supports_image_embedding: Mapped[bool] = mapped_column(Boolean, default=False)
  is_embedding_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
  ```
- [ ] Update `run_startup_migrations()` with idempotent SQLite `ALTER TABLE` entries for every new `templates` and `ai_models` column. Do not rebuild tables or add unsafe non-null columns without defaults.
- [ ] Add repository methods `active_embedding_model()` and `clear_active_embedding_models()` parallel to the current analysis-model methods; keep normal `is_active` behavior untouched.
- [ ] Re-run the focused migration/settings tests and confirm they pass.
- [ ] Commit only this task’s model, migration, repository, and test changes with `feat: persist template reference embeddings`.

## Task 2: Create isolated reference-image storage

**Files:**
- Modify: `app/config.py`
- Modify: `app/main.py`
- Modify: `app/storage/image_storage.py`
- Create: `app/storage/template_image_storage.py`
- Create: `tests/test_template_image_storage.py`
- Modify: `tests/test_image_storage.py`

**Interfaces:**
- Consumes: `ImageStorage.save/delete/exists/read_original` validation behavior.
- Produces: `TemplateImageStorage` rooted at `data/template_images/` and `data/template_thumbnails/`, plus `/media/template-images` and `/media/template-thumbnails` static mounts.

- [ ] Add failing storage tests for accepted PNG, rejected invalid data, replacement cleanup, thumbnail generation, and attempts to read/delete outside the template storage roots.
- [ ] Run `\.venv\Scripts\python.exe -m pytest tests/test_template_image_storage.py -q` and confirm failures precede implementation.
- [ ] Add `TEMPLATE_IMAGES_DIR`, `TEMPLATE_THUMBNAILS_DIR`, and URL-prefix constants to `app/config.py`; create/mount these directories in `create_app()` without altering existing Meme media paths.
- [ ] Implement `TemplateImageStorage` as a small specialization/composition of `ImageStorage`, preserving file validation, UUID filenames, path-boundary checks, and thumbnail dimensions while using only template roots.
- [ ] Ensure the service can read the thumbnail bytes and MIME type needed by the embedding API; use PNG MIME for generated thumbnails.
- [ ] Re-run template storage and existing image-storage tests.
- [ ] Commit storage and static-media work with `feat: add template reference image storage`.

## Task 3: Extend API settings for cloud image embeddings

**Files:**
- Create: `app/ai/embedding_client.py`
- Modify: `app/ai/presets.py`
- Modify: `app/schemas/ai_settings.py`
- Modify: `app/services/ai_settings_service.py`
- Modify: `app/api/ai_settings.py`
- Modify: `app/repositories/ai_settings_repository.py`
- Modify: `tests/test_ai_settings.py`
- Create: `tests/test_embedding_client.py`

**Interfaces:**
- Consumes: encrypted `AIProvider` credentials, timeouts/retries, `AIModel` settings records.
- Produces: `ImageEmbeddingClient.embed_image(image_bytes, mime_type) -> ImageEmbeddingResult(vector, model_id)` and a selected, testable embedding model.

- [ ] Add failing unit tests with mocked `httpx.Client` for an Alibaba multimodal embedding success response, 401/5xx handling, timeout/retry behavior, malformed/empty/non-finite vectors, and inconsistent vector dimensions.
- [ ] Add failing settings-service tests that only enabled, embedding-capable models may become `is_embedding_active`, that activating one clears other embedding-active flags, and that analysis `is_active` remains independent.
- [ ] Define a dedicated protocol value (for example `dashscope_multimodal_embedding`) rather than forcing an embedding endpoint through the current chat-completions protocol.
- [ ] Implement a DashScope client that sends the thumbnail as inline base64, validates every numeric element with `isfinite`, and returns a typed immutable result. Reuse `_HTTPAIClient` retry/error semantics where practical without coupling it to chat response parsing.
- [ ] Add an Alibaba Cloud Model Studio embedding preset with `supports_image_embedding=True`; leave existing OpenAI, Qwen chat, and DeepSeek presets semantically unchanged.
- [ ] Extend provider/model schemas and API responses with the embedding capability/activation fields. Add `POST /api/ai-settings/models/{model_id}/test-embedding` (or an equally explicit model-scoped route) using a fixed tiny valid PNG, so embedding health is tested through the actual vector endpoint rather than `/models`.
- [ ] Add `build_active_embedding_client()` that decrypts the configured provider key and rejects missing, disabled, or non-embedding models with the existing configuration error family.
- [ ] Run `\.venv\Scripts\python.exe -m pytest tests/test_embedding_client.py tests/test_ai_settings.py -q` and confirm success.
- [ ] Commit settings and embedding-client work with `feat: configure cloud image embeddings`.

## Task 4: Add reference-image upload, replacement, and removal APIs

**Files:**
- Modify: `app/schemas/template.py`
- Modify: `app/api/templates.py`
- Modify: `app/services/template_service.py`
- Modify: `app/repositories/template_repository.py`
- Modify: `app/main.py`
- Modify: `tests/test_templates.py`
- Create: `tests/test_template_reference_images.py`

**Interfaces:**
- Consumes: `TemplateImageStorage`, active `ImageEmbeddingClient`, and template CRUD errors.
- Produces: `POST /api/templates/{id}/reference-image`, `DELETE /api/templates/{id}/reference-image`, enriched `TemplateResponse` URL/metadata fields.

- [ ] Write API tests for upload response URLs, invalid/oversize input, missing template, replacement, explicit removal, access to mounted original/thumbnail URLs, and deletion cleanup after a template is deleted.
- [ ] Write service tests for these atomicity cases:
  ```python
  # New file is removed if embedding or database persistence fails.
  # Old file is retained if replacement fails.
  # Old file is deleted only after a successful replacement commit.
  ```
- [ ] Run the new focused tests and verify they fail before endpoint/service changes.
- [ ] Extend `TemplateResponse` with nullable reference-image URLs and dimensions. Construct URLs from stored filenames only; never expose server paths.
- [ ] Inject `TemplateImageStorage` and an embedding-client factory into `TemplateService` for testability. Upload flow: validate/save image -> generate vector -> write metadata/vector/model ID -> commit -> delete displaced files. On failure: rollback and delete only newly written files.
- [ ] Delete-reference flow clears every image and embedding field in one commit, then deletes physical files. Template deletion follows the existing association cleanup, then removes any retained files after commit.
- [ ] Make `POST` multipart-only for the new reference resource; keep existing template creation/edit JSON endpoints unchanged.
- [ ] Re-run template tests and static media tests.
- [ ] Commit this API/service slice with `feat: manage template reference images`.

## Task 5: Rank image templates and build visual AI candidates

**Files:**
- Modify: `app/services/meme_service.py`
- Modify: `app/ai/client.py`
- Modify: `app/repositories/template_repository.py`
- Create: `app/services/template_matching.py`
- Modify: `tests/test_ai_analysis.py`
- Modify: `tests/test_ai_client.py`
- Create: `tests/test_template_matching.py`

**Interfaces:**
- Consumes: active embedding client, template vectors/model identity, Meme original bytes, template thumbnails.
- Produces: deterministic `rank_visual_templates(...) -> list[VisualTemplateCandidate]`, `TOP_TEMPLATE_IMAGE_CANDIDATES = 10`, and visual image parts in both LLM protocols.

- [ ] Add failing pure-unit tests for cosine ranking: all-template evaluation, descending deterministic ties by template ID, Top-10 cap, zero/malformed vectors ignored, dimension/model mismatch ignored, and no-random-fallback behavior.
- [ ] Implement a focused matcher module with explicit data types:
  ```python
  @dataclass(frozen=True)
  class VisualTemplateCandidate:
      template_id: int
      similarity: float
  ```
  Normalize vectors or calculate cosine safely; never use a cryptographic hash as a distance metric.
- [ ] Update `MemeService.analyze_meme()` to request one query vector, rank all templates whose stored embedding model matches the active model, load only Top-10 thumbnails, and include every no-image template as a text-only candidate.
- [ ] Define explicit degradation: unavailable embedding configuration/upstream/vector error yields zero visual candidates and a status value for the UI, while text-only candidates still reach the vision LLM. Do not turn an embedding outage into an analysis HTTP failure unless no normal AI analysis client is available.
- [ ] Expand `AITemplateCandidate` with `reference_image_bytes`, `reference_image_mime_type`, `reference_image_hash`, `visual_similarity`, and a boolean/text-only marker.
- [ ] Update the system prompt and both request builders: the static prefix contains ordered Top-10 image candidates and their IDs, then dynamic tag context and Meme image follow. State that reference-image structure dominates title/description; text-only templates are broad categories only.
- [ ] For `OpenAIResponsesClient`, derive a stable cache key from prompt revision, ordered candidate IDs/hashes, embedding model ID, and Top-K. Enable only documented Responses caching fields. For `OpenAICompatibleChatClient`, omit cache-only fields and preserve the same visual semantics.
- [ ] Update client tests to assert exact content ordering, data URLs for candidate thumbnails, text-only candidate labeling, cache-key stability/change, and rejection of IDs outside the supplied candidate set.
- [ ] Run `\.venv\Scripts\python.exe -m pytest tests/test_template_matching.py tests/test_ai_analysis.py tests/test_ai_client.py -q`.
- [ ] Commit visual matching work with `feat: match templates by reference images`.

## Task 6: Surface visual-matching availability in analysis responses

**Files:**
- Modify: `app/models/ai_analysis.py`
- Modify: `app/schemas/ai_analysis.py`
- Modify: `app/repositories/ai_analysis_repository.py`
- Modify: `app/services/meme_service.py`
- Modify: `app/database.py`
- Modify: `tests/test_ai_analysis.py`
- Modify: `tests/test_database.py`

**Interfaces:**
- Consumes: matching outcome from Task 5.
- Produces: a persisted and returned status such as `visual_template_matching_available: bool`, so users can distinguish “no match” from “visual retrieval unavailable.”

- [ ] Write failing persistence/API tests for visual matching available/unavailable statuses and old SQLite database migration.
- [ ] Add one non-null analysis field with a safe default for historical rows, and an idempotent SQLite migration.
- [ ] Persist the status on every AI analysis without changing existing suggested-template confirmation behavior.
- [ ] Re-run focused analysis/database tests.
- [ ] Commit with `feat: report template visual matching status`.

## Task 7: Extend frontend API types and API settings UI

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/settings.ts`
- Modify: `frontend/src/ui.ts`
- Modify: `frontend/src/app.ts`
- Modify: `frontend/src/styles/main.css`
- Modify: `frontend/src/api.test.ts`
- Modify: `frontend/src/app.test.ts`

**Interfaces:**
- Consumes: expanded provider/model/analysis API payloads and embedding test endpoint.
- Produces: API settings controls for a separately active template-visual-retrieval model.

- [ ] Add failing API tests for parsing `supports_image_embedding`, `is_embedding_active`, and invoking the model-scoped embedding-test endpoint.
- [ ] Extend `AIModelResponse` and payload types with the two embedding fields; add the API client call for embedding testing.
- [ ] Update settings rendering so capability badges distinguish “视觉分析” and “模板视觉检索”. A model supporting both may show both badges.
- [ ] Add an independent action labeled “用于模板视觉检索”; it patches only `is_embedding_active: true`, and remains disabled with a clear reason when provider/model is disabled or lacks embedding support.
- [ ] Add embedding connection-test feedback separate from the existing provider `/models` test; preserve current provider/model management controls.
- [ ] Add jsdom coverage that activates an embedding-capable model without deactivating the visual-analysis model and reports endpoint failure accessibly.
- [ ] Run `npm.cmd --prefix frontend test -- --run` and `npm.cmd --prefix frontend run typecheck`.
- [ ] Commit frontend settings work with `feat: configure template visual retrieval`.

## Task 8: Add reference-image management to the template dialog

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/app.ts`
- Modify: `frontend/src/ui.ts`
- Modify: `frontend/src/styles/main.css`
- Modify: `frontend/src/api.test.ts`
- Modify: `frontend/src/app.test.ts`

**Interfaces:**
- Consumes: `TemplateResponse.reference_*` fields and template reference-image endpoints.
- Produces: optional image picker, visual/reference preview, replacement/removal actions, and a retryable partial-save state.

- [ ] Add failing API tests for multipart `uploadTemplateReferenceImage(templateId, file)` and deletion requests.
- [ ] Extend template form markup with an optional accepted-image file input and a preview/status region. Existing templates with no image must render as “描述分类模板”; templates with images render as “视觉参考模板”.
- [ ] Implement create flow as JSON template creation followed by optional reference upload. If upload fails, retain the created template and selected file, show “模板已保存，但参考图上传失败”, and allow retry without recreating it.
- [ ] Implement edit flow to replace an existing reference image, remove it with confirmation, reset file input safely after success, and refresh template state consumed by upload/edit/AI panels.
- [ ] Render reference thumbnails with image fallback handling and descriptive alt text; do not introduce a separate gallery.
- [ ] Add jsdom tests for image/no-image rows, create-plus-upload order, upload failure/retry, replacement, removal, and compatibility of existing Meme template selectors.
- [ ] Run `npm.cmd --prefix frontend test -- --run`, `npm.cmd --prefix frontend run typecheck`, and `npm.cmd --prefix frontend run build`.
- [ ] Commit template UI work with `feat: manage template reference images in UI`.

## Task 9: Display analysis mode and document operational behavior

**Files:**
- Modify: `frontend/src/ui.ts`
- Modify: `frontend/src/app.test.ts`
- Modify: `README.md`
- Modify: `docs/CODEBASE_STATUS.md`
- Modify: `docs/PROJECT_PLAN.md`

**Interfaces:**
- Consumes: `AIAnalysisResponse.visual_template_matching_available` and current settings state.
- Produces: clear user-facing distinction between successful visual matching, no final match, and description-only fallback.

- [ ] Add a failing UI test asserting that an unavailable vector service displays “视觉模板匹配暂不可用；仅按描述分类” rather than “未找到模板”.
- [ ] Render a concise status note in the existing AI template-choice panel; retain the suggested-template and manual override controls.
- [ ] Update README/settings documentation with: an embedding provider must be configured for reference-image matching, Top-K is 10, no GPU is required, raw template images are stored locally, and existing LLM providers can remain separate.
- [ ] Update `CODEBASE_STATUS.md` and `PROJECT_PLAN.md` to mark this feature as implemented only after all verification passes.
- [ ] Run the relevant frontend tests and inspect docs for stale claims that template images are absent.
- [ ] Commit documentation/UI status work with `docs: document visual template matching`.

## Task 10: Full regression and manual acceptance

**Files:**
- Modify only if failures reveal a scoped defect in earlier tasks.

**Interfaces:**
- Consumes: completed backend/frontend implementation.
- Produces: verified build, regression evidence, and a manual checklist suitable for handoff.

- [ ] Run backend suite: `\.venv\Scripts\python.exe -m pytest -q`.
- [ ] Run frontend checks: `npm.cmd --prefix frontend run typecheck`, `npm.cmd --prefix frontend test`, and `npm.cmd --prefix frontend run build`.
- [ ] Run `git diff --check` and inspect `git status --short`; ensure no runtime `data/` files, API keys, or generated frontend build artifacts are staged.
- [ ] Manually verify: configure an embedding model in API settings; upload a Drake source image to a template; upload an edited Drake Meme; confirm the template enters Top-10 and is suggested; create a no-image chat-screenshot category and confirm it remains selectable; replace and remove the reference image; disable the embedding model and confirm description-only fallback is explicit.
- [ ] If all checks pass, commit any only remaining scoped fixes with `test: verify template visual matching`.
