import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, Document } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { isAndroid } from "../lib/platform";
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

    const load = async () => {
      try {
        const d = await api.getDocument();
        if (!mounted) return;
        hasDoc.current = true;
        setDoc(d);
        setError(null);
        setReloadError(null);
      } catch (e) {
        if (!mounted) return;
        const msg = errorMessage(e);
        if (hasDoc.current) setReloadError(msg); // keep last-good doc on screen
        else setError(msg);                      // nothing loaded yet: fatal
      }
    };

    const unlistenPromise = listen("store-changed", () => { void load(); });
    void load();

    return () => {
      mounted = false;
      void unlistenPromise.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    const theme = doc?.settings.theme ?? "auto";
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else                  document.documentElement.setAttribute("data-theme", theme);
  }, [doc?.settings.theme]);

  // Android folder-sync triggers: pull on launch + when returning to the
  // foreground, and a debounced push after each local change. store-changed
  // already drives the reload, so these only move bytes to/from the SAF folder.
  // All `saf*` calls are inert stubs on desktop (#Phase 4B).
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
      void api.safSyncNow().catch(() => {}); // pull on launch
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
