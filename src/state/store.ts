import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, Document } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { isAndroid } from "../lib/platform";
import { activeVariant, applyThemeToRoot } from "../lib/themes";
import { DAY_START_HOUR_DEFAULT, dayStartHour } from "../lib/settings";
import { useLogicalDay } from "../lib/useLogicalDay";
import { buildIndexes, Indexes } from "./indexes";

/** True when the error message indicates the data folder isn't available yet
 *  (e.g. Google Drive not mounted at boot). */
function isDataFolderPending(msg: string): boolean {
  return msg.includes("data folder not available yet");
}

type DocState = {
  doc: Document | null;
  indexes: Indexes | null;
  /** Fatal: the first load failed, so there is nothing to render. */
  error: string | null;
  /** Non-fatal: a background refresh failed; the last-good doc is still shown. */
  reloadError: string | null;
  dismissReloadError: () => void;
  /** True when the data folder isn't available yet (e.g. Google Drive not mounted
   *  at boot) and we're retrying in the background. */
  waitingForData: boolean;
  /** How many times we've retried opening the data folder. */
  retryCount: number;
  /** Seconds until the next retry attempt (countdown for the UI). */
  nextRetryIn: number;
  /** True from the 4th attempt onward, when fallback buttons are offered. */
  showFallback: boolean;
  /** True after all 10 attempts have failed. */
  gaveUp: boolean;
  /** Abandon waiting, clear the folder config, and open at the default location. */
  createNewData: () => Promise<void>;
};

export function useDocument(): DocState {
  const [doc, setDoc] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  // Whether a good doc has ever loaded. A later reload failure then degrades to
  // a dismissible banner instead of wiping the mounted UI to the error screen.
  const hasDoc = useRef(false);
  // Retry state for when the data folder isn't available yet (e.g. Google Drive
  // not mounted at boot).
  const retryCountRef = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [waitingForData, setWaitingForData] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [nextRetryIn, setNextRetryIn] = useState(0);
  const [showFallback, setShowFallback] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  /// First getDocument plus later tryOpenData retries.
  const MAX_ATTEMPTS = 10;
  /// Offer Close / Use default location from this attempt onward.
  const SHOW_FALLBACK_FROM = 4;

  useEffect(() => {
    let mounted = true;

    const applyDoc = (d: Document) => {
      hasDoc.current = true;
      retryCountRef.current = 0;
      setWaitingForData(false);
      setShowFallback(false);
      setGaveUp(false);
      setRetryCount(0);
      setNextRetryIn(0);
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
        if (hasDoc.current) {
          setReloadError(msg); // keep last-good doc on screen
        } else if (isDataFolderPending(msg)) {
          // Data folder not available yet (e.g. Google Drive not mounted).
          // Show a loading screen and retry with backoff.
          retryCountRef.current = 1;
          setRetryCount(1);
          setWaitingForData(true);
          if (1 >= SHOW_FALLBACK_FROM) setShowFallback(true);
          if (1 >= MAX_ATTEMPTS) {
            setGaveUp(true);
            return;
          }
          scheduleRetry();
        } else {
          setError(msg); // nothing loaded yet: fatal
        }
      }
    };

    /** Retry opening the data store with exponential backoff. */
    const scheduleRetry = () => {
      if (!mounted) return;
      const completed = retryCountRef.current;
      if (completed >= MAX_ATTEMPTS) return;

      // Cap backoff: 1s, 2s, 4s, 8s after the 1st..4th completed attempt.
      const delay = Math.min(1000 * Math.pow(2, completed - 1), 30_000);
      const delaySec = Math.ceil(delay / 1000);
      setNextRetryIn(delaySec);

      // Countdown timer for the UI.
      if (countdownTimer.current != null) clearInterval(countdownTimer.current);
      countdownTimer.current = setInterval(() => {
        if (!mounted) return;
        setNextRetryIn(prev => Math.max(0, prev - 1));
      }, 1000);

      retryTimer.current = setTimeout(async () => {
        if (!mounted) return;
        if (countdownTimer.current != null) clearInterval(countdownTimer.current);
        retryCountRef.current = completed + 1;
        setRetryCount(completed + 1);
        try {
          const ok = await api.tryOpenData();
          if (!mounted) return;
          if (ok) {
            // The real store opened — reload the document.
            void load();
          } else {
            if (completed + 1 >= SHOW_FALLBACK_FROM) setShowFallback(true);
            if (completed + 1 >= MAX_ATTEMPTS) setGaveUp(true);
            else scheduleRetry();
          }
        } catch {
          if (!mounted) return;
          if (completed + 1 >= SHOW_FALLBACK_FROM) setShowFallback(true);
          if (completed + 1 >= MAX_ATTEMPTS) setGaveUp(true);
          else scheduleRetry();
        }
      }, delay);
    };

    // store-changed = synced document mutated; settings-changed = device-local
    // config only. Both need a UI reload; only store-changed schedules SAF push.
    const unlistenStore = listen("store-changed", () => { void load(); });
    const unlistenSettings = listen("settings-changed", () => { void load(); });
    void load();

    return () => {
      mounted = false;
      if (retryTimer.current != null) clearTimeout(retryTimer.current);
      if (countdownTimer.current != null) clearInterval(countdownTimer.current);
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

  // The logical day is a live input, not a snapshot taken when the document last
  // loaded: an app left open across the day-start hour must roll Today over on its
  // own (#148). Tracking it here rather than per-view keeps one "today" for the whole
  // app, so every consumer of `indexes.todayIso` advances together.
  const dsh = doc ? dayStartHour(doc.settings) : DAY_START_HOUR_DEFAULT;
  const currentDay = useLogicalDay(dsh);
  const indexes = useMemo(
    () => (doc ? buildIndexes(doc, currentDay) : null),
    [doc, currentDay],
  );
  return {
    doc,
    indexes,
    error,
    reloadError,
    dismissReloadError: () => setReloadError(null),
    waitingForData,
    retryCount,
    nextRetryIn,
    showFallback,
    gaveUp,
    createNewData: async () => {
      try {
        await api.openDefaultStore();
        // store-changed event will trigger load()
      } catch {
        // If it fails, stay on the give-up screen.
      }
    },
  };
}
