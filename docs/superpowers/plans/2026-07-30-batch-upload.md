# Meme Vault v0.4.1 Batch Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed batch-upload dialog that creates one Meme per selected image through the existing single-image API.

**Architecture:** A new `BatchUploadController` owns its dialog markup, file queue, metadata, rendering, and serial upload loop. `MemeVaultApp` only opens the controller, supplies templates and `uploadMeme`, and refreshes Meme/tag/template state after a completed batch.

**Tech Stack:** Native TypeScript, DOM APIs, Vitest/jsdom, existing Vite frontend and FastAPI backend.

## Global Constraints

- Version is exactly `0.4.1`.
- Uploads use the existing `uploadMeme` API strictly in selection order.
- No concurrent uploads, backend batch API, immediate-on-drop upload, per-file editing, composite Meme creation, request aborting, or page-wide drop target.
- HTTP 409 is the stable duplicate signal and maps to `skipped`.
- Do not commit, push, or create a PR.

---

### Task 1: Batch upload controller behavior

**Files:**
- Create: `frontend/src/batch-upload.test.ts`
- Create: `frontend/src/batch-upload.ts`

**Interfaces:**
- Consumes: `UploadMemeInput`, `TemplateResponse`, `ApiError`, and an injected `(input: UploadMemeInput) => Promise<MemeResponse>`.
- Produces: `BatchUploadController.open(templates)`, a serial queue with `pending | uploading | success | skipped | failed`, and an async completion callback.

- [x] Write tests proving multi-file selection/drop, filename-derived titles, previews, removal, clearing, and shared metadata.
- [x] Run `npm.cmd --prefix frontend test -- batch-upload.test.ts` and confirm failures because the controller does not exist.
- [x] Implement the minimal dialog, queue, object-URL cleanup, metadata fields, and pre-upload controls.
- [x] Run the focused tests and confirm they pass.
- [x] Add tests proving strict serial order, failure continuation, 409 skipping, stop-after-current, resume, retry-failed-only, auto-close on success/skips, retain-on-failure, and unfinished-close confirmation.
- [x] Run the focused tests and confirm failures for missing queue behavior.
- [x] Implement the serial loop and state transitions without concurrent promises or request cancellation.
- [x] Run the focused tests and confirm they pass.

### Task 2: Application integration

**Files:**
- Modify: `frontend/src/app.test.ts`
- Modify: `frontend/src/app.ts`
- Modify: `frontend/src/ui.ts`
- Modify: `frontend/src/types.ts`

**Interfaces:**
- Consumes: `BatchUploadController` and the app's existing `uploadMeme`, `listMemes`, `listTags`, and `listTemplates`.
- Produces: toolbar button labeled `图片上传`; completion callback refreshes Memes, tags, templates, and relevant rendered state.

- [x] Replace legacy single-upload integration expectations with a failing app test for opening batch upload, template propagation, and completion refresh.
- [x] Run the focused app test and confirm it fails against the legacy upload flow.
- [x] Remove upload queue ownership and legacy upload fields from `MemeVaultApp`/`AppElements`; instantiate the controller and update its template options after template refresh.
- [x] Run `npm.cmd --prefix frontend test -- app.test.ts` and confirm all app tests pass.

### Task 3: Batch dialog styling

**Files:**
- Modify: `frontend/src/styles/main.css`

- [x] Add focused styles for the wide dialog, drop zone, scrollable thumbnail queue, state badges, progress/statistics, disabled/locked controls, and narrow-screen layout.
- [x] Run `npm.cmd --prefix frontend run typecheck` to catch selector-adjacent TypeScript integration mistakes.

### Task 4: Stable duplicate contract

**Files:**
- Modify only if needed: `app/api/memes.py`, `frontend/src/api.ts`, and their tests.

- [x] Confirm existing single upload returns HTTP 409 only for duplicate images.
- [x] Keep the existing status contract if confirmed; do not add a backend payload change.
- [x] Ensure controller tests classify `new ApiError(409, ...)` as skipped without inspecting message text.

### Task 5: Version and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/CODEBASE_STATUS.md`
- Modify: `docs/PROJECT_PLAN.md`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`

- [x] Change frontend package and lockfile versions from `0.4.0` to `0.4.1`.
- [x] Document the fixed batch-upload entry, serial queue, shared metadata, pause/resume/retry behavior, duplicate handling, and completion refresh.
- [x] Mark v0.4.1 complete in the project plan without changing later milestone scope.

### Task 6: Full verification

- [x] Run `npm.cmd --prefix frontend run typecheck`.
- [x] Run `npm.cmd --prefix frontend test`.
- [x] Run `npm.cmd --prefix frontend run build`.
- [x] Run `python -m pytest -q`.
- [x] Run `git diff --check`.
- [x] Run `git status -sb`.
- [x] Run `git diff --stat`.
- [x] Review the final diff against every requirement and report files, flow, pause/retry, results, status, and stat.
