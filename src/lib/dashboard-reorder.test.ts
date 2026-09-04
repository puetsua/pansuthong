import { describe, it, expect } from "vitest";
import { dashboardInsertIndexAtY, dashboardReorderAtIndex } from "./dashboard-reorder";
import type { Tag } from "./tauri";

const rows = [
  { top: 0, height: 100 },
  { top: 100, height: 100 },
  { top: 200, height: 100 },
];

const tags = (ids: string[]): Tag[] =>
  ids.map(id => ({ id, name: id, color: "#000", priority: 0 }));

describe("dashboardInsertIndexAtY", () => {
  it("picks the row whose midpoint is below the pointer", () => {
    expect(dashboardInsertIndexAtY(rows, 40)).toBe(0);
    expect(dashboardInsertIndexAtY(rows, 120)).toBe(1);
    expect(dashboardInsertIndexAtY(rows, 250)).toBe(3);
  });
});

describe("dashboardReorderAtIndex", () => {
  it("moves the bottom tag to the top", () => {
    const list = tags(["a", "b"]);
    expect(dashboardReorderAtIndex(list, "b", 0)?.map(t => t.id)).toEqual(["b", "a"]);
  });

  it("returns null for a no-op insert beside the source row", () => {
    const list = tags(["a", "b"]);
    expect(dashboardReorderAtIndex(list, "a", 0)).toBeNull();
    expect(dashboardReorderAtIndex(list, "a", 1)).toBeNull();
  });
});
