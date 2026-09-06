import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findEditableTarget,
  getEditableActionStates,
  runEditableAction,
  snapshotEditableSelection,
  clearEditableSelectionSnapshot,
} from "./editableContextMenu";

describe("findEditableTarget", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  it("finds text inputs and textareas", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    root.append(input, textarea);

    expect(findEditableTarget(input)).toBe(input);
    expect(findEditableTarget(textarea)).toBe(textarea);
  });

  it("ignores disabled inputs and checkboxes", () => {
    const disabled = document.createElement("input");
    disabled.disabled = true;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    root.append(disabled, checkbox);

    expect(findEditableTarget(disabled)).toBeNull();
    expect(findEditableTarget(checkbox)).toBeNull();
  });

  it("finds contenteditable elements", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "hello";
    root.append(editable);

    const span = document.createElement("span");
    span.textContent = "x";
    editable.append(span);

    expect(findEditableTarget(span)).toBe(editable);
  });
});

describe("getEditableActionStates", () => {
  it("enables copy/cut only when text is selected", () => {
    const input = document.createElement("input");
    input.value = "hello";
    document.body.appendChild(input);
    input.setSelectionRange(0, 2);

    expect(getEditableActionStates(input)).toEqual({
      cut: true,
      copy: true,
      paste: true,
      selectAll: true,
    });

    input.setSelectionRange(2, 2);
    expect(getEditableActionStates(input)).toMatchObject({
      cut: false,
      copy: false,
      paste: true,
      selectAll: true,
    });

    input.remove();
  });

  it("uses a pointerdown snapshot when the live selection was cleared", () => {
    const input = document.createElement("input");
    input.value = "hello";
    document.body.appendChild(input);
    input.setSelectionRange(0, 5);
    snapshotEditableSelection(input);
    input.setSelectionRange(5, 5);

    expect(getEditableActionStates(input)).toMatchObject({
      cut: true,
      copy: true,
    });

    clearEditableSelectionSnapshot(input);
    expect(getEditableActionStates(input)).toMatchObject({
      cut: false,
      copy: false,
    });

    input.remove();
  });

  it("disables cut and paste on read-only inputs", () => {
    const input = document.createElement("input");
    input.value = "hello";
    input.readOnly = true;
    input.setSelectionRange(0, 2);
    document.body.appendChild(input);

    expect(getEditableActionStates(input)).toEqual({
      cut: false,
      copy: true,
      paste: false,
      selectAll: true,
    });

    input.remove();
  });
});

describe("runEditableAction", () => {
  it("delegates to document.execCommand on the target", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const exec = vi.spyOn(document, "execCommand").mockReturnValue(true);

    runEditableAction(input, "selectAll");

    expect(document.activeElement).toBe(input);
    expect(exec).toHaveBeenCalledWith("selectAll");

    exec.mockRestore();
    input.remove();
  });

  it("restores a collapsed selection before copy", () => {
    const input = document.createElement("input");
    input.value = "hello";
    document.body.appendChild(input);
    input.setSelectionRange(0, 5);
    snapshotEditableSelection(input);
    input.setSelectionRange(5, 5);
    const exec = vi.spyOn(document, "execCommand").mockReturnValue(true);

    runEditableAction(input, "copy");

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
    expect(exec).toHaveBeenCalledWith("copy");

    exec.mockRestore();
    input.remove();
  });
});
