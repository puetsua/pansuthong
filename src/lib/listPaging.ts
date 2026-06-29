import { useCallback, useState } from "react";

export const PAGE_SIZES = [10, 30, 50] as const;

export function usePagedItems<T>(items: T[], initialPageSize: number = PAGE_SIZES[0]) {
  const [pageSize, setPageSizeState] = useState<number>(initialPageSize);
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  const resetPage = useCallback(() => setPage(1), []);
  const setPageSize = useCallback((next: number) => {
    setPageSizeState(next);
    setPage(1);
  }, []);

  return {
    pageSize,
    setPageSize,
    page: current,
    setPage,
    totalPages,
    start,
    pageItems,
    resetPage,
  };
}
