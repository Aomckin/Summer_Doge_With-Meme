export type PaginationToken = number | "ellipsis";

export const memePageSizeOptions = [24, 48, 96]
  .map(size => `<option value="${size}">${size}</option>`).join("");

export function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 1;
  if (!Number.isFinite(page)) return 1;
  return Math.min(totalPages, Math.max(1, Math.trunc(page)));
}

export function buildPaginationTokens(
  currentPage: number,
  totalPages: number,
): PaginationToken[] {
  if (totalPages <= 0) return [];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const current = clampPage(currentPage, totalPages);
  const pages = new Set([1, totalPages]);
  for (let page = current - 2; page <= current + 2; page += 1) {
    if (page > 1 && page < totalPages) pages.add(page);
  }
  const ordered = [...pages].sort((left, right) => left - right);
  const tokens: PaginationToken[] = [];
  for (const page of ordered) {
    const previous = tokens[tokens.length - 1];
    if (typeof previous === "number" && page - previous > 1) {
      tokens.push("ellipsis");
    }
    tokens.push(page);
  }
  return tokens;
}

export function paginationMarkup(page: number, totalPages: number, loading: boolean): string {
  const disabled = loading || totalPages === 0;
  const tokens = buildPaginationTokens(page, totalPages)
    .map(token => token === "ellipsis"
      ? '<span class="pagination-ellipsis" aria-hidden="true">…</span>'
      : `<button type="button" class="button button-ghost pagination-number${token === page ? " is-active" : ""}" data-page="${token}" ${disabled || token === page ? "disabled" : ""} aria-current="${token === page ? "page" : "false"}">${token}</button>`)
    .join("");
  return `
    <button type="button" class="button button-ghost" data-page="1" ${disabled || page <= 1 ? "disabled" : ""}>第一页</button>
    <button type="button" class="button button-ghost" data-page="${page - 1}" ${disabled || page <= 1 ? "disabled" : ""}>上一页</button>
    <span class="pagination-numbers">${tokens}</span>
    <button type="button" class="button button-ghost" data-page="${page + 1}" ${disabled || page >= totalPages ? "disabled" : ""}>下一页</button>
    <button type="button" class="button button-ghost" data-page="${totalPages}" ${disabled || page >= totalPages ? "disabled" : ""}>最后一页</button>
    <label>跳至页码 <input type="number" min="1" max="${Math.max(1, totalPages)}" inputmode="numeric" data-page-input ${disabled ? "disabled" : ""}></label>`;
}
