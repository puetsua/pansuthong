import { describe, expect, it } from "vitest";
import { Document, Task, TemplateTask } from "./tauri";
import { buildIndexes } from "../state/indexes";
import {
  agendaRowsForDay,
  buildMonthGrid,
  calendarDots,
  shiftMonth,
  summarizeCalendarDay,
  taskOnDate,
} from "./calendar";

const TODAY = "2026-09-05";

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: over.id,
    notes: "",
    tag_ids: [],
    created_at: "2026-01-01T00:00:00+08:00",
    ...over,
  };
}

function doc(tasks: Task[], templates: TemplateTask[] = []): Document {
  return {
    version: 2,
    settings: { theme: "auto", sort_order: "priority" },
    tags: [{ id: "t_rec", name: "rec", color: "#000", priority: 0 }],
    tasks,
    template_tasks: templates,
  };
}

describe("taskOnDate", () => {
  it("matches start or due on the same day", () => {
    expect(taskOnDate(task({ id: "a", start_date: "2026-09-05" }), "2026-09-05")).toBe(true);
    expect(taskOnDate(task({ id: "b", due_date: "2026-09-05" }), "2026-09-05")).toBe(true);
    expect(taskOnDate(task({ id: "c", start_date: "2026-09-06" }), "2026-09-05")).toBe(false);
  });
});

describe("summarizeCalendarDay", () => {
  it("includes open tasks on start/due and recurring ghosts", () => {
    const d = doc(
      [
        task({ id: "k_open", start_date: TODAY }),
        task({ id: "k_done", start_date: TODAY, completed_at: "2026-09-05T10:00:00+08:00" }),
        task({ id: "k_other", due_date: "2026-09-06" }),
      ],
      [{
        id: "tmpl1",
        title: "ghost",
        notes: "",
        tag_ids: [],
        created_at: "2026-01-01T00:00:00+08:00",
        recurrence: { kind: "daily" },
        recurrence_tag_id: "t_rec",
      }],
    );
    const ix = buildIndexes(d, TODAY);
    const summary = summarizeCalendarDay(ix, TODAY);
    expect(summary.tasks.map(t => t.id)).toEqual(["k_open"]);
    expect(summary.ghosts).toHaveLength(1);
    expect(summary.totalCount).toBe(2);
  });
});

describe("agendaRowsForDay", () => {
  it("merges tasks and ghosts by tag weight", () => {
    const d = doc(
      [
        task({ id: "k_low", start_date: TODAY, tag_ids: ["t_rec"] }),
        task({ id: "k_high", start_date: TODAY, tag_ids: ["t_work"] }),
      ],
      [],
    );
    d.tags.push({ id: "t_work", name: "work", color: "#000", priority: 5 });
    const ix = buildIndexes(d, TODAY);
    const rows = agendaRowsForDay(ix, TODAY);
    expect(rows.map(r => r.kind === "task" ? r.task.id : r.ghost.id)).toEqual(["k_high", "k_low"]);
  });
});

describe("calendarDots", () => {
  it("caps visible dots and lists tasks before ghosts", () => {
    const summary = {
      iso: TODAY,
      tasks: [task({ id: "a" }), task({ id: "b" }), task({ id: "c" }), task({ id: "d" })],
      ghosts: [{ id: "g1", title: "g", notes: "", tag_ids: [], templateId: "t", occurrenceDate: TODAY }],
      totalCount: 5,
    };
    expect(calendarDots(summary)).toEqual([
      { kind: "task" }, { kind: "task" }, { kind: "task" },
    ]);
  });
});

describe("buildMonthGrid", () => {
  it("pads weeks to the configured first day of week", () => {
    const d = doc([]);
    const ix = buildIndexes(d, TODAY);
    const weeks = buildMonthGrid("2026-09", 1, ix); // Monday start
    expect(weeks[0][0].iso).toBe("2026-08-31");
    expect(weeks.flat().some(c => c.iso === "2026-09-05" && c.inMonth)).toBe(true);
    expect(weeks.at(-1)?.some(c => c.iso.startsWith("2026-10-"))).toBe(true);
  });
});

describe("shiftMonth", () => {
  it("moves across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});
