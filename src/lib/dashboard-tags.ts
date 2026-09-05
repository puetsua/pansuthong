import { api, type DashboardView, type Tag } from "./tauri";

/** Default dashboard card view when pinning a tag from the picker or sidebar. */
export const DASHBOARD_PIN_VIEW: DashboardView = "heatmap";

/** Pin a tag to the dashboard (heatmap view). */
export function pinTagToDashboard(tag: Tag): Promise<Tag> {
  return api.updateTag({ id: tag.id, dashboard_view: DASHBOARD_PIN_VIEW });
}

/** Sort pinned Dashboard tags: explicit `dashboard_order` first, then name. */
export function sortDashboardPinnedTags(tags: Tag[]): Tag[] {
  return [...tags].sort((a, b) => {
    const ao = a.dashboard_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.dashboard_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
}

/** Assign contiguous order indices for a reordered pinned tag list. */
export function dashboardOrderUpdates(ordered: Tag[]): { id: string; dashboard_order: number }[] {
  return ordered.map((tag, index) => ({ id: tag.id, dashboard_order: index }));
}
