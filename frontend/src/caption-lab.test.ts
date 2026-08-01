import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CaptionLabController,
  type CaptionLabApi,
} from "./caption-lab";
import type { CaptionResponse } from "./types";

const firstCaption: CaptionResponse = {
  id: 1,
  meme_id: 1,
  content: "已有文案",
  scene: "群聊",
  tone: "吐槽",
  length: "short",
  source: "manual",
  created_at: "2026-07-31T00:00:00Z",
  updated_at: "2026-07-31T00:00:00Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve,
  };
}

function makeApi(overrides: Partial<CaptionLabApi> = {}): CaptionLabApi {
  return {
    listCaptions: vi.fn().mockResolvedValue([]),
    createCaption: vi.fn().mockImplementation(async (memeId, payload) => ({
      id: 9,
      meme_id: memeId,
      ...payload,
      scene: payload.scene ?? null,
      tone: payload.tone ?? null,
      length: payload.length ?? null,
      created_at: "2026-07-31T00:00:00Z",
      updated_at: "2026-07-31T00:00:00Z",
    })),
    updateCaption: vi.fn(),
    deleteCaption: vi.fn().mockResolvedValue(undefined),
    generateCaptions: vi.fn().mockResolvedValue({
      model_name: "vision",
      captions: ["候选一", "候选二", "候选三"],
    }),
    rewriteCaption: vi.fn().mockResolvedValue({
      model_name: "vision",
      captions: ["润色结果"],
    }),
    ...overrides,
  };
}

function setup(api = makeApi(), confirmResult = true) {
  document.body.innerHTML =
    '<aside id="detail"><div data-caption-lab-host></div></aside>';
  const panel = document.querySelector<HTMLElement>("#detail")!;
  const confirmDiscard = vi.fn().mockReturnValue(confirmResult);
  const controller = new CaptionLabController(panel, api, {
    confirm: confirmDiscard,
    copy: vi.fn().mockResolvedValue(undefined),
  });
  controller.setMeme(1);
  controller.mount();
  return { api, panel, controller, confirmDiscard };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("CaptionLabController", () => {
  it("loads only the selected Meme and ignores an old request after switching", async () => {
    const first = deferred<CaptionResponse[]>();
    const second = deferred<CaptionResponse[]>();
    const api = makeApi({
      listCaptions: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    });
    const { controller, panel } = setup(api);

    controller.setMeme(2);
    second.resolve([{ ...firstCaption, id: 2, meme_id: 2, content: "新页面" }]);
    await flush();
    first.resolve([firstCaption]);
    await flush();

    expect(api.listCaptions).toHaveBeenNthCalledWith(
      1,
      1,
      expect.any(AbortSignal),
    );
    expect(api.listCaptions).toHaveBeenNthCalledWith(
      2,
      2,
      expect.any(AbortSignal),
    );
    expect(panel.textContent).toContain("新页面");
    expect(panel.textContent).not.toContain("已有文案");
  });

  it("blocks Meme switching when a nonblank draft is unsaved", async () => {
    const { controller, panel, confirmDiscard, api } = setup(
      makeApi(),
      false,
    );
    await flush();
    const textarea = panel.querySelector<HTMLTextAreaElement>(
      "[data-caption-content]",
    )!;
    textarea.value = "还没保存";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    expect(controller.setMeme(2)).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(api.listCaptions).toHaveBeenCalledTimes(1);
  });

  it("does not confirm for a blank draft or temporary AI candidates", async () => {
    const { controller, panel, confirmDiscard } = setup();
    await flush();
    panel
      .querySelector<HTMLButtonElement>("[data-generate-captions]")!
      .click();
    await flush();
    expect(panel.textContent).toContain("候选一");

    expect(controller.setMeme(2)).toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(panel.textContent).not.toContain("候选一");
  });

  it("replaces the draft without saving and then saves the candidate as AI", async () => {
    const api = makeApi();
    const { panel } = setup(api);
    await flush();
    panel
      .querySelector<HTMLButtonElement>("[data-generate-captions]")!
      .click();
    await flush();
    panel
      .querySelector<HTMLButtonElement>("[data-use-candidate='0']")!
      .click();
    expect(
      panel.querySelector<HTMLTextAreaElement>("[data-caption-content]")!.value,
    ).toBe("候选一");
    expect(api.createCaption).not.toHaveBeenCalled();

    panel
      .querySelector<HTMLButtonElement>("[data-save-candidate='0']")!
      .click();
    await flush();
    expect(api.createCaption).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ content: "候选一", source: "ai" }),
    );
  });

  it("keeps the original source when editing a saved caption", async () => {
    const api = makeApi({
      listCaptions: vi.fn().mockResolvedValue([
        { ...firstCaption, source: "ai" },
      ]),
      updateCaption: vi.fn().mockResolvedValue({
        ...firstCaption,
        content: "修改后",
        source: "ai",
      }),
    });
    const { panel } = setup(api);
    await flush();
    panel.querySelector<HTMLButtonElement>("[data-edit-caption='1']")!.click();
    const textarea = panel.querySelector<HTMLTextAreaElement>(
      "[data-caption-content]",
    )!;
    textarea.value = "修改后";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    panel.querySelector<HTMLButtonElement>("[data-save-draft]")!.click();
    await flush();

    expect(api.updateCaption).toHaveBeenCalledWith(
      1,
      1,
      expect.not.objectContaining({ source: expect.anything() }),
    );
  });

  it("leaves the draft and saved list unchanged when AI rewrite fails", async () => {
    const api = makeApi({
      listCaptions: vi.fn().mockResolvedValue([firstCaption]),
      rewriteCaption: vi.fn().mockRejectedValue(new Error("upstream")),
    });
    const { panel } = setup(api);
    await flush();
    const textarea = panel.querySelector<HTMLTextAreaElement>(
      "[data-caption-content]",
    )!;
    textarea.value = "原草稿";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    panel.querySelector<HTMLButtonElement>("[data-rewrite='polish']")!.click();
    await flush();

    expect(textarea.value).toBe("原草稿");
    expect(panel.textContent).toContain("已有文案");
    expect(panel.querySelector("[data-caption-error]")).not.toBeNull();
  });
});
