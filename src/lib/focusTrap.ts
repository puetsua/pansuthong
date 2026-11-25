const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab / Shift+Tab inside `root`: wrap at either end, and pull focus back
 * in when it sits on the root itself or outside it. Hidden elements (e.g.
 * inactive tab panels) are skipped.
 */
export function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  // tabIndex -1 (e.g. inactive roving tabs) is never a Tab stop, so it can't be an end.
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter(el => el.tabIndex >= 0 && el.getClientRects().length > 0);
  if (items.length === 0) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  const active = document.activeElement;
  const away = active === root || !root.contains(active);
  if (e.shiftKey && (active === first || away)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (active === last || away)) { e.preventDefault(); first.focus(); }
}

/**
 * Escape cancels and Tab stays inside the box. Capture phase + stopPropagation
 * so the dialog underneath (editor, Settings panel) never sees these keys.
 * Returns the cleanup.
 */
export function listenDialogKeys(box: { current: HTMLElement | null }, onCancel: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    // A dialog stacked above this one (e.g. the AFK prompt) owns the keys
    // while focus is in it. Focus on <body> or on an ancestor (clicking the
    // prompt's text focuses the host editor/panel) still counts as ours.
    const box_ = box.current;
    const active = document.activeElement;
    if (!box_ || (active && !box_.contains(active) && !active.contains(box_))) return;
    if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
    else if (e.key === "Tab") { e.stopPropagation(); trapTab(e, box_); }
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}

/**
 * Mount-time setup for a small in-app prompt: focus its default button, own
 * Escape/Tab (see listenDialogKeys), and on close put focus back where it was
 * (as the native window.confirm did). Returns the cleanup.
 */
export function holdDialogFocus(
  box: { current: HTMLElement | null },
  initial: { current: HTMLElement | null },
  onCancel: () => void,
): () => void {
  const previous = document.activeElement as HTMLElement | null;
  initial.current?.focus();
  const stop = listenDialogKeys(box, onCancel);
  return () => {
    stop();
    previous?.focus?.();
  };
}
