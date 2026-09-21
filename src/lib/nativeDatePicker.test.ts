import { describe, it, expect, vi } from "vitest";
import {
  dismissNativeDatePicker,
  dismissOpenDatePickersIn,
  handleEditorDatePickerPointerDownCapture,
} from "./nativeDatePicker";

describe("nativeDatePicker (#237)", () => {
  it("calls hidePicker and blur when dismissing one input", () => {
    const input = document.createElement("input");
    input.type = "date";
    const hidePicker = vi.fn();
    input.hidePicker = hidePicker;
    const blur = vi.spyOn(input, "blur");

    dismissNativeDatePicker(input);

    expect(hidePicker).toHaveBeenCalled();
    expect(blur).toHaveBeenCalled();
  });

  it("dismisses other date inputs in the editor on pointer down outside them", () => {
    const editor = document.createElement("div");
    editor.className = "task-editor";
    const due = document.createElement("input");
    due.type = "date";
    due.value = "2026-09-25";
    const startUnset = document.createElement("input");
    startUnset.type = "text";
    startUnset.className = "te-date-unset";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    editor.append(due, startUnset, cancel);
    document.body.append(editor);

    due.focus();
    const dueHide = vi.fn();
    due.hidePicker = dueHide;
    const dueBlur = vi.spyOn(due, "blur");

    handleEditorDatePickerPointerDownCapture(startUnset);
    expect(dueHide).toHaveBeenCalled();
    expect(dueBlur).toHaveBeenCalled();

    dueHide.mockClear();
    dueBlur.mockClear();
    handleEditorDatePickerPointerDownCapture(cancel);
    expect(dueHide).toHaveBeenCalled();
    expect(dueBlur).toHaveBeenCalled();

    document.body.removeChild(editor);
  });

  it("does not dismiss the date input being clicked", () => {
    const editor = document.createElement("div");
    editor.className = "task-editor";
    const due = document.createElement("input");
    due.type = "date";
    editor.append(due);
    document.body.append(editor);

    const hidePicker = vi.fn();
    due.hidePicker = hidePicker;
    const blur = vi.spyOn(due, "blur");

    handleEditorDatePickerPointerDownCapture(due);

    expect(hidePicker).not.toHaveBeenCalled();
    expect(blur).not.toHaveBeenCalled();

    document.body.removeChild(editor);
  });

  it("dismissOpenDatePickersIn skips the except input", () => {
    const wrap = document.createElement("div");
    const a = document.createElement("input");
    a.type = "date";
    const b = document.createElement("input");
    b.type = "date";
    wrap.append(a, b);
    document.body.append(wrap);

    a.hidePicker = vi.fn();
    b.hidePicker = vi.fn();
    vi.spyOn(a, "blur");
    vi.spyOn(b, "blur");

    dismissOpenDatePickersIn(wrap, b);

    expect(a.hidePicker).toHaveBeenCalled();
    expect(b.hidePicker).not.toHaveBeenCalled();

    document.body.removeChild(wrap);
  });
});
