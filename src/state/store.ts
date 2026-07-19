import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, Document } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { isAndroid } from "../lib/platform";
import { activeVariant, applyThemeToRoot } from "../lib/themes";
import { buildIndexes, Indexes } from "./indexes";

type DocState = {
  doc: Document | null;
  indexes: Indexes | null;
  /** Fatal: the first load failed, so there is nothing to render. */
  error: string | null;
  /** Non-fatal: a background refresh failed; the last-good doc is still shown. */
  reloadError: string | null;
  dismissReloadError: () => void;
};

export function useDocument(): DocState {
  const [doc, setDoc] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  // Whether a good doc has ever loaded. A later reload failure then degrades to
  // a dismissible banner instead of wiping the mounted UI to the error screen.
  const hasDoc = useRef(false);

  useEffect(() => {
    let mounted = true;

    const applyDoc = (d: Document) => {
      hasDoc.current = true;
      // Keep the current UI interactive while indexes rebuild — completing a
      // task or flipping a setting used to feel like a hitch on Android.
      startTransition(() => {
        setDoc(d);
        setError(null);
        setReloadError(null);
      });
    };

    const load = async () => {
      try {
        const d = await api.getDocument();
        if (!mounted) return;
        applyDoc(d);
      } catch (e) {
        if (!mounted) return;
        const msg = errorMessage(e);
        if (hasDoc.current) setReloadError(msg); // keep last-good doc on screen
        else setError(msg);                      // nothing loaded yet: fatal
      }
    };

    // store-changed = synced document mutated; settings-changed = device-local
    // config only. Both need a UI reload; only store-changed schedules SAF push.
    const unlistenStore = listen("store-changed", () => { void load(); });
    const unlistenSettings = listen("settings-changed", () => { void load(); });
    void load();

    return () => {
      mounted = false;
      void unlistenStore.then(fn => fn());
      void unlistenSettings.then(fn => fn());
    };
  }, []);

  // Theme (#15): `data-theme` drives the CSS color-scheme + base palette, while
  // custom presets/overrides are applied as inline `--c-*` vars on <html>. The
  // active variant follows the OS for `auto`, so re-resolve on a light/dark flip.
  useEffect(() => {
    const root = document.documentElement;
    const settings = doc?.settings;
    const theme = settings?.theme ?? "auto";
    if (theme === "auto") root.removeAttribute("data-theme");
    else                  root.setAttribute("data-theme", theme);

    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const variant = activeVariant(theme, mq?.matches ?? false);
      applyThemeToRoot(root, settings ?? { theme: "auto", sort_order: "priority" }, variant);
    };
    apply();

    if (theme === "auto" && mq) {
      const onChange = () => apply();
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
  }, [doc?.settings]);

  // Android folder-sync triggers: pull on launch + when returning to the
  // foreground, and a debounced push after each local *document* change.
  // Settings emit settings-changed (not store-changed), so they never push —
  // device-local config is not in the synced replica. All `saf*` calls are
  // inert stubs on desktop (#Phase 4B).
  useEffect(() => {
    let active = true;
    let pushTimer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;

    const onChange = () => {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => { void api.safPush().catch(() => {}); }, 1000);
    };
    const onVisible = () => { if (!document.hidden) void api.safSyncNow().catch(() => {}); };

    void isAndroid().then((android) => {
      if (!android || !active) return;
      void api.safSyncNow().catch(() => {}); // pull-then-push on launch
      document.addEventListener("visibilitychange", onVisible);
      void listen("store-changed", onChange).then((un) => { if (active) unlisten = un; else un(); });
    });

    return () => {
      active = false;
      clearTimeout(pushTimer);
      document.removeEventListener("visibilitychange", onVisible);
      unlisten?.();
    };
  }, []);

  const indexes = useMemo(() => (doc ? buildIndexes(doc) : null), [doc]);
  return {
    doc,
    indexes,
    error,
    reloadError,
    dismissReloadError: () => setReloadError(null),
  };
}
