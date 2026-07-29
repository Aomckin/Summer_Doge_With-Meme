# Meme Vault v0.4 Composite Meme Relations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ordered multi-image Meme composition, manual direct Meme relations, and ordered multi-image AI analysis without breaking v0.3.3 APIs.

**Architecture:** `MemeImage` is the authoritative image source and `Meme` retains only a synchronized first-image compatibility projection. `MemeRelation` stores normalized undirected direct edges. Services control commits, rollbacks, and disk cleanup; FastAPI maps service errors; native TypeScript renders and updates state.

**Tech Stack:** Python, FastAPI, SQLAlchemy, SQLite, Pillow, Pytest, TypeScript, Vite, Vitest, jsdom.

## Global Constraints

- Do not add Alembic, React, Vue, cross-Meme image reuse, relation groups/reasons/transitivity, AI-created relations, or multi-file upload.
- `MemeImage.file_hash` is globally unique and `(meme_id, position)` is unique; position is zero-based.
- The first image is the cover; old cover URL fields remain compatible and mirror it.
- Repositories only flush. Services commit and roll back.
- Do not commit, push, create a PR, or merge.

---

## File Structure

- Create `app/models/meme_image.py`, `app/models/meme_relation.py`, and their flush-only repositories.
- Modify `app/models/meme.py`, `app/database.py`, `app/services/meme_service.py`, `app/schemas/meme.py`, `app/api/memes.py`.
- Modify `app/ai/client.py`, `frontend/src/{types,api,app,ui}.ts`, `frontend/src/styles/main.css`, tests, README, status, plan, and frontend version.

### Task 1: Persist ordered images, direct relation edges, and migrate legacy data

**Files:**
- Create: `app/models/meme_image.py`, `app/models/meme_relation.py`, `app/repositories/meme_image_repository.py`, `app/repositories/meme_relation_repository.py`
- Modify: `app/models/meme.py`, `app/database.py`
- Test: `tests/test_database.py`, `tests/test_meme_model.py`, `tests/test_meme_repository.py`

**Interfaces:**
- `Meme.images: list[MemeImage]` ordered by position.
- `MemeImageRepository.list_for_meme(meme_id)`, `create(image)`, `replace_order(images)`.
- `MemeRelationRepository.list_for_meme(meme_id)`, `create(relation)`, `delete_pair(a, b)`.

- [ ] **Step 1: Write failing tests**

```python
def test_legacy_meme_is_backfilled_once(session, legacy_meme):
    run_startup_migrations(session.bind)
    run_startup_migrations(session.bind)
    assert [(item.meme_id, item.position) for item in legacy_meme.images] == [(legacy_meme.id, 0)]
    assert legacy_meme.images[0].file_hash == legacy_meme.file_hash
```

- [ ] **Step 2: Verify red**

Run: `python -m pytest tests/test_database.py tests/test_meme_model.py -q`

Expected: FAIL because the relationship and backfill do not exist.

- [ ] **Step 3: Implement models and migration**

```python
class MemeImage(Base):
    __tablename__ = "meme_images"
    __table_args__ = (UniqueConstraint("meme_id", "position"),)
    file_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    meme: Mapped["Meme"] = relationship(back_populates="images")
```

Register both models in `create_tables`. After `create_all`, run a SQLite `INSERT ... SELECT` that copies every old `memes` row for which no `meme_images.meme_id` exists; do not move files.

- [ ] **Step 4: Verify green**

Run: `python -m pytest tests/test_database.py tests/test_meme_model.py tests/test_meme_repository.py -q`

Expected: PASS.

### Task 2: Implement transactional image lifecycle and cover synchronization

**Files:**
- Modify: `app/services/meme_service.py`, `app/repositories/meme_repository.py`
- Test: `tests/test_meme_service.py`, `tests/test_image_storage.py`

**Interfaces:**
- `append_image(meme_id, filename, content) -> Meme`
- `delete_image(meme_id, image_id) -> Meme`
- `reorder_images(meme_id, image_ids) -> Meme`

- [ ] **Step 1: Write failing tests**

```python
def test_reorder_syncs_first_image_to_cover(service, created_meme, image_bytes):
    appended = service.append_image(created_meme.id, "second.png", image_bytes)
    updated = service.reorder_images(created_meme.id, [appended.images[1].id, appended.images[0].id])
    assert updated.file_hash == updated.images[0].file_hash

def test_rejects_deleting_last_image(service, created_meme):
    with pytest.raises(ValueError, match="last image"):
        service.delete_image(created_meme.id, created_meme.images[0].id)
```

- [ ] **Step 2: Verify red**

Run: `python -m pytest tests/test_meme_service.py -q`

Expected: FAIL because lifecycle methods do not exist.

