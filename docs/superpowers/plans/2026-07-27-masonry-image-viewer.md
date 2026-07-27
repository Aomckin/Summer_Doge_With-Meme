# Meme Vault Masonry Image Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cropped fixed-ratio Meme cards with a responsive natural-ratio masonry gallery and add a reliable full-screen original-image viewer.

**Architecture:** Keep the backend and `AppState` unchanged. Render intrinsic image dimensions and overlay metadata from `frontend/src/ui.ts`, use stable CSS multi-column layout in `frontend/src/styles/main.css`, and manage the single reusable native `<dialog>` through UI helpers called by the existing `MemeVaultApp` event delegation.

**Tech Stack:** Vite 8, native TypeScript, native CSS multi-column layout, native `<dialog>`, Vitest 4 with jsdom, FastAPI regression suite.

## Global Constraints

- Do not modify the backend API, database, media routes, or thumbnail-generation logic.
- Do not add Vue, React, a UI library, a masonry dependency, or touch-specific behavior.
- `.meme-card` must use `position: relative`, `display: inline-block`, `width: 100%`, an explicit bottom margin, and `break-inside: avoid`.
- Card and detail images must use the API-provided `width` and `height` and must never be placed in a fixed-aspect-ratio display box.
- Before every viewer open, clear the prior image's `hidden`, `.is-broken`, and error-message state.
- Never call `showModal()` when the image-viewer dialog is already open.
- Backdrop close must require `event.target === dialog`; clicks on the image, title, link, and internal buttons must not close it.
- The viewer image must live inside a container with explicit viewport-based width and height limits so `object-fit: contain` has a definite box.
- The original-image link must use `target="_blank"` and `rel="noopener noreferrer"`.
- Preserve existing search, filter, pagination, random, upload, edit, delete, loading, and error behavior.

---

## File Structure

- Modify `frontend/src/ui.ts`: card/detail markup, persistent viewer markup, viewer element references, open/close/error helpers.
- Modify `frontend/src/app.ts`: delegate detail-viewer open and persistent dialog close/backdrop/error events.
- Modify `frontend/src/styles/main.css`: CSS multi-column gallery, natural-ratio images, hover/focus overlays, detail preview, viewport-constrained viewer.
- Modify `frontend/src/app.test.ts`: behavioral regression tests for intrinsic cards, viewer open/close, error recovery, and `showModal()` guard.
- No backend or Python file changes.

### Task 1: Natural-ratio masonry cards

**Files:**
- Modify: `frontend/src/app.test.ts`
- Modify: `frontend/src/ui.ts`
- Modify: `frontend/src/styles/main.css`

**Interfaces:**
- Consumes: `MemeResponse.width`, `MemeResponse.height`, `MemeResponse.thumbnail_url`, `MemeResponse.image_url`, and `MemeResponse.tags`.
- Produces: each `[data-meme-id]` card contains `.card-image > img[width][height]` and a `.card-overlay` with title and tags.

- [ ] **Step 1: Write a failing card-rendering test**

Add this case inside the existing `describe("MemeVaultApp", ...)` in `frontend/src/app.test.ts`:

```ts
it("renders natural-ratio cards with overlay metadata", async () => {
  const portrait = {
    ...makeMeme(1, "纵向 Meme"),
    width: 1260,
    height: 1861,
  };
  const app = new MemeVaultApp(
    root(),
    makeApi({ listMemes: vi.fn().mockResolvedValue([portrait]) }),
  );

  await app.start();

  const card = document.querySelector<HTMLElement>('[data-meme-id="1"]');
  const image = card?.querySelector<HTMLImageElement>(".card-image img");
  expect(image?.getAttribute("width")).toBe("1260");
  expect(image?.getAttribute("height")).toBe("1861");
  expect(card?.querySelector(".card-overlay strong")?.textContent).toBe(
    "纵向 Meme",
  );
  expect(card?.querySelector(".card-overlay .tag")?.textContent).toBe(
    "funny",
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd --prefix frontend test -- src/app.test.ts
```

Expected: FAIL because the image has no `width`/`height` attributes and `.card-overlay` does not exist.

- [ ] **Step 3: Implement intrinsic card markup**

In `cardMarkup()` in `frontend/src/ui.ts`:

