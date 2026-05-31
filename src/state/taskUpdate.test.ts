import { describe, it, expect } from "vitest";
import {
  buildTaskUpdate,
  dueBeforeScheduled,
  EditorForm,
  isEditorDirty,
  offsetFormError,
  sameTagSet,
} from "./taskUpdate";

const base: EditorForm = {
  title: "Write report",
  scheduled_date: "",
  due_date: "",
  notes: "",
  tag_ids: [],
  is_template: false,
  due_offset_days: "",
  scheduled_offset_days: "",
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

  it("a normal task clears offsets and keeps absolute dates (#71)", () => {
    const p = buildTaskUpdate("t_1", { ...base, due_date: "2026-06-01" });
    expect(p.is_template).toBe(false);
    expect(p.due_date).toBe("2026-06-01");
    expect(p.due_offset_days).toBeNull();
    expect(p.scheduled_offset_days).toBeNull();
  });

  it("a template sends relative offsets and clears absolute dates (#71)", () => {
    const p = buildTaskUpdate("t_1", {
      ...base,
      is_template: true,
      due_date: "2026-06-01",        // ignored for templates
      due_offset_days: "3",
      scheduled_offset_days: "0",
    });
    expect(p.is_template).toBe(true);
    expect(p.due_date).toBeNull();
    expect(p.scheduled_date).toBeNull();
    expect(p.due_offset_days).toBe(3);
    expect(p.scheduled_offset_days).toBe(0);
  });

  it("an empty or non-numeric offset becomes null (#71)", () => {
    const p = buildTaskUpdate("t_1", { ...base, is_template: true, due_offset_days: "", scheduled_offset_days: "x" });
    expect(p.due_offset_days).toBeNull();
    expect(p.scheduled_offset_days).toBeNull();
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

describe("offsetFormError (#71)", () => {
  it("accepts empty and in-range offsets", () => {
    expect(offsetFormError({ scheduled_offset_days: "", due_offset_days: "" })).toBeNull();
    expect(offsetFormError({ scheduled_offset_days: "0", due_offset_days: "3" })).toBeNull();
    expect(offsetFormError({ scheduled_offset_days: "", due_offset_days: "3650" })).toBeNull();
  });
  it("rejects out-of-range or non-integer offsets", () => {
    expect(offsetFormError({ scheduled_offset_days: "-1", due_offset_days: "" })).toMatch(/between 0 and 3650/i);
    expect(offsetFormError({ scheduled_offset_days: "", due_offset_days: "9999" })).toMatch(/between 0 and 3650/i);
    expect(offsetFormError({ scheduled_offset_days: "", due_offset_days: "1.5" })).toMatch(/whole number/i);
  });
  it("rejects a due offset earlier than the scheduled offset (mirrors #51)", () => {
    expect(offsetFormError({ scheduled_offset_days: "10", due_offset_days: "3" })).toMatch(/due offset can.?t be before/i);
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
