import { describe, it, expect } from "vitest";
import { buildTaskUpdate, EditorForm } from "./taskUpdate";

const base: EditorForm = {
  title: "Write report",
  scheduled_date: "",
  due_date: "",
  priority: "",
  notes: "",
  tag_ids: [],
};

describe("buildTaskUpdate", () => {
  it("trims the title", () => {
    expect(buildTaskUpdate("t_1", { ...base, title: "  hi  " }).title).toBe("hi");
  });

  it("clears empty date and priority to null", () => {
    const p = buildTaskUpdate("t_1", base);
    expect(p.due_date).toBeNull();
    expect(p.scheduled_date).toBeNull();
    expect(p.priority).toBeNull();
  });

  it("sets provided date and priority", () => {
    const p = buildTaskUpdate("t_1", { ...base, due_date: "2026-06-01", priority: "high" });
    expect(p.due_date).toBe("2026-06-01");
    expect(p.priority).toBe("high");
  });

  it("passes through notes and tag_ids and id", () => {
    const p = buildTaskUpdate("t_9", { ...base, notes: "n", tag_ids: ["tag_a"] });
    expect(p.id).toBe("t_9");
    expect(p.notes).toBe("n");
    expect(p.tag_ids).toEqual(["tag_a"]);
  });
});