```ts
<span class="card-image">
  <img
    src="${escapeHtml(image)}"
    alt="${escapeHtml(meme.title)}"
    width="${meme.width}"
    height="${meme.height}"
    loading="lazy"
  >
  <span class="image-fallback" aria-hidden="true">图片不可用</span>
</span>
<span class="card-overlay">
  <strong>${escapeHtml(meme.title)}</strong>
  <span class="card-tags">${tagMarkup(meme.tags.map((tag) => tag.name))}</span>
</span>
```

Remove the old `.card-body` markup. Keep the card button, `data-meme-id`, selection class, and accessible label unchanged.

- [ ] **Step 4: Replace the fixed grid and fixed card ratio**

In `frontend/src/styles/main.css`, implement:

```css
.meme-grid {
  column-width: 220px;
  column-gap: 14px;
}

.meme-card {
  position: relative;
  display: inline-block;
  overflow: hidden;
  width: 100%;
  min-height: 0;
  margin: 0 0 14px;
  padding: 0;
  break-inside: avoid;
  vertical-align: top;
}

.card-image {
  display: block;
  overflow: hidden;
  width: 100%;
  background:
    linear-gradient(135deg, rgb(230 255 74 / 6%), transparent),
    #0b0e13;
}

.card-image img {
  display: block;
  width: 100%;
  height: auto;
}

.card-overlay {
  position: absolute;
  inset: auto 0 0;
  display: grid;
  gap: 8px;
  padding: 42px 14px 14px;
  background: linear-gradient(transparent, rgb(7 9 13 / 92%));
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 160ms ease,
    transform 160ms ease;
  pointer-events: none;
}

.meme-card:hover .card-overlay,
.meme-card:focus-visible .card-overlay {
  opacity: 1;
  transform: translateY(0);
}
```

Delete the `.card-image { aspect-ratio: 4 / 3; }` rule and the obsolete `.card-body` rules. Keep the existing hover, selected, tag, fallback, skeleton, and reduced-motion behavior compatible with the new structure.

- [ ] **Step 5: Run the focused test and typecheck**

Run:

```powershell
npm.cmd --prefix frontend test -- src/app.test.ts
npm.cmd --prefix frontend run typecheck
```

Expected: the new test and all existing `app.test.ts` cases PASS; typecheck exits 0.

- [ ] **Step 6: Commit the masonry-card change**

```powershell
git add frontend/src/app.test.ts frontend/src/ui.ts frontend/src/styles/main.css
git commit -m "fix: render natural-ratio masonry cards"
```

### Task 2: Full-screen original-image viewer

**Files:**
- Modify: `frontend/src/app.test.ts`
- Modify: `frontend/src/ui.ts`
- Modify: `frontend/src/app.ts`
- Modify: `frontend/src/styles/main.css`

**Interfaces:**
- Extends `AppElements` with `imageViewerDialog`, `imageViewerFrame`, `imageViewerImage`, `imageViewerTitle`, `imageViewerLink`, and `imageViewerError`.
- Produces `openImageViewer(elements: AppElements, meme: MemeResponse): void`.
- Produces `closeImageViewer(elements: AppElements): void`.
- The detail preview exposes `[data-open-viewer]`.
- The viewer close button exposes `[data-close-viewer]`.

- [ ] **Step 1: Write failing viewer open and security-attribute tests**

Add to `frontend/src/app.test.ts`:

```ts
it("opens the selected original image in a reusable viewer", async () => {
  const portrait = {
    ...makeMeme(1, "纵向 Meme"),
    width: 1260,
    height: 1861,
  };
  const app = new MemeVaultApp(
    root(),
    makeApi({ listMemes: vi.fn().mockResolvedValue([portrait]) }),
  );
  await app.start();

  document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
  document.querySelector<HTMLButtonElement>("[data-open-viewer]")?.click();

  const dialog =
    document.querySelector<HTMLDialogElement>("#image-viewer-dialog");
  const image = dialog?.querySelector<HTMLImageElement>("[data-viewer-image]");
  const link = dialog?.querySelector<HTMLAnchorElement>("[data-viewer-link]");
  expect(dialog?.open).toBe(true);
  expect(image?.getAttribute("src")).toBe(portrait.image_url);
  expect(image?.getAttribute("width")).toBe("1260");
  expect(image?.getAttribute("height")).toBe("1861");
  expect(dialog?.querySelector("[data-viewer-title]")?.textContent).toBe(
    "纵向 Meme",
  );
  expect(link?.getAttribute("href")).toBe(portrait.image_url);
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
});
```

- [ ] **Step 2: Write failing close-boundary tests**

Add:

