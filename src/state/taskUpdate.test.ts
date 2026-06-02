import { describe, it, expect } from "vitest";
import {
  buildTaskUpdate,
  buildTemplateUpdate,
  dueBeforeScheduled,
  EditorForm,
  isEditorDirty,
  offsetFormError,
  sameTagSet,
} from "./taskUpdate";

const base: EditorForm = {
  title: "Write report",
  scheduled_date: "",
  scheduled_time: "",
  due_date: "",
  due_time: "",
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

  it("a task payload carries no template fields (#71)", () => {
    const p = buildTaskUpdate("t_1", { ...base, due_date: "2026-06-01" });
    expect(p.due_date).toBe("2026-06-01");
    expect("is_template" in p).toBe(false);
    expect("due_offset_days" in p).toBe(false);
    expect("scheduled_offset_days" in p).toBe(false);
  });
});

describe("buildTemplateUpdate (#71)", () => {
  it("trims the title and passes through notes/tag_ids/id", () => {
    const p = buildTemplateUpdate("k_9", { ...base, title: "  weekly  ", notes: "n", tag_ids: ["tag_a"] });
    expect(p.id).toBe("k_9");
    expect(p.title).toBe("weekly");
    expect(p.notes).toBe("n");
    expect(p.tag_ids).toEqual(["tag_a"]);
  });

  it("sends relative offsets and never absolute dates", () => {
    const p = buildTemplateUpdate("k_1", { ...base, due_offset_days: "3", scheduled_offset_days: "0" });
    expect(p.due_offset_days).toBe(3);
    expect(p.scheduled_offset_days).toBe(0);
    expect("due_date" in p).toBe(false);
    expect("scheduled_date" in p).toBe(false);
  });

  it("an empty or non-numeric offset becomes null (clear)", () => {
    const p = buildTemplateUpdate("k_1", { ...base, due_offset_days: "", scheduled_offset_days: "x" });
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
  const noTimes = { scheduled_time: "", due_time: "" };
  it("flags a due date earlier than the scheduled date", () => {
    expect(dueBeforeScheduled({ scheduled_date: "2026-06-10", due_date: "2026-06-01", ...noTimes })).toBe(true);
  });
  it("allows due on/after scheduled, or either side missing", () => {
    expect(dueBeforeScheduled({ scheduled_date: "2026-06-01", due_date: "2026-06-10", ...noTimes })).toBe(false);
    expect(dueBeforeScheduled({ scheduled_date: "2026-06-01", due_date: "2026-06-01", ...noTimes })).toBe(false);
    expect(dueBeforeScheduled({ scheduled_date: "", due_date: "2026-06-01", ...noTimes })).toBe(false);
    expect(dueBeforeScheduled({ scheduled_date: "2026-06-01", due_date: "", ...noTimes })).toBe(false);
  });
});

describe("time-of-day on scheduled/due (#93)", () => {
  it("buildTaskUpdate sends times, and clears a time with no date", () => {
    const p = buildTaskUpdate("t_1", {
      ...base, scheduled_date: "2026-06-01", scheduled_time: "09:30",
      due_date: "2026-06-02", due_time: "17:00",
    });
    expect(p.scheduled_time).toBe("09:30");
    expect(p.due_time).toBe("17:00");
    // A time with no date is meaningless -> null.
    const q = buildTaskUpdate("t_1", { ...base, scheduled_date: "", scheduled_time: "09:30" });
    expect(q.scheduled_time).toBeNull();
  });

  it("dueBeforeScheduled compares to the minute on the same day", () => {
    // Same day, due earlier in the day than scheduled -> flagged.
    expect(dueBeforeScheduled({
      scheduled_date: "2026-06-01", scheduled_time: "14:00",
      due_date: "2026-06-01", due_time: "09:00",
    })).toBe(true);
    // Same day, due later -> allowed.
    expect(dueBeforeScheduled({
      scheduled_date: "2026-06-01", scheduled_time: "09:00",
      due_date: "2026-06-01", due_time: "14:00",
    })).toBe(false);
    // A missing time counts as start-of-day, so day-only stays equivalent.
    expect(dueBeforeScheduled({
      scheduled_date: "2026-06-01", scheduled_time: "",
      due_date: "2026-06-01", due_time: "",
    })).toBe(false);
  });

  it("a time-only change makes the form dirty", () => {
    expect(isEditorDirty({ ...base, scheduled_date: "2026-06-01", scheduled_time: "09:00" },
                         { ...base, scheduled_date: "2026-06-01", scheduled_time: "" })).toBe(true);
    expect(isEditorDirty({ ...base, due_date: "2026-06-01", due_time: "17:00" },
                         { ...base, due_date: "2026-06-01", due_time: "" })).toBe(true);
  });
});
