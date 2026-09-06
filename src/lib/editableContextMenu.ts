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

type TextSelectionRange = { start: number; end: number };

/** Right-click can collapse the live selection before `contextmenu` (WebKitGTK). */
const inputSelections = new WeakMap<HTMLElement, TextSelectionRange>();
const contentSelections = new WeakMap<HTMLElement, Range>();

/** Remember the current selection on right-button down, before the engine clears it. */
export function snapshotEditableSelection(el: HTMLElement): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start !== end) inputSelections.set(el, { start, end });
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const anchor = sel.anchorNode;
  if (!anchor || !el.contains(anchor)) return;
  contentSelections.set(el, sel.getRangeAt(0).cloneRange());
}

export function clearEditableSelectionSnapshot(el: HTMLElement): void {
  inputSelections.delete(el);
  contentSelections.delete(el);
}

function getInputSelectionRange(el: HTMLInputElement | HTMLTextAreaElement): TextSelectionRange | null {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (start !== end) return { start, end };
  const snap = inputSelections.get(el);
  return snap && snap.start !== snap.end ? snap : null;
}

function hasTextSelection(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return getInputSelectionRange(el) != null;
  }
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    const anchor = sel.anchorNode;
    if (anchor != null && el.contains(anchor)) return true;
  }
  const range = contentSelections.get(el);
  return range != null && !range.collapsed;
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

function restoreEditableSelection(el: HTMLElement): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const range = getInputSelectionRange(el);
    if (range) el.setSelectionRange(range.start, range.end);
    return;
  }
  const range = contentSelections.get(el);
  if (!range) return;
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range.cloneRange());
}

/** Run a clipboard/selection action on the focused editable element. */
export function runEditableAction(el: HTMLElement, action: EditableAction): void {
  el.focus();
  if (action === "cut" || action === "copy") restoreEditableSelection(el);
  const cmd = action === "selectAll" ? "selectAll" : action;
  document.execCommand(cmd);
  if (action === "cut" || action === "copy" || action === "selectAll") {
    clearEditableSelectionSnapshot(el);
  }
}
