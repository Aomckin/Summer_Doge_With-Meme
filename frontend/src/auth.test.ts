import { beforeEach, describe, expect, it, vi } from "vitest";
import { capabilitiesFor, getCurrentAuth, login, renderAccessGate } from "./auth";

describe("auth", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("maps roles to centralized capabilities", () => {
    expect(capabilitiesFor("visitor").canWrite).toBe(false);
    expect(capabilitiesFor("visitor").canBatchDownload).toBe(false);
    expect(capabilitiesFor("admin").canManageSettings).toBe(true);
  });

  it("treats a missing auth API as explicit local compatibility mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(getCurrentAuth()).resolves.toEqual({ authenticated: true, role: "admin" });
  });

  it("exchanges a key without storing it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ authenticated: true, role: "visitor" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    await login("one-time-key");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
    expect(localStorage.getItem("accessKey")).toBeNull();
    expect(sessionStorage.getItem("accessKey")).toBeNull();
  });

  it("renders one key field with no role selector", () => {
    const root = document.createElement("div");
    renderAccessGate(root, vi.fn());
    expect(root.querySelector('input[name="key"]')).not.toBeNull();
    expect(root.querySelector("select")).toBeNull();
  });
});
