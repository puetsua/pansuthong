import { describe, it, expect } from "vitest";
import {
  buildTaskUpdate,
  dueBeforeScheduled,
  EditorForm,
  isEditorDirty,
  sameTagSet,
} from "./taskUpdate";

const base: EditorForm = {
  title: "Write report",
  scheduled_date: "",
  due_date: "",
  notes: "",
  tag_ids: [],
};

describe("buildTaskUpdate", () => {
  it("trims the title", () => {
    expect(buildTaskUpdate("t_1", { ...base, title: "  hi  " }).title).toBe("hi");
  });

  it("clears empty dates to null", () => {
    const p = buildTaskUpdate("t_1", base);
    expect(p.due_date).toBeNull();
    expect(p.scheduled_date).toBeNull();
  });

  it("sets provided dates", () => {
    const p = buildTaskUpdate("t_1", { ...base, due_date: "2026-06-01" });
    expect(p.due_date).toBe("2026-06-01");
  });

  it("passes through notes and tag_ids and id", () => {
    const p = buildTaskUpdate("t_9", { ...base, notes: "n", tag_ids: ["tag_a"] });
    expect(p.id).toBe("t_9");
    expect(p.notes).toBe("n");
    expect(p.tag_ids).toEqual(["tag_a"]);
  });
});

describe("sameTagSet", () => {
  it("is order-insensitive", () => {
    expect(sameTagSet(["a", "b"], ["b", "a"])).toBe(true);
  });
  it("distinguishes different sets", () => {
    expect(sameTagSet(["a"], ["a", "b"])).toBe(false);
    expect(sameTagSet(["a", "b"], ["a", "c"])).toBe(false);
  });
});

describe("isEditorDirty (#51)", () => {
  it("re-adding a removed tag (which reorders tag_ids) is not dirty", () => {
    const initial: EditorForm = { ...base, tag_ids: ["a", "b"] };
    // User removed "a" then re-added it, so order is now ["b", "a"].
    const form: EditorForm = { ...base, tag_ids: ["b", "a"] };
    expect(isEditorDirty(form, initial)).toBe(false);
  });
  it("a real field change is dirty", () => {
    expect(isEditorDirty({ ...base, title: "changed" }, base)).toBe(true);
    expect(isEditorDirty({ ...base, tag_ids: ["a"] }, base)).toBe(true);
  });
});

describe("dueBeforeScheduled (#51)", () => {
  it("flags a due date earlier than the scheduled date", () => {
    expect(dueBeforeScheduled({ scheduled_date: "2026-06-10", due_date: "2026-06-01" })).toBe(true);
  });
  it("allows due on/after scheduled, or either side missing", () => {
    expect(dueBeforeScheduled({ scheduled_date: "2026-06-01", due_date: "2026-06-10" })).toBe(false);
    expect(dueBeforeScheduled({ scheduled_date: "2026-06-01", due_date: "2026-06-01" })).toBe(false);
    expect(dueBeforeScheduled({ scheduled_date: "", due_date: "2026-06-01" })).toBe(false);
    expect(dueBeforeScheduled({ scheduled_date: "2026-06-01", due_date: "" })).toBe(false);
  });
});