```ts
it("closes only for the viewer backdrop or explicit close button", async () => {
  const meme = makeMeme(1, "查看边界");
  const app = new MemeVaultApp(
    root(),
    makeApi({ listMemes: vi.fn().mockResolvedValue([meme]) }),
  );
  await app.start();
  document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
  document.querySelector<HTMLButtonElement>("[data-open-viewer]")?.click();

  const dialog =
    document.querySelector<HTMLDialogElement>("#image-viewer-dialog");
  const content = dialog?.querySelector<HTMLElement>(".image-viewer-content");
  const title = dialog?.querySelector<HTMLElement>("[data-viewer-title]");
  content?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  title?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(dialog?.open).toBe(true);

  dialog?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(dialog?.open).toBe(false);
});
```

The production listener must use:

```ts
if (event.target === elements.imageViewerDialog) {
  closeImageViewer(elements);
}
```

- [ ] **Step 3: Write failing error-reset and `showModal()` guard tests**

Add:

```ts
it("recovers when a valid image opens after a failed viewer image", async () => {
  const broken = makeMeme(1, "损坏图片");
  const valid = makeMeme(2, "正常图片");
  const app = new MemeVaultApp(
    root(),
    makeApi({ listMemes: vi.fn().mockResolvedValue([broken, valid]) }),
  );
  await app.start();

  document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();
  document.querySelector<HTMLButtonElement>("[data-open-viewer]")?.click();
  const dialog =
    document.querySelector<HTMLDialogElement>("#image-viewer-dialog");
  const image = dialog?.querySelector<HTMLImageElement>("[data-viewer-image]");
  const frame = dialog?.querySelector<HTMLElement>("[data-viewer-frame]");
  const error = dialog?.querySelector<HTMLElement>("[data-viewer-error]");
  image?.dispatchEvent(new Event("error"));
  expect(image?.hidden).toBe(true);
  expect(frame?.classList.contains("is-broken")).toBe(true);
  expect(error?.hidden).toBe(false);

  dialog?.close();
  document.querySelector<HTMLButtonElement>('[data-meme-id="2"]')?.click();
  document.querySelector<HTMLButtonElement>("[data-open-viewer]")?.click();
  expect(image?.hidden).toBe(false);
  expect(frame?.classList.contains("is-broken")).toBe(false);
  expect(error?.hidden).toBe(true);
  expect(image?.getAttribute("src")).toBe(valid.image_url);
});

it("does not call showModal again while the viewer is open", async () => {
  const showModal = vi.spyOn(
    HTMLDialogElement.prototype,
    "showModal",
  );
  const app = new MemeVaultApp(
    root(),
    makeApi({ listMemes: vi.fn().mockResolvedValue([makeMeme(1)]) }),
  );
  await app.start();
  document.querySelector<HTMLButtonElement>('[data-meme-id="1"]')?.click();

  const trigger =
    document.querySelector<HTMLButtonElement>("[data-open-viewer]");
  trigger?.click();
  trigger?.click();

  expect(showModal).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Run viewer tests and verify RED**

Run:

```powershell
npm.cmd --prefix frontend test -- src/app.test.ts
```

Expected: FAIL because the viewer dialog and trigger do not exist.

- [ ] **Step 5: Add persistent viewer markup and references**

In `mountShell()` in `frontend/src/ui.ts`, add one sibling dialog after the upload dialog:

```html
<dialog
  id="image-viewer-dialog"
  class="image-viewer"
  aria-labelledby="image-viewer-title"
>
  <div class="image-viewer-content">
    <header class="image-viewer-header">
      <h2 id="image-viewer-title" data-viewer-title></h2>
      <div class="image-viewer-actions">
        <a
          class="button button-secondary"
          data-viewer-link
          target="_blank"
          rel="noopener noreferrer"
        >打开原图</a>
        <button
          class="icon-button"
          type="button"
          data-close-viewer
          aria-label="关闭原图查看器"
        >×</button>
      </div>
    </header>
    <div class="image-viewer-frame" data-viewer-frame>
      <img data-viewer-image alt="" hidden>
      <p data-viewer-error role="alert" hidden>原图加载失败</p>
    </div>
  </div>
</dialog>
```

Add the six typed viewer elements to `AppElements` and return them with `required()` from `mountShell()`.

- [ ] **Step 6: Implement detail trigger and viewer helpers**

Change `detailImage()` to return a button with intrinsic dimensions:

```ts
<button
  class="detail-image"
  type="button"
  data-open-viewer
  aria-label="查看《${escapeHtml(meme.title)}》原图"
