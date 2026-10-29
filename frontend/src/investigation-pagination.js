/** Paginate precomputed investigation data without changing the underlying results. */
export const PAGE_SIZES = [10, 25, 50]

export function paginateRows(rows, page = 1, pageSize = 10) {
  const total = rows.length
  const safeSize = PAGE_SIZES.includes(pageSize) ? pageSize : PAGE_SIZES[0]
  const pages = Math.max(1, Math.ceil(total / safeSize))
  const requestedPage = Number.isFinite(page) ? Math.trunc(page) : 1
  const currentPage = Math.max(1, Math.min(requestedPage, pages))
  const offset = (currentPage - 1) * safeSize

  return {
    rows: rows.slice(offset, offset + safeSize),
    total,
    page: currentPage,
    pageSize: safeSize,
    pages,
    first: total === 0 ? 0 : offset + 1,
    last: total === 0 ? 0 : Math.min(offset + safeSize, total),
  }
}
