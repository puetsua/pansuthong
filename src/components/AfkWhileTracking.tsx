import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api, Task } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { AFK_THRESHOLD_MS, afkSinceForStop, pollAfk, setAfkStopHandler } from "../lib/afkWhileTracking";
import { formatDurationShort, isTiming } from "../lib/time";

type Props = { tasks: Task[]; thresholdMs?: number };

type Prompt = {
  afkSinceMs: number;
  durationMs: number;
  stopTaskId: string | null;
};

const TICK_MS = 1_000;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Warn when the user returns from AFK (or hits Stop after a long AFK) while a
 * timer is running. Keep leaves the AFK span in the entry; Discard closes every
 * running interval at AFK start and stops tracking (#170).
 *
 * Separate from Assign idle (untracked time when nothing is running). Portaled
 * above TaskEditor so Stop-from-editor still sees the prompt.
 */
export function AfkWhileTracking({ tasks, thresholdMs = AFK_THRESHOLD_MS }: Props) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const afkSinceRef = useRef<number | null>(null);
  const lastIdleRef = useRef<number | null>(null);
  const idleAvailableRef = useRef<boolean | null>(null);
  const inFlightRef = useRef(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  const showPrompt = (next: Prompt) => {
    promptRef.current = next;
    setErr(null);
    setPrompt(next);
  };

  useEffect(() => {
    const handler = async (taskId: string) => {
      const attachStop = (open: Prompt) => {
        if (open.stopTaskId !== taskId) showPrompt({ ...open, stopTaskId: taskId });
        return true;
      };
      const existing = promptRef.current;
      if (existing) return attachStop(existing);
      const idle = await api.sessionIdleMs().catch(() => null);
      const afterIdle = promptRef.current;
      if (afterIdle) return attachStop(afterIdle);
      const now = Date.now();
      const since = afkSinceForStop(idle, now, thresholdMs, afkSinceRef.current, lastIdleRef.current);
      if (since == null) return false;
      showPrompt({ afkSinceMs: since, durationMs: now - since, stopTaskId: taskId });
      return true;
    };
    setAfkStopHandler(handler);
    return () => setAfkStopHandler(null);
  }, [thresholdMs]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled || promptRef.current || inFlightRef.current) return;
      if (!tasksRef.current.some(isTiming)) {
        afkSinceRef.current = null;
        lastIdleRef.current = null;
        return;
      }
      if (idleAvailableRef.current === false) return;
      inFlightRef.current = true;
      try {
        const idle = await api.sessionIdleMs().catch(() => null);
        if (cancelled || promptRef.current) return;
        if (idle == null) {
          if (idleAvailableRef.current == null) idleAvailableRef.current = false;
          return;
        }
        idleAvailableRef.current = true;
        lastIdleRef.current = idle;
        const now = Date.now();
        const next = pollAfk(idle, now, thresholdMs, tasksRef.current.some(isTiming), afkSinceRef.current);
        afkSinceRef.current = next.afkSinceMs;
        if (next.prompt && next.afkSinceMs != null) {
          showPrompt({ afkSinceMs: next.afkSinceMs, durationMs: now - next.afkSinceMs, stopTaskId: null });
        }
      } finally {
        inFlightRef.current = false;
      }
    };
    void tick();
    const interval = window.setInterval(() => { void tick(); }, TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [thresholdMs]);

  useEffect(() => {
    if (!prompt) return;
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const f = root.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [prompt]);

  if (!prompt) return null;

  const count = tasks.filter(isTiming).length;
  const duration = formatDurationShort(prompt.durationMs);
  const body = count > 1
    ? t("afkTracking.bodyMany", { duration, count })
    : t("afkTracking.body", { duration });

  const close = () => {
    promptRef.current = null;
    setPrompt(null);
    setErr(null);
    setBusy(false);
    afkSinceRef.current = null;
    lastIdleRef.current = null;
  };

  const keep = () => {
    const stopId = prompt.stopTaskId;
    if (!stopId) { close(); return; }
    setBusy(true);
    setErr(null);
    void api.stopTimer(stopId)
      .then(() => { close(); })
      .catch(e => { setErr(errorMessage(e)); setBusy(false); });
  };
  const discard = () => {
    setBusy(true);
    setErr(null);
    void api.discardRunningAfk(prompt.afkSinceMs)
      .then(() => { close(); })
      .catch(e => { setErr(errorMessage(e)); setBusy(false); });
  };

  return createPortal(
    <div className="te-confirm afk-tracking-dialog" role="dialog" aria-modal="true"
         aria-labelledby="afk-tracking-title" aria-describedby="afk-tracking-body" ref={dialogRef}>
      <div className="te-confirm-box">
        <h2 id="afk-tracking-title" className="te-confirm-title">{t("afkTracking.title")}</h2>
        <p id="afk-tracking-body">{body}</p>
        {err && <p className="composer-error" role="alert">{err}</p>}
        <div className="te-confirm-actions">
          <button type="button" onClick={discard} disabled={busy}>{t("afkTracking.discard")}</button>
          <button type="button" ref={keepRef} className="te-save" onClick={keep} disabled={busy}>
            {t("afkTracking.keep")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