>
  <img
    src="${escapeHtml(meme.image_url)}"
    alt="${escapeHtml(meme.title)}"
    width="${meme.width}"
    height="${meme.height}"
  >
  <span class="image-fallback" aria-hidden="true">原图不可用</span>
</button>
```

Export these helpers from `frontend/src/ui.ts`:

```ts
export function openImageViewer(
  elements: AppElements,
  meme: MemeResponse,
): void {
  elements.imageViewerImage.hidden = false;
  elements.imageViewerFrame.classList.remove("is-broken");
  elements.imageViewerError.hidden = true;
  elements.imageViewerError.textContent = "";

  elements.imageViewerImage.src = meme.image_url;
  elements.imageViewerImage.alt = meme.title;
  elements.imageViewerImage.width = meme.width;
  elements.imageViewerImage.height = meme.height;
  elements.imageViewerTitle.textContent = meme.title;
  elements.imageViewerLink.href = meme.image_url;

  if (!elements.imageViewerDialog.open) {
    elements.imageViewerDialog.showModal();
  }
}

export function closeImageViewer(elements: AppElements): void {
  if (elements.imageViewerDialog.open) {
    elements.imageViewerDialog.close();
  }
}
```

The viewer image `error` handler must set `image.hidden = true`, add `.is-broken` to `imageViewerFrame`, set the error copy, and reveal `imageViewerError`.

- [ ] **Step 7: Bind viewer events in `MemeVaultApp`**

Import `openImageViewer` and `closeImageViewer` in `frontend/src/app.ts`.

Extend the detail click delegation:

```ts
if (target.closest("[data-open-viewer]")) {
  const meme = this.state.selectedMeme;
  if (meme) {
    openImageViewer(this.elements, meme);
  }
} else if (target.closest("[data-edit-meme]")) {
  // existing branch
}
```

Bind the persistent dialog once:

```ts
this.elements.imageViewerDialog.addEventListener("click", (event) => {
  if (event.target === this.elements.imageViewerDialog) {
    closeImageViewer(this.elements);
  }
});
this.elements.imageViewerDialog
  .querySelector("[data-close-viewer]")
  ?.addEventListener("click", () => closeImageViewer(this.elements));
this.elements.imageViewerImage.addEventListener("error", () => {
  this.elements.imageViewerImage.hidden = true;
  this.elements.imageViewerFrame.classList.add("is-broken");
  this.elements.imageViewerError.textContent = "原图加载失败";
  this.elements.imageViewerError.hidden = false;
});
```

- [ ] **Step 8: Add definite viewer geometry and natural detail sizing**

In `frontend/src/styles/main.css`:

```css
.detail-image {
  display: block;
  overflow: hidden;
  width: 100%;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: #0b0e13;
  cursor: zoom-in;
}

.detail-image img {
  display: block;
  width: 100%;
  height: auto;
}

.image-viewer {
  width: 100vw;
  max-width: none;
  height: 100vh;
  max-height: none;
  padding: 0;
  border: 0;
  background: transparent;
}

.image-viewer::backdrop {
  background: rgb(0 0 0 / 86%);
}

.image-viewer-content {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(96vw, 1600px);
  height: 94vh;
  margin: 3vh auto;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: #090b10;
}

.image-viewer-header,
.image-viewer-actions {
  display: flex;
  align-items: center;
}

.image-viewer-header {
  justify-content: space-between;
  gap: 20px;
  min-height: 70px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
}

