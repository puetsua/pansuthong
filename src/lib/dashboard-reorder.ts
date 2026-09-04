import type { Tag } from "./tauri";

/** Row geometry for pointer hit-testing (midpoint splits decide insert index). */
export type DashboardRowRect = { top: number; height: number };

/** Insert index 0..rows.length from pointer Y over slot rows (cards + placeholder). */
export function dashboardInsertIndexAtY(rows: DashboardRowRect[], clientY: number): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (clientY < row.top + row.height / 2) return i;
  }
  return rows.length;
}

/**
 * Reorder `tags` by moving `fromId` to `insertIndex` (visual slot index including
 * the dragged row). Returns null when the move is a no-op.
 */
export function dashboardReorderAtIndex(
  tags: Tag[],
  fromId: string,
  insertIndex: number,
): Tag[] | null {
  const fromIndex = tags.findIndex(tag => tag.id === fromId);
  if (fromIndex < 0) return null;
  if (insertIndex === fromIndex || insertIndex === fromIndex + 1) return null;
  const next = [...tags];
  const [moved] = next.splice(fromIndex, 1);
  const target = insertIndex > fromIndex ? insertIndex - 1 : insertIndex;
  next.splice(target, 0, moved);
  return next;
}
