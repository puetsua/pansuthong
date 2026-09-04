import { describe, it, expect } from "vitest";
import { computeTagAnalytics } from "./tag-analytics";
import { Task } from "./tauri";

const task = (over: Partial<Task>): Task => ({
  id: "t1",
  title: "t",
  notes: "",
  tag_ids: [],
  created_at: "2026-06-11T00:00:00+08:00",
  ...over,
});

describe("computeTagAnalytics day-start hour (#186)", () => {
  it("attributes completed_at to the logical day, not wall-clock date", () => {
    // day_start_hour=4: 02:00 on June 11 belongs to logical June 10.
    const tasks = [task({ completed_at: "2026-06-11T02:00:00+08:00" })];
    const analytics = computeTagAnalytics(tasks, "2026-06-11", 7, new Set(), 4);
    const june10 = analytics.heat.cells.find(c => c.iso === "2026-06-10");
    const june11 = analytics.heat.cells.find(c => c.iso === "2026-06-11");
    expect(june10?.status).toBe("done");
    expect(june11?.status).not.toBe("done");
  });

  it("attributes time-entry start to the logical day", () => {
    const tasks = [task({
      time_entries: [{ id: "e1", start: "2026-06-11T02:00:00+08:00", end: "2026-06-11T03:00:00+08:00" }],
    })];
    const analytics = computeTagAnalytics(tasks, "2026-06-11", 7, new Set(), 4);
    const june10 = analytics.heat.cells.find(c => c.iso === "2026-06-10");
    expect(june10?.status).toBe("skip");
  });

  it("uses wall-clock date when day_start_hour is 0", () => {
    const tasks = [task({ completed_at: "2026-06-11T02:00:00+08:00" })];
    const analytics = computeTagAnalytics(tasks, "2026-06-11", 7, new Set(), 0);
    const june11 = analytics.heat.cells.find(c => c.iso === "2026-06-11");
    expect(june11?.status).toBe("done");
  });
});
