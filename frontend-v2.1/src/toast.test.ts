import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToasts, showToast } from "./toast";

describe("toast module", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearToasts();
    vi.useRealTimers();
  });

  it("creates toast container and displays message with correct role and class", () => {
    showToast("操作成功", "success");
    const container = document.querySelector("#toast-container");
    expect(container).not.toBeNull();
    const item = container?.querySelector(".toast-item.toast-success");
    expect(item).not.toBeNull();
    expect(item?.getAttribute("role")).toBe("status");
    expect(item?.textContent).toBe("操作成功");
  });

  it("sets alert role for error type", () => {
    showToast("发生错误", "error");
    const item = document.querySelector(".toast-item.toast-error");
    expect(item?.getAttribute("role")).toBe("alert");
    expect(item?.textContent).toBe("发生错误");
  });

  it("automatically removes toast after specified duration", () => {
    showToast("自动消失提示", "info", 1500);
    expect(document.querySelector(".toast-item")).not.toBeNull();
    vi.advanceTimersByTime(1500);
    // After timer fires, fallback timeout runs within 300ms
    vi.advanceTimersByTime(350);
    expect(document.querySelector(".toast-item")).toBeNull();
  });

  it("dismisses on click immediately", () => {
    const toast = showToast("点击关闭", "warning", 5000);
    toast.click();
    vi.advanceTimersByTime(350);
    expect(document.querySelector(".toast-item")).toBeNull();
  });

  it("clears all active toasts via clearToasts()", () => {
    showToast("提示 1");
    showToast("提示 2");
    expect(document.querySelectorAll(".toast-item").length).toBe(2);
    clearToasts();
    expect(document.querySelectorAll(".toast-item").length).toBe(0);
  });
});
