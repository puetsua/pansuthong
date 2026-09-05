import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PluginListener } from "@tauri-apps/api/core";
import {
  Importance,
  Schedule,
  cancel,
  channels,
  createChannel,
  isPermissionGranted,
  onNotificationReceived,
  pending,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { Task } from "../lib/tauri";
import { isAndroid } from "../lib/platform";
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

const ANDROID_CHANNEL_ID = "scheduled-tasks";
const ARRIVAL_KEY_EXTRA = "arrivalKey";

async function ensureNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

let androidChannelReady = false;

async function ensureAndroidChannel(): Promise<string | undefined> {
  if (!await isAndroid()) return undefined;
  if (androidChannelReady) return ANDROID_CHANNEL_ID;
  try {
    const existing = await channels();
    if (!existing.some(c => c.id === ANDROID_CHANNEL_ID)) {
      await createChannel({
        id: ANDROID_CHANNEL_ID,
        name: "Scheduled tasks",
        importance: Importance.Default,
      });
    }
    androidChannelReady = true;
    return ANDROID_CHANNEL_ID;
  } catch {
    return undefined;
  }
}

function notifyArrival(arrival: TaskArrival, title: string, channelId?: string): void {
  sendNotification({
    title,
    body: arrival.task.title,
    channelId,
    extra: { [ARRIVAL_KEY_EXTRA]: arrival.key },
  });
}

function scheduleArrival(arrival: TaskArrival, title: string, channelId?: string): void {
  sendNotification({
    id: notificationId(arrival.kind, arrival.task.id),
    title,
    body: arrival.task.title,
    channelId,
    extra: { [ARRIVAL_KEY_EXTRA]: arrival.key },
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
    let listener: PluginListener | undefined;

    const titleFor = (kind: TaskArrival["kind"]) =>
      kind === "start" ? t("scheduledTaskNotifier.startTitle") : t("scheduledTaskNotifier.dueTitle");

    const markFromNotification = (extra: Record<string, unknown> | undefined) => {
      const key = extra?.[ARRIVAL_KEY_EXTRA];
      if (typeof key === "string") {
        notifiedRef.current = markNotified(notifiedRef.current, key);
      }
    };

    const syncOsSchedule = async () => {
      const granted = await ensureNotificationPermission();
      if (!granted || cancelled) return;

      const channelId = await ensureAndroidChannel();
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
          scheduleArrival(arrival, titleFor(arrival.kind), channelId);
        } catch {
          // Scheduling is best-effort; polling still covers running app.
        }
      }
    };

    const checkDue = async () => {
      const taskIds = new Set(tasksRef.current.map(task => task.id));
      notifiedRef.current = pruneNotifiedKeys(notifiedRef.current, taskIds);

      const now = Date.now();
      let pendingIds = new Set<number>();
      try {
        pendingIds = new Set((await pending()).map(n => n.id));
      } catch {
        // Fall back to immediate-only delivery when pending is unavailable.
      }

      const due = arrivalsDueNow(
        tasksRef.current,
        now,
        dayStartRef.current,
        notifiedRef.current,
        pendingIds,
      );
      if (due.length === 0) return;

      const granted = await ensureNotificationPermission();
      if (!granted || cancelled) return;

      const channelId = await ensureAndroidChannel();
      for (const arrival of due) {
        notifyArrival(arrival, titleFor(arrival.kind), channelId);
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

    void onNotificationReceived(n => {
      markFromNotification(n.extra);
    }).then(l => {
      if (!cancelled) listener = l;
      else void l.unregister();
    });

    tick();
    const interval = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      void listener?.unregister();
    };
  }, [t, tasks, dayStartHour]);

  return null;
}
