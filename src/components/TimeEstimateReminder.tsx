import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { Task } from "../lib/tauri";
import { elapsedMs, formatDurationShort, isTiming } from "../lib/time";

type Props = { tasks: Task[] };

const REMINDER_MS = 10 * 60_000;
const TICK_MS = 1_000;

async function ensureNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

export function TimeEstimateReminder({ tasks }: Props) {
  const { t } = useTranslation();
  const lastNotified = useRef(new Map<string, number>());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const activeIds = new Set<string>();

      for (const task of tasksRef.current) {
        const estimate = task.estimated_seconds;
        if (!estimate || !isTiming(task)) continue;

        activeIds.add(task.id);
        const estimateMs = estimate * 1_000;
        const trackedMs = elapsedMs(task, now);
        if (trackedMs < estimateMs) {
          lastNotified.current.delete(task.id);
          continue;
        }

        const last = lastNotified.current.get(task.id);
        if (last != null && now - last < REMINDER_MS) continue;
        lastNotified.current.set(task.id, now);
        const tracked = formatDurationShort(trackedMs);
        const estimateText = formatDurationShort(estimateMs);
        void ensureNotificationPermission()
          .then(granted => {
            if (!granted) return;
            sendNotification({
              title: t("timeEstimateReminder.title"),
              body: t("timeEstimateReminder.body", {
                title: task.title,
                tracked,
                estimate: estimateText,
              }),
            });
          })
          .catch(() => {});
      }

      for (const id of lastNotified.current.keys()) {
        if (!activeIds.has(id)) lastNotified.current.delete(id);
      }
    };

    tick();
    const interval = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(interval);
  }, [t]);

  return null;
}
