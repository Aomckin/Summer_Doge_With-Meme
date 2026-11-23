import { ApiError } from "./api";

export type Role = "visitor" | "admin";

export interface AuthState {
  authenticated: boolean;
  role: Role | null;
}

export interface Capabilities {
  role: Role;
  canWrite: boolean;
  canBatchDownload: boolean;
  canManageSettings: boolean;
}

export function capabilitiesFor(role: Role): Capabilities {
  const admin = role === "admin";
  return {
    role,
    canWrite: admin,
    canBatchDownload: admin,
    canManageSettings: admin,
  };
}

async function authRequest(path: string, init?: RequestInit): Promise<AuthState> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = await response.json() as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch {
      // Keep the status-based fallback for non-JSON infrastructure errors.
    }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<AuthState>;
}

export async function getCurrentAuth(): Promise<AuthState> {
  const response = await fetch("/api/auth/me");
  if (response.status === 404) {
    // Local compatibility mode when access keys are intentionally not configured.
    return { authenticated: true, role: "admin" };
  }
  if (!response.ok) throw new ApiError(response.status, "无法确认访问身份");
  return response.json() as Promise<AuthState>;
}

export function login(key: string): Promise<AuthState> {
  return authRequest("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
}

export function logout(): Promise<AuthState> {
  return authRequest("/api/auth/logout", { method: "POST" });
}

export function renderAuthLoading(root: HTMLElement): void {
  root.innerHTML = '<main class="access-gate"><div class="access-gate-card"><span class="access-gate-mark">MV</span><p>正在确认 Vault 访问身份…</p></div></main>';
}

export function renderAccessGate(
  root: HTMLElement,
  onAuthenticated: (state: AuthState) => void,
  initialError = "",
): void {
  root.innerHTML = `
    <main class="access-gate">
      <form class="access-gate-card" data-access-form>
        <span class="access-gate-mark" aria-hidden="true">MV</span>
        <p class="eyebrow">PRIVATE COLLECTION</p>
        <h1>Meme Vault</h1>
        <p>你还在 Vault 门外。</p>
        <label><span>Access Key</span><input name="key" type="password" autocomplete="current-password" required autofocus></label>
        <p class="form-error" role="alert" data-access-error ${initialError ? "" : "hidden"}>${initialError}</p>
        <button class="button button-primary" type="submit">进入 Vault</button>
      </form>
    </main>`;
  const form = root.querySelector<HTMLFormElement>("[data-access-form]")!;
  const error = root.querySelector<HTMLElement>("[data-access-error]")!;
  const button = form.querySelector<HTMLButtonElement>("button")!;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const field = form.elements.namedItem("key") as HTMLInputElement;
    button.disabled = true;
    button.textContent = "正在开门…";
    error.hidden = true;
    try {
      const state = await login(field.value);
      field.value = "";
      onAuthenticated(state);
    } catch (caught) {
      error.textContent = caught instanceof ApiError && caught.status === 401
        ? "Access Key 无效"
        : "暂时无法进入 Vault，请稍后重试。";
      error.hidden = false;
      field.select();
    } finally {
      button.disabled = false;
      button.textContent = "进入 Vault";
    }
  });
}

export function mountRoleControls(
  root: HTMLElement,
  role: Role,
  onLogout: () => void,
): void {
  const actions = root.querySelector<HTMLElement>(".header-actions");
  if (!actions) return;
  const group = document.createElement("div");
  group.className = "auth-controls";
  group.innerHTML = `<span class="role-indicator">${role === "admin" ? "Admin" : "Visitor"}</span><button class="button button-ghost" type="button">退出</button>`;
  group.querySelector("button")!.addEventListener("click", onLogout);
  actions.append(group);
}
