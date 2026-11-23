import { ApiError } from "./api";
import type { PostContent, PostDraft, PostItem, PostItemInput } from "./types";

const journalPrefix = "meme-vault:post-recovery:";

export function newPostId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function postItemInput({ id, meme_id, meme_image_id, caption }: PostItem): PostItemInput {
  return { id, meme_id, meme_image_id, caption };
}

export function postContent({ title, intro_text, outro_text, items }: PostDraft): PostContent {
  return { title, intro_text, outro_text, items: items.map(postItemInput) };
}

export interface SaveFeedback {
  text: string;
  error?: boolean;
  conflict?: boolean;
}

export class PublisherAutosave {
  private changes = 0;
  private saved = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<boolean> | null = null;
  private readonly abort = new AbortController();
  private readonly key: string;
  conflict = false;
  cached = false;

  constructor(
    public draft: PostDraft,
    private readonly save: (id: number, revision: number, body: PostContent, signal: AbortSignal) => Promise<PostDraft>,
    private readonly feedback: (status: SaveFeedback) => void,
    private readonly applied: (saved: PostDraft, current: boolean) => void,
  ) {
    this.key = journalPrefix + draft.id;
  }

  get dirty(): boolean {
    return this.changes !== this.saved;
  }

  restore(): void {
    try {
      const raw = sessionStorage.getItem(this.key);
      if (!raw) return;
      const recovered = JSON.parse(raw) as PostDraft;
      if (recovered.id !== this.draft.id || !Number.isInteger(recovered.revision) || !Array.isArray(recovered.items)) {
        sessionStorage.removeItem(this.key);
        return;
      }
      if (JSON.stringify(postContent(recovered)) === JSON.stringify(postContent(this.draft))) {
        sessionStorage.removeItem(this.key);
        return;
      }
      this.conflict = recovered.revision !== this.draft.revision;
      this.draft = recovered;
      this.changed();
      if (this.conflict) {
        this.feedback({ text: "已恢复本页的修改。服务器已有新版本，请重新读取或另存为新帖文。", error: true, conflict: true });
      }
    } catch {
      this.feedback({ text: "无法读取浏览器中的恢复记录", error: true });
    }
  }

  changed(): void {
    this.changes += 1;
    this.remember();
    clearTimeout(this.timer);
    if (!this.conflict) {
      this.feedback({ text: this.cached ? "等待自动保存…" : "等待保存，浏览器缓存不可用" });
      this.timer = setTimeout(() => void this.flush(), 550);
    }
  }

  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.conflict || this.abort.signal.aborted) return Promise.resolve(false);
    if (!this.dirty) return Promise.resolve(true);
    this.saving ??= this.write().finally(() => { this.saving = null; });
    return this.saving;
  }

  private async write(): Promise<boolean> {
    this.feedback({ text: "正在保存…" });
    try {
      while (this.dirty) {
        const writing = this.changes;
        const saved = await this.save(this.draft.id, this.draft.revision, postContent(this.draft), this.abort.signal);
        if (this.abort.signal.aborted) return false;
        this.draft.revision = saved.revision;
        this.draft.updated_at = saved.updated_at;
        this.saved = writing;
        if (this.dirty) this.remember();
        else this.discardRecovery();
        this.applied(saved, !this.dirty);
      }
      this.feedback({ text: "已保存" });
      return true;
    } catch (error) {
      if (this.abort.signal.aborted) return false;
      this.conflict = error instanceof ApiError && error.status === 409;
      this.feedback({
        text: error instanceof ApiError ? error.message : "自动保存失败，请重试",
        error: true, conflict: this.conflict,
      });
      return false;
    }
  }

  private remember(): void {
    try {
      sessionStorage.setItem(this.key, JSON.stringify(this.draft));
      this.cached = true;
    } catch {
      this.cached = false;
    }
  }

  discardRecovery(): void {
    try {
      sessionStorage.removeItem(this.key);
    } catch {
      this.cached = false;
    }
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.abort.abort();
  }
}

export function clearPublisherRecovery(): void {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(journalPrefix)) sessionStorage.removeItem(key);
    }
  } catch {
    // The browser can deny storage access entirely.
  }
}
