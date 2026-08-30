import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, Task } from "../lib/tauri";
import { AFK_THRESHOLD_MS, afkSinceForStop, pollAfk, setAfkStopHandler } from "../lib/afkWhileTracking";
import { formatDurationShort, isTiming } from "../lib/time";

type Props = { tasks: Task[]; thresholdMs?: number };

type Prompt = {
  afkSinceMs: number;
  durationMs: number;
  stopTaskId: string | null;
};

const TICK_MS = 1_000;

/**
 * Warn when the user returns from AFK (or hits Stop after a long AFK) while a
 * timer is running. Keep leaves the AFK span in the entry; Discard closes every
 * running interval at AFK start and stops tracking (#170).
 *
 * Separate from Assign idle (untracked time when nothing is running).
 */
export function AfkWhileTracking({ tasks, thresholdMs = AFK_THRESHOLD_MS }: Props) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const afkSinceRef = useRef<number | null>(null);
  const lastIdleRef = useRef<number | null>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = async (taskId: string) => {
      if (promptRef.current) return true;
      const idle = await api.sessionIdleMs().catch(() => null);
      const now = Date.now();
      const since = afkSinceForStop(idle, now, thresholdMs, afkSinceRef.current, lastIdleRef.current);
      if (since == null) return false;
      setPrompt({ afkSinceMs: since, durationMs: now - since, stopTaskId: taskId });
      return true;
    };
    setAfkStopHandler(handler);
    return () => setAfkStopHandler(null);
  }, [thresholdMs]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled || promptRef.current) return;
      if (!tasksRef.current.some(isTiming)) {
        afkSinceRef.current = null;
        lastIdleRef.current = null;
        return;
      }
      const idle = await api.sessionIdleMs().catch(() => null);
      if (cancelled) return;
      if (idle != null) lastIdleRef.current = idle;
      const now = Date.now();
      const next = pollAfk(idle, now, thresholdMs, tasksRef.current.some(isTiming), afkSinceRef.current);
      afkSinceRef.current = next.afkSinceMs;
      if (next.prompt && next.afkSinceMs != null) {
        setPrompt({ afkSinceMs: next.afkSinceMs, durationMs: now - next.afkSinceMs, stopTaskId: null });
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
    if (prompt) keepRef.current?.focus();
  }, [prompt]);

  if (!prompt) return null;

  const count = tasks.filter(isTiming).length;
  const duration = formatDurationShort(prompt.durationMs);
  const body = count > 1
    ? t("afkTracking.bodyMany", { duration, count })
    : t("afkTracking.body", { duration });

  const keep = () => {
    const stopId = prompt.stopTaskId;
    setPrompt(null);
    afkSinceRef.current = null;
    lastIdleRef.current = null;
    if (stopId) void api.stopTimer(stopId).catch(() => {});
  };
  const discard = () => {
    const since = prompt.afkSinceMs;
    setPrompt(null);
    afkSinceRef.current = null;
    lastIdleRef.current = null;
    void api.discardRunningAfk(since).catch(() => {});
  };

  return (
    <div className="te-confirm" role="dialog" aria-modal="true" aria-labelledby="afk-tracking-title">
      <div className="te-confirm-box">
        <h2 id="afk-tracking-title" className="te-confirm-title">{t("afkTracking.title")}</h2>
        <p>{body}</p>
        <div className="te-confirm-actions">
          <button type="button" onClick={discard}>{t("afkTracking.discard")}</button>
          <button type="button" ref={keepRef} className="te-save" onClick={keep}>{t("afkTracking.keep")}</button>
        </div>
      </div>
    </div>
  );
}
