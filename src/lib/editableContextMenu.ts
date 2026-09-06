/** Returns the nearest editable element for a context-menu target, if any. */
export function findEditableTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="hidden"]), textarea, [contenteditable]:not([contenteditable="false"])');
  if (!(el instanceof HTMLElement)) return null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.disabled) return null;
  }
  return el;
}

export type EditableActionStates = {
  cut: boolean;
  copy: boolean;
  paste: boolean;
  selectAll: boolean;
};

function hasTextSelection(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    return start !== end;
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return false;
  const anchor = sel.anchorNode;
  return anchor != null && el.contains(anchor);
}

function isReadOnly(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.readOnly;
  return el.getAttribute("contenteditable") === "false";
}

function hasSelectableText(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.length > 0;
  return (el.textContent?.length ?? 0) > 0;
}

/** Which clipboard/selection actions apply to the given editable element right now. */
export function getEditableActionStates(el: HTMLElement): EditableActionStates {
  const readOnly = isReadOnly(el);
  const hasSelection = hasTextSelection(el);
  return {
    cut: hasSelection && !readOnly,
    copy: hasSelection,
    paste: !readOnly,
    selectAll: hasSelectableText(el),
  };
}

export type EditableAction = "cut" | "copy" | "paste" | "selectAll";

/** Run a clipboard/selection action on the focused editable element. */
export function runEditableAction(el: HTMLElement, action: EditableAction): void {
  el.focus();
  const cmd = action === "selectAll" ? "selectAll" : action;
  document.execCommand(cmd);
}
