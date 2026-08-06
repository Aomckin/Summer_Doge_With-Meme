export type PaginationToken = number | "ellipsis";

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
