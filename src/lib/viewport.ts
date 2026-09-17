import { useEffect, useState } from "react";

/** Reactive media-query hook. Returns true when the query matches. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    setMatches(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** Convenience: true if the viewport is narrow (phone / small window). */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 720px)");
}

/**
 * Writes `data-shell="desktop"` on `<html>` when the desktop shell (custom titlebar)
 * is active. Portaled overlays use this to inset below the drag region (#232).
 */
export function useDocumentShellAttribute(): void {
  const isMobile = useIsMobile();
  useEffect(() => {
    const root = document.documentElement;
    if (isMobile) root.removeAttribute("data-shell");
    else root.setAttribute("data-shell", "desktop");
    return () => {
      root.removeAttribute("data-shell");
    };
  }, [isMobile]);
}