- [ ] **Step 3: Implement minimal lifecycle**

Add a private `_sync_cover(meme)` which copies every legacy cover field from `meme.images[0]`. Append at `len(meme.images)`; save files before inserting; on any database exception rollback and delete the new original and thumbnail. Reorder only when the submitted sequence is exactly the current IDs once each, then write positions 0..n-1 in one transaction. Reject final-image deletion; after successful database deletion remove remembered original/thumbnail paths.

- [ ] **Step 4: Verify green**

Run: `python -m pytest tests/test_meme_service.py tests/test_image_storage.py -q`

Expected: PASS, including duplicate-hash cleanup and deleting a complete Meme's all files.

### Task 3: Expose images in schemas and HTTP APIs

**Files:**
- Modify: `app/schemas/meme.py`, `app/api/memes.py`
- Test: `tests/test_meme_api.py`

**Interfaces:**
- `MemeImageResponse`, `ImageOrderRequest(image_ids: list[int])`
- `MemeResponse.images`, `MemeResponse.image_count`
- POST/DELETE/order endpoints required by the task book.

- [ ] **Step 1: Write failing API tests**

```python
def test_image_order_rejects_missing_id(client, meme):
    response = client.patch(f"/api/memes/{meme.id}/images/order", json={"image_ids": []})
    assert response.status_code == 422

def test_append_duplicate_returns_conflict(client, meme, png_bytes):
    response = client.post(f"/api/memes/{meme.id}/images", files={"file": ("copy.png", png_bytes)})
    assert response.status_code == 409
```

- [ ] **Step 2: Verify red**

Run: `python -m pytest tests/test_meme_api.py -q`

Expected: FAIL because routes and response fields are absent.

- [ ] **Step 3: Implement routes and public conversion**

Use `_to_meme_response` to map each ordered image to public URLs and derive all old cover fields from the first image. Map duplicate hash to 409, missing Meme/image to 404, bad order/final image deletion to 422.

- [ ] **Step 4: Verify green**

Run: `python -m pytest tests/test_meme_api.py -q`

Expected: PASS.

### Task 4: Implement direct weak-relation service and API

**Files:**
- Modify: `app/services/meme_service.py`, `app/schemas/meme.py`, `app/api/memes.py`
- Test: `tests/test_meme_service.py`, `tests/test_meme_api.py`

**Interfaces:**
- `list_relations(meme_id) -> list[Meme]`
- `add_relations(meme_id, related_ids) -> list[Meme]`
- `remove_relation(meme_id, related_id) -> None`

- [ ] **Step 1: Write failing tests**

```python
def test_relation_is_bidirectional_not_transitive(service, memes):
    service.add_relations(memes[0].id, [memes[1].id])
    service.add_relations(memes[1].id, [memes[2].id])
    assert {m.id for m in service.list_relations(memes[1].id)} == {memes[0].id, memes[2].id}
    assert [m.id for m in service.list_relations(memes[0].id)] == [memes[1].id]
```

- [ ] **Step 2: Verify red**

Run: `python -m pytest tests/test_meme_service.py tests/test_meme_api.py -q`

Expected: FAIL because relations do not exist.

- [ ] **Step 3: Implement canonical edge operations**

Normalize each pair with `(min(meme_id, other_id), max(meme_id, other_id))`; reject equal IDs. Validate every requested target before adding any edge, de-duplicate input and existing pairs, commit once. Return direct peers only. Ensure complete Meme deletion removes its incident edges but no peer.

- [ ] **Step 4: Verify green**

Run: `python -m pytest tests/test_meme_service.py tests/test_meme_api.py -q`

Expected: PASS.

### Task 5: Send all ordered images in one AI request

**Files:**
- Modify: `app/ai/client.py`, `app/services/meme_service.py`
- Test: `tests/test_ai_client.py`, `tests/test_ai_analysis.py`

**Interfaces:**
- `AIInputImage(data: bytes, mime_type: str, position: int)`
- `AIClient.analyze_images(images, existing_tags, existing_templates)`
- Existing `analyze_image` remains a single-item compatibility wrapper.

- [ ] **Step 1: Write failing payload tests**

```python
def test_chat_client_sends_images_in_position_order(http_client):
    client = OpenAICompatibleChatClient(..., http_client=http_client)
    client.analyze_images(images=[AIInputImage(b"one", "image/png", 0), AIInputImage(b"two", "image/jpeg", 1)], existing_tags=[], existing_templates=[])
    parts = http_client.last_payload["messages"][1]["content"]
    assert [part["type"] for part in parts if part["type"] == "image_url"] == ["image_url", "image_url"]
```

- [ ] **Step 2: Verify red**

Run: `python -m pytest tests/test_ai_client.py tests/test_ai_analysis.py -q`

