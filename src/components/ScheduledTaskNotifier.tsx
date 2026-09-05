import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Schedule,
  cancel,
  isPermissionGranted,
  pending,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { Task } from "../lib/tauri";
import {
  POLL_MS,
  TaskArrival,
  arrivalsDueNow,
  loadNotifiedKeys,
  markNotified,
  notificationId,
  pruneNotifiedKeys,
  upcomingArrivals,
} from "../lib/scheduledNotifications";

type Props = { tasks: Task[]; dayStartHour: number };

async function ensureNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

function notifyArrival(arrival: TaskArrival, title: string): void {
  sendNotification({ title, body: arrival.task.title });
}

function scheduleArrival(arrival: TaskArrival, title: string): void {
  sendNotification({
    id: notificationId(arrival.kind, arrival.task.id),
    title,
    body: arrival.task.title,
    schedule: Schedule.at(arrival.at, false, true),
  });
}

export function ScheduledTaskNotifier({ tasks, dayStartHour }: Props) {
  const { t } = useTranslation();
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const dayStartRef = useRef(dayStartHour);
  dayStartRef.current = dayStartHour;
  const notifiedRef = useRef(loadNotifiedKeys());

  useEffect(() => {
    let cancelled = false;

    const titleFor = (kind: TaskArrival["kind"]) =>
      kind === "start" ? t("scheduledTaskNotifier.startTitle") : t("scheduledTaskNotifier.dueTitle");

    const syncOsSchedule = async () => {
      const granted = await ensureNotificationPermission();
      if (!granted || cancelled) return;

      const now = Date.now();
      const upcoming = upcomingArrivals(tasksRef.current, now, dayStartRef.current);
      const desiredIds = new Set(upcoming.map(a => notificationId(a.kind, a.task.id)));

      try {
        const existing = await pending();
        const toCancel = existing
          .map(n => n.id)
          .filter(id => !desiredIds.has(id));
        if (toCancel.length > 0) await cancel(toCancel);
      } catch {
        // pending/cancel may be unavailable on some platforms.
      }

      for (const arrival of upcoming) {
        if (notifiedRef.current.has(arrival.key)) continue;
        try {
          scheduleArrival(arrival, titleFor(arrival.kind));
        } catch {
          // Scheduling is best-effort; polling still covers running app.
        }
      }
    };

    const checkDue = async () => {
      const taskIds = new Set(tasksRef.current.map(task => task.id));
      notifiedRef.current = pruneNotifiedKeys(notifiedRef.current, taskIds);

      const now = Date.now();
      const due = arrivalsDueNow(tasksRef.current, now, dayStartRef.current, notifiedRef.current);
      if (due.length === 0) return;

      const granted = await ensureNotificationPermission();
      if (!granted || cancelled) return;

      for (const arrival of due) {
        notifyArrival(arrival, titleFor(arrival.kind));
        notifiedRef.current = markNotified(notifiedRef.current, arrival.key);
        try {
          await cancel([notificationId(arrival.kind, arrival.task.id)]);
        } catch {
          // Ignore — may already have fired or be unsupported.
        }
      }
    };

    const tick = () => {
      void checkDue();
      void syncOsSchedule();
    };

    const onResume = () => {
      if (document.visibilityState === "visible") void checkDue();
    };

    tick();
    const interval = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
    };
  }, [t]);

  return null;
}
