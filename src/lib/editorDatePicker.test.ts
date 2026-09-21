import { describe, expect, it, vi } from "vitest";
import { buildEditorDatePickerWeeks, claimEditorDatePopover } from "./editorDatePicker";

describe("buildEditorDatePickerWeeks", () => {
  it("returns full weeks covering the month", () => {
    const weeks = buildEditorDatePickerWeeks("2026-09", 1);
    expect(weeks.length).toBeGreaterThan(4);
    expect(weeks.every(w => w.length === 7)).toBe(true);
    const inMonth = weeks.flat().filter(c => c.inMonth);
    expect(inMonth.some(c => c.iso === "2026-09-01")).toBe(true);
    expect(inMonth.some(c => c.iso === "2026-09-30")).toBe(true);
  });
});

describe("claimEditorDatePopover", () => {
  it("closes the previously open popover", () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = claimEditorDatePopover(first);
    claimEditorDatePopover(second);
    expect(first).toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    releaseFirst();
  });
});