Expected: FAIL because the multi-image interface is absent.

- [ ] **Step 3: Implement ordered payload builders**

Read `meme.images` in position order. For each item append a numbered text part followed by the image part. Do this for Responses (`input_text`, `input_image`) and Chat (`text`, `image_url`). Update the prompt to identify them as one complete ordered Meme. Persist exactly one existing `MemeAIAnalysis` record and leave description/tags/template unchanged until confirmation.

- [ ] **Step 4: Verify green**

Run: `python -m pytest tests/test_ai_client.py tests/test_ai_analysis.py -q`

Expected: PASS.

### Task 6: Implement frontend image contracts, manager, card badge, and viewer navigation

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/api.ts`, `frontend/src/app.ts`, `frontend/src/ui.ts`, `frontend/src/styles/main.css`
- Test: `frontend/src/api.test.ts`, `frontend/src/app.test.ts`

**Interfaces:**
- `MemeImageResponse`, `appendMemeImage`, `deleteMemeImage`, `reorderMemeImages`.
- Viewer state is URL list plus index and is cleared on close.

- [ ] **Step 1: Write failing frontend tests**

```ts
it("shows a count badge but only the cover in a multi-image card", () => {
  renderLibrary(elements, stateWith({ selectedMeme: null, memes: [multiImageMeme] }));
  expect(elements.grid.querySelectorAll("img")).toHaveLength(1);
  expect(elements.grid.textContent).toContain("2 张");
});
```

- [ ] **Step 2: Verify red**

Run: `npm.cmd --prefix frontend test -- app.test.ts api.test.ts`

Expected: FAIL because images and card badge are absent.

- [ ] **Step 3: Implement UI behavior**

Use current image IDs as a complete drag result and PATCH them after drop. Detail rendering uses ordered vertical images and marks index 0 as cover; append uses a single file input; deletion refreshes state from the returned Meme. Clicking any detail image opens the URL list at its index. Arrow keys and buttons stop at boundaries, and close resets both values.

- [ ] **Step 4: Verify green**

Run: `npm.cmd --prefix frontend test -- app.test.ts api.test.ts`

Expected: PASS.

### Task 7: Implement frontend direct-relation search and multi-select

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/api.ts`, `frontend/src/app.ts`, `frontend/src/ui.ts`, `frontend/src/styles/main.css`
- Test: `frontend/src/api.test.ts`, `frontend/src/app.test.ts`

**Interfaces:**
- `listMemeRelations`, `addMemeRelations`, `deleteMemeRelation`.
- Detail state stores only direct relation summaries and local selection/query values.

- [ ] **Step 1: Write failing frontend tests**

```ts
it("submits all chosen direct relation IDs once", async () => {
  await app.saveRelationSelection();
  expect(api.addMemeRelations).toHaveBeenCalledWith(selected.id, [12, 18, 25]);
});
```

- [ ] **Step 2: Verify red**

Run: `npm.cmd --prefix frontend test -- app.test.ts api.test.ts`

Expected: FAIL because relation UI and client calls are absent.

- [ ] **Step 3: Implement direct-only relation UI**

When selection changes, fetch direct relations. Candidate filtering searches title and description, excludes selected Meme and already related IDs, allows multi-select, then posts once. Detail renders thumbnails/title and removal controls. Clicking a thumbnail selects that Meme. It never computes relationships of peers.

- [ ] **Step 4: Verify green**

Run: `npm.cmd --prefix frontend test -- app.test.ts api.test.ts`

Expected: PASS.

### Task 8: Update actual documentation and complete regression/manual verification

**Files:**
- Modify: `README.md`, `docs/CODEBASE_STATUS.md`, `docs/PROJECT_PLAN.md`, `frontend/package.json`
- Test: all existing backend and frontend suites.

- [ ] **Step 1: Update documents after implementation**

Set frontend v0.4.0. Document only shipped multi-image, direct relation, and ordered AI behavior. Mark the new v0.4 plan complete and move the old copy-lab v0.4 plan to v0.5, shifting later planned releases.

- [ ] **Step 2: Run required verification**

```powershell
npm.cmd --prefix frontend install
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
python -m pytest -q
git status -sb
git diff --stat
```

Expected: all test/build commands exit zero; status contains only intentional v0.4 work.

- [ ] **Step 3: Manual acceptance**

Upload one image, append two, make the third first, read three vertically, open the second image and navigate, inspect ordered FakeAI input, return to one image, add three direct relations, confirm bidirectionality/no transitivity, then delete one Meme and inspect image/relation cleanup.

- [ ] **Step 4: Report without commit**

Report changed files, migration, image/relation/AI call chains, test output, manual results, status, diff stat, real API omission if only FakeAI ran, and suggested commit `feat: add composite memes and manual relations`.
