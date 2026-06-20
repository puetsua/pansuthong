import { describe, it, expect } from "vitest";
import { Document, Task, TemplateTask } from "./tauri";
import { computeHeatmap } from "./recurrence-heatmap";

const TODAY = "2026-06-08"; // Monday

function tmpl(over: Partial<TemplateTask>): TemplateTask {
  return {
    id: "k_t", title: "Push-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
    recurrence: { kind: "weekly", weekdays: [1] }, // every Monday
    recurrence_tag_id: "t_ex",
    ...over,
  };
}

function spawnedTask(over: Partial<Task>): Task {
  return {
    id: "k_x", title: "Push-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
    ...over,
  };
}

function docWith(tasks: Task[], template: TemplateTask): Document {
  return {
    version: 7, last_modified: undefined,
    settings: { theme: "auto", sort_order: "priority" },
    tags: [{ id: "t_ex", name: "exercise", color: "#000", priority: 0 }],
    tasks, template_tasks: [template],
  } as unknown as Document;
}

describe("computeHeatmap", () => {
  it("returns `days` cells, oldest..today", () => {
    const out = computeHeatmap({
      template: tmpl({}), tasks: [], todayIso: TODAY, days: 14,
    });
    expect(out.cells).toHaveLength(14);
    expect(out.cells[0].iso).toBe("2026-05-26");
    expect(out.cells[13].iso).toBe(TODAY);
  });

  it("marks a Monday the rule fires as 'skip' when nothing was done", () => {
    // 2026-06-08 (today, Mon), 2026-06-01 (Mon), 2026-05-25 (Mon) all fire.
    const out = computeHeatmap({
      template: tmpl({}), tasks: [], todayIso: TODAY, days: 21,
    });
    const mondays = out.cells.filter(c => c.iso === "2026-06-08" || c.iso === "2026-06-01" || c.iso === "2026-05-25");
    expect(mondays).toHaveLength(3);
    expect(mondays.every(c => c.status === "skip")).toBe(true);
    expect(out.scheduled).toBe(3);
    expect(out.skipped).toBe(3);
    expect(out.done).toBe(0);
  });

  it("marks the day 'done' when a same-tag task starting that day is completed", () => {
    const d = docWith(
      [spawnedTask({ id: "k_done", start_date: "2026-06-08", completed_at: "2026-06-08T07:00:00Z" })],
      tmpl({}),
    );
    const out = computeHeatmap({
      template: tmpl({}), tasks: d.tasks, todayIso: TODAY, days: 7,
    });
    const today = out.cells.find(c => c.iso === TODAY)!;
    expect(today.status).toBe("done");
    expect(out.done).toBe(1);
    expect(out.skipped).toBe(0); // the only firing day was done
  });

  it("counts a same-day task that is still open as 'skip' (occurred but not done)", () => {
    const d = docWith(
      [spawnedTask({ id: "k_open", start_date: "2026-06-08" })],
      tmpl({}),
    );
    const out = computeHeatmap({
      template: tmpl({}), tasks: d.tasks, todayIso: TODAY, days: 7,
    });
    const today = out.cells.find(c => c.iso === TODAY)!;
    expect(today.status).toBe("skip");
    expect(out.done).toBe(0);
    expect(out.scheduled).toBe(1);
  });

  it("ignores due-only same-tag tasks (they don't start that day)", () => {
    const d = docWith(
      [spawnedTask({ id: "k_due", due_date: "2026-06-08", completed_at: "2026-06-08T10:00:00Z" })],
      tmpl({}),
    );
    const out = computeHeatmap({
      template: tmpl({}), tasks: d.tasks, todayIso: TODAY, days: 7,
    });
    expect(out.cells.find(c => c.iso === TODAY)!.status).toBe("skip");
    expect(out.done).toBe(0);
  });

  it("only the recurrence tag marks completion; other tags don't", () => {
    const d = docWith(
      [spawnedTask({ id: "k_other", tag_ids: ["t_other"], start_date: "2026-06-08", completed_at: "2026-06-08T09:00:00Z" })],
      tmpl({ tag_ids: ["t_ex", "t_other"] }),
    );
    // Add the other tag to the doc so the model is well-formed (not needed by
    // the helper but keeps the fixture realistic).
    d.tags.push({ id: "t_other", name: "other", color: "#000", priority: 0 });
    const out = computeHeatmap({
      template: tmpl({ tag_ids: ["t_ex", "t_other"] }), tasks: d.tasks,
      todayIso: TODAY, days: 7,
    });
    expect(out.cells.find(c => c.iso === TODAY)!.status).toBe("skip");
    expect(out.done).toBe(0);
  });

  it("returns all 'none' cells and zero counts for a non-recurring template", () => {
    const out = computeHeatmap({
      template: tmpl({ recurrence: undefined, recurrence_tag_id: undefined }),
      tasks: [], todayIso: TODAY, days: 7,
    });
    expect(out.cells.every(c => c.status === "none")).toBe(true);
    expect(out.scheduled).toBe(0);
    expect(out.done).toBe(0);
  });

  it("daily recurrence fires every day in the range", () => {
    const out = computeHeatmap({
      template: tmpl({ recurrence: { kind: "daily" } }),
      tasks: [], todayIso: TODAY, days: 5,
    });
    expect(out.scheduled).toBe(5);
    expect(out.skipped).toBe(5);
  });

  it("a sibling done task keeps the cell 'done' even if a same-tag task was reopened", () => {
    // Two tasks starting today under the recurrence tag: one done, one open.
    const d = docWith([
      spawnedTask({ id: "k_done", start_date: "2026-06-08", completed_at: "2026-06-08T08:00:00Z" }),
      spawnedTask({ id: "k_open", start_date: "2026-06-08" }),
    ], tmpl({}));
    const out = computeHeatmap({
      template: tmpl({}), tasks: d.tasks, todayIso: TODAY, days: 7,
    });
    expect(out.cells.find(c => c.iso === TODAY)!.status).toBe("done");
    expect(out.done).toBe(1);
  });

  it("skips days before recurrence_start_date even if rule fires", () => {
    // Template starts 2026-06-01; 2026-05-25 (the Monday before) must not fire.
    const out = computeHeatmap({
      template: tmpl({ recurrence_start_date: "2026-06-01" }),
      tasks: [], todayIso: TODAY, days: 21,
    });
    // 2026-05-25 is before the 2026-06-01 start date
    expect(out.cells[0].iso).toBe("2026-05-19");
    // The two Mondays before the start date — 2026-05-25 and 2026-06-01.
    // 2026-06-01 IS the start date (>=), so it should fire.
    const may25 = out.cells.find(c => c.iso === "2026-05-25");
    expect(may25!.status).toBe("none");
    expect(out.cells.find(c => c.iso === "2026-06-01")!.status).toBe("skip");
    expect(out.scheduled).toBe(2); // only Jun 1 and Jun 8
  });

  it("recurrence_start_date equal to today works normally", () => {
    const out = computeHeatmap({
      template: tmpl({ recurrence_start_date: TODAY }),
      tasks: [], todayIso: TODAY, days: 14,
    });
    expect(out.cells.find(c => c.iso === TODAY)!.status).toBe("skip");
    expect(out.scheduled).toBe(1);
  });

  it("recurrence_start_date in the future supresses everything", () => {
    const out = computeHeatmap({
      template: tmpl({ recurrence_start_date: "2026-07-01" }),
      tasks: [], todayIso: TODAY, days: 14,
    });
    expect(out.cells.every(c => c.status === "none")).toBe(true);
    expect(out.scheduled).toBe(0);
  });
});