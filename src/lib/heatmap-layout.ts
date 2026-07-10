import type { HeatCell } from "./recurrence-heatmap";

/** How many trailing week columns fit in `weeksBudgetPx`. Always at least 1 when totalWeeks > 0. */
export function weeksFittingIn(
  weeksBudgetPx: number,
  weekWidthPx: number,
  gapPx: number,
  totalWeeks: number,
): number {
  if (totalWeeks <= 0) return 0;
  if (weekWidthPx <= 0 || weeksBudgetPx <= 0) return totalWeeks;
  const n = Math.floor((weeksBudgetPx + gapPx) / (weekWidthPx + gapPx));
  return Math.max(1, Math.min(totalWeeks, n));
}

function weekPosition(iso: string, fdow: number): number {
  const [y, m, d] = iso.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (js - fdow + 7) % 7;
}

export function buildHeatmapWeeks(cells: HeatCell[], firstDayOfWeek: number): HeatCell[][] {
  if (cells.length === 0) return [];
  const pad: HeatCell[] = Array.from({ length: weekPosition(cells[0].iso, firstDayOfWeek) }, () => ({
    iso: "", status: "none" as const,
  }));
  const weeks: HeatCell[][] = [];
  const all = [...pad, ...cells];
  for (let i = 0; i < all.length; i += 7) {
    weeks.push(all.slice(i, i + 7));
  }
  return weeks;
}
