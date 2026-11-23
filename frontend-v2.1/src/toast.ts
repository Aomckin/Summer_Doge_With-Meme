export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  type?: ToastType;
  duration?: number;
}

let container: HTMLElement | null = null;
const activeTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

function getOrCreateContainer(): HTMLElement {
  if (container && document.body.contains(container)) {
    return container;
  }
  let existing = document.querySelector<HTMLElement>("#toast-container");
  if (!existing) {
    existing = document.createElement("div");
    existing.id = "toast-container";
    existing.className = "toast-container";
    existing.setAttribute("aria-live", "polite");
    existing.setAttribute("aria-atomic", "true");
    document.body.append(existing);
  }
  container = existing;
  return container;
}

export function showToast(
  message: string,
  typeOrOptions: ToastType | ToastOptions = "info",
  duration = 2400,
): HTMLElement {
  const options: ToastOptions =
    typeof typeOrOptions === "string"
      ? { type: typeOrOptions, duration }
      : { type: "info", duration: 2400, ...typeOrOptions };

  const type = options.type ?? "info";
  const toastDuration = options.duration ?? 2400;

  const host = getOrCreateContainer();
  const toast = document.createElement("div");
  toast.className = `toast-item toast-${type}`;
  toast.dataset.toastType = type;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const messageSpan = document.createElement("span");
  messageSpan.className = "toast-message";
  messageSpan.textContent = message;
  toast.append(messageSpan);

  const dismiss = () => {
    const timer = activeTimers.get(toast);
    if (timer) {
      clearTimeout(timer);
      activeTimers.delete(toast);
    }
    toast.classList.add("toast-leaving");
    toast.addEventListener(
      "transitionend",
      () => {
        toast.remove();
      },
      { once: true },
    );
    // Fallback if transitionend does not fire (e.g. in test environment)
    setTimeout(() => {
      if (toast.isConnected) toast.remove();
    }, 300);
  };

  toast.addEventListener("click", dismiss);

  host.append(toast);

  if (toastDuration > 0) {
    const timer = setTimeout(dismiss, toastDuration);
    activeTimers.set(toast, timer);
  }

  return toast;
}

export function clearToasts(): void {
  for (const timer of activeTimers.values()) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  if (container) {
    container.replaceChildren();
  }
  const found = document.querySelector<HTMLElement>("#toast-container");
  if (found) {
    found.replaceChildren();
  }
}
