import { describe, it, expect } from "vitest";
import { buildHeatmapWeeks, weeksFittingIn } from "./heatmap-layout";
import type { HeatCell } from "./recurrence-heatmap";

function dayCells(fromIso: string, days: number): HeatCell[] {
  const [y, m, d] = fromIso.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  return Array.from({ length: days }, (_, i) => {
    const dt = new Date(start + i * 86_400_000);
    const iso = dt.toISOString().slice(0, 10);
    return { iso, status: "none" as const };
  });
}

describe("weeksFittingIn", () => {
  it("returns all weeks when the budget is generous", () => {
    expect(weeksFittingIn(300, 20, 2, 10)).toBe(10);
  });

  it("returns fewer weeks when the budget is tight", () => {
    expect(weeksFittingIn(64, 20, 2, 10)).toBe(3);
  });

  it("always keeps at least one week when there is content and a positive budget", () => {
    expect(weeksFittingIn(1, 20, 2, 10)).toBe(1);
  });

  it("keeps the full range when layout sizes are unknown (0)", () => {
    expect(weeksFittingIn(0, 20, 2, 10)).toBe(10);
    expect(weeksFittingIn(100, 0, 2, 10)).toBe(10);
  });
});

describe("buildHeatmapWeeks fit-to-width slice", () => {
  it("narrow width keeps trailing weeks ending at today", () => {
    const todayIso = "2026-06-24";
    const cells = dayCells("2026-05-01", 55).filter(c => c.iso <= todayIso);
    if (!cells.some(c => c.iso === todayIso)) {
      cells.push({ iso: todayIso, status: "none" });
    }
    const weeks = buildHeatmapWeeks(cells, 1);
    expect(weeks.length).toBeGreaterThan(3);

    const maxWeeks = weeksFittingIn(64, 20, 2, weeks.length);
    expect(maxWeeks).toBeLessThan(weeks.length);

    const visible = weeks.slice(Math.max(0, weeks.length - maxWeeks));
    const lastWeek = visible[visible.length - 1];
    expect(lastWeek.some(c => c.iso === todayIso)).toBe(true);
    const oldestAll = cells[0].iso;
    const oldestVisible = visible.flat().find(c => c.iso)?.iso;
    expect(oldestVisible! > oldestAll).toBe(true);
  });
});