.image-viewer-header h2 {
  overflow: hidden;
  margin: 0;
  font-size: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-viewer-actions {
  flex: none;
  gap: 8px;
}

.image-viewer-frame {
  display: grid;
  place-items: center;
  overflow: hidden;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.image-viewer-frame img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-viewer-frame.is-broken {
  color: var(--muted);
}

[data-viewer-error] {
  margin: 0;
  color: #ff95a2;
}
```

Remove the old `.detail-image { aspect-ratio: 4 / 3; }` and shared percentage-height image rule.

- [ ] **Step 9: Run focused and full frontend verification**

Run:

```powershell
npm.cmd --prefix frontend test -- src/app.test.ts
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run build
```

Expected: all tests PASS, typecheck exits 0, Vite build succeeds.

- [ ] **Step 10: Commit the viewer**

```powershell
git add frontend/src/app.test.ts frontend/src/ui.ts frontend/src/app.ts frontend/src/styles/main.css
git commit -m "feat: add full-screen meme viewer"
```

### Task 3: Browser acceptance and final regression

**Files:**
- No planned production-file changes.
- If verification exposes a defect, return to the relevant task, add a failing regression test first, then make the smallest correction.

**Interfaces:**
- Consumes the completed frontend production build.
- Produces verification evidence only; no backend behavior changes.

- [ ] **Step 1: Run all automated acceptance commands from the worktree**

```powershell
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
& '..\..\.venv\Scripts\python.exe' -m pytest -q
git diff --check
```

Expected: typecheck exits 0; all Vitest and all 49 baseline Pytest cases pass; Vite builds; `git diff --check` reports no whitespace errors.

- [ ] **Step 2: Start the worktree FastAPI build on an unused local port**

Run the worktree app on `127.0.0.1:8765` using the shared virtual environment. Keep the process hidden and record the printed PID so it can be stopped after verification:

```powershell
$pathValue = [Environment]::GetEnvironmentVariable('Path', 'Process')
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $pathValue, 'Process')
$pythonExe = (Resolve-Path '..\..\.venv\Scripts\python.exe').Path
$stdoutPath = Join-Path $env:TEMP 'meme-viewer-stdout.log'
$stderrPath = Join-Path $env:TEMP 'meme-viewer-stderr.log'
$server = Start-Process `
  -FilePath $pythonExe `
  -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8765' `
  -WorkingDirectory (Get-Location).Path `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru
$server.Id
```

- [ ] **Step 3: Populate disposable worktree data with three ratios**

Use the existing upload API against port `8765` to upload copies of:

- `..\..\data\images\24cc7edad742437ba4f4504ad95cc2f2.jpg` (`1080 × 1087`)
- `..\..\data\images\6b1e8582cf4c4b118e3723b47a9fcbb0.jpg` (`1080 × 1080`)
- `..\..\data\images\fed9c545c0c341e7ae4a541e8a505d57.jpg` (`1260 × 1861`)

The worktree uses its own ignored `data/` directory, so this does not alter the main checkout's database or media.

Run:

```powershell
curl.exe -sS -X POST http://127.0.0.1:8765/api/memes `
  -F "file=@..\..\data\images\24cc7edad742437ba4f4504ad95cc2f2.jpg" `
  -F "title=方形 Meme"
curl.exe -sS -X POST http://127.0.0.1:8765/api/memes `
  -F "file=@..\..\data\images\6b1e8582cf4c4b118e3723b47a9fcbb0.jpg" `
  -F "title=正方形 Meme"
curl.exe -sS -X POST http://127.0.0.1:8765/api/memes `
  -F "file=@..\..\data\images\fed9c545c0c341e7ae4a541e8a505d57.jpg" `
  -F "title=纵向 Meme"
```

- [ ] **Step 4: Verify the live layout in the browser**

At wide, medium, and narrow desktop widths, confirm:

- the CSS column count changes with available width;
- all three cards show their complete images at natural ratio;
- cards include the required bottom gap and do not split across columns;
- hover and keyboard focus reveal title/tags without changing card height;
- selection still updates the right-side detail;
- the detail preview shows the complete image.

- [ ] **Step 5: Verify viewer boundaries and recovery in the browser**

Confirm:

- clicking the detail preview opens one full-screen dialog;
- the entire image fits inside the definite viewer frame;
- clicking image, title, “打开原图”, or close-area content does not trigger backdrop close;
- clicking the backdrop closes;
- `Escape` and the close button close;
- “打开原图” opens a new tab without an opener;
- after forcing one viewer image to fail, opening a valid Meme resets hidden, `.is-broken`, and error state.

- [ ] **Step 6: Stop the local server and confirm repository state**

Resolve the listener on port `8765`, verify that it is the shared virtual-environment Python executable started in Step 2, and stop only that process:

```powershell
$listener = netstat -ano |
  Select-String -Pattern '127\.0\.0\.1:8765\s+.*LISTENING' |
  Select-Object -First 1
$serverPid = [int](($listener.Line -split '\s+')[-1])
$serverProcess = Get-Process -Id $serverPid
$expectedPython = (Resolve-Path '..\..\.venv\Scripts\python.exe').Path
if ($serverProcess.Path -ne $expectedPython) {
  throw "Refusing to stop unexpected process $serverPid"
}
Stop-Process -Id $serverPid
```

Then run:

```powershell
git status -sb
git log -3 --oneline
```

Expected: no uncommitted source changes; ignored build, dependency, and disposable data directories remain outside the commit.
