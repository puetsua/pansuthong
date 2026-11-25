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
    // while focus is in it.
    const active = document.activeElement;
    if (!box.current || (active && active !== document.body && !box.current.contains(active))) return;
    if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
    else if (e.key === "Tab") { e.stopPropagation(); trapTab(e, box.current); }
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}
