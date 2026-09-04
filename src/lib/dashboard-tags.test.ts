import { describe, it, expect } from "vitest";
import { dashboardOrderUpdates, sortDashboardPinnedTags } from "./dashboard-tags";
import type { Tag } from "./tauri";

const tag = (over: Partial<Tag> & Pick<Tag, "id" | "name">): Tag => ({
  color: "#000",
  priority: 0,
  ...over,
});

describe("sortDashboardPinnedTags", () => {
  it("orders explicit dashboard_order before unordered tags, then by name", () => {
    const tags = [
      tag({ id: "t1", name: "Zulu", dashboard_view: "heatmap", dashboard_order: 1 }),
      tag({ id: "t2", name: "Alpha", dashboard_view: "heatmap" }),
      tag({ id: "t3", name: "Beta", dashboard_view: "heatmap", dashboard_order: 0 }),
      tag({ id: "t4", name: "Charlie", dashboard_view: "heatmap" }),
    ];
    expect(sortDashboardPinnedTags(tags).map(t => t.id)).toEqual(["t3", "t1", "t2", "t4"]);
  });

  it("falls back to name sort when no tag has dashboard_order", () => {
    const tags = [
      tag({ id: "t1", name: "work", dashboard_view: "streak" }),
      tag({ id: "t2", name: "home", dashboard_view: "heatmap" }),
    ];
    expect(sortDashboardPinnedTags(tags).map(t => t.name)).toEqual(["home", "work"]);
  });
});

describe("dashboardOrderUpdates", () => {
  it("assigns contiguous indices", () => {
    const tags = [
      tag({ id: "t1", name: "a", dashboard_view: "heatmap" }),
      tag({ id: "t2", name: "b", dashboard_view: "heatmap" }),
    ];
    expect(dashboardOrderUpdates(tags)).toEqual([
      { id: "t1", dashboard_order: 0 },
      { id: "t2", dashboard_order: 1 },
    ]);
  });
});
