import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PluginListener } from "@tauri-apps/api/core";
import {
  Importance,
  Schedule,
  active,
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
  ARRIVAL_KEY_EXTRA,
  POLL_MS,
  TaskArrival,
  arrivalsDueNow,
  clearOsScheduled,
  loadNotifiedKeys,
  loadOsScheduledKeys,
  markNotified,
  markOsScheduled,
  notificationId,
  ownedNotificationIds,
  pruneNotifiedKeys,
  pruneOsScheduledKeys,
  reconcileOsDelivered,
  scheduleSignature,
  staleOwnedPendingIds,
  upcomingArrivals,
} from "../lib/scheduledNotifications";

type Props = { tasks: Task[]; dayStartHour: number };

const ANDROID_CHANNEL_ID = "scheduled-tasks";

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
  const osScheduledRef = useRef(loadOsScheduledKeys());
  const claimedRef = useRef(new Set<string>());
  const lastScheduleSigRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    let listener: PluginListener | undefined;
    let chain: Promise<void> = Promise.resolve();

    const titleFor = (kind: TaskArrival["kind"]) =>
      kind === "start" ? t("scheduledTaskNotifier.startTitle") : t("scheduledTaskNotifier.dueTitle");

    const markFromNotification = (extra: Record<string, unknown> | undefined) => {
      const key = extra?.[ARRIVAL_KEY_EXTRA];
      if (typeof key !== "string") return;
      notifiedRef.current = markNotified(notifiedRef.current, key);
      osScheduledRef.current = clearOsScheduled(osScheduledRef.current, key);
      claimedRef.current.delete(key);
    };

    const tryClaim = (key: string): boolean => {
      if (
        notifiedRef.current.has(key)
        || claimedRef.current.has(key)
      ) return false;
      claimedRef.current.add(key);
      return true;
    };

    const releaseClaims = (keys: Iterable<string>) => {
      for (const key of keys) claimedRef.current.delete(key);
    };

    const runTick = async (syncOs: boolean) => {
      if (cancelled) return;

      const taskIds = new Set(tasksRef.current.map(task => task.id));
      notifiedRef.current = pruneNotifiedKeys(notifiedRef.current, taskIds);
      osScheduledRef.current = pruneOsScheduledKeys(osScheduledRef.current, taskIds);

      const now = Date.now();
      let pendingIds = new Set<number>();
      try {
        pendingIds = new Set((await pending()).map(n => n.id));
      } catch {
        // Fall back when pending is unavailable.
      }

      try {
        for (const n of await active()) markFromNotification(n.extra);
      } catch {
        // active() may be unavailable on some platforms.
      }

      const reconciled = reconcileOsDelivered(
        tasksRef.current,
        now,
        dayStartRef.current,
        notifiedRef.current,
        osScheduledRef.current,
        pendingIds,
      );
      notifiedRef.current = reconciled.notified;
      osScheduledRef.current = reconciled.osScheduled;

      const dueCandidates = arrivalsDueNow(
        tasksRef.current,
        now,
        dayStartRef.current,
        notifiedRef.current,
        claimedRef.current,
      );
      const claimed: TaskArrival[] = [];
      for (const arrival of dueCandidates) {
        if (tryClaim(arrival.key)) claimed.push(arrival);
      }

      if (claimed.length > 0) {
        const granted = await ensureNotificationPermission();
        if (!granted || cancelled) {
          releaseClaims(claimed.map(a => a.key));
          return;
        }

        const channelId = await ensureAndroidChannel();
        for (const arrival of claimed) {
          if (cancelled) break;
          notifyArrival(arrival, titleFor(arrival.kind), channelId);
          notifiedRef.current = markNotified(notifiedRef.current, arrival.key);
          osScheduledRef.current = clearOsScheduled(osScheduledRef.current, arrival.key);
          claimedRef.current.delete(arrival.key);
          try {
            await cancel([notificationId(arrival.kind, arrival.task.id)]);
          } catch {
            // Ignore — may already have fired or be unsupported.
          }
        }
      }

      if (!syncOs || cancelled) return;

      const granted = await ensureNotificationPermission();
      if (!granted || cancelled) return;

      const upcoming = upcomingArrivals(tasksRef.current, now, dayStartRef.current);
      const sig = scheduleSignature(upcoming);
      if (sig === lastScheduleSigRef.current) return;
      lastScheduleSigRef.current = sig;

      const channelId = await ensureAndroidChannel();
      const ownedIds = ownedNotificationIds(tasksRef.current, dayStartRef.current);
      const desiredFutureIds = new Set(upcoming.map(a => notificationId(a.kind, a.task.id)));

      try {
        pendingIds = new Set((await pending()).map(n => n.id));
        const toCancel = staleOwnedPendingIds(ownedIds, desiredFutureIds, pendingIds);
        if (toCancel.length > 0) await cancel(toCancel);
      } catch {
        // pending/cancel may be unavailable on some platforms.
      }

      for (const arrival of upcoming) {
        if (notifiedRef.current.has(arrival.key)) continue;
        try {
          scheduleArrival(arrival, titleFor(arrival.kind), channelId);
          osScheduledRef.current = markOsScheduled(osScheduledRef.current, arrival.key);
        } catch {
          // Scheduling is best-effort; polling still covers running app.
        }
      }
    };

    const enqueueTick = (syncOs: boolean) => {
      chain = chain
        .then(() => runTick(syncOs))
        .catch(() => {});
    };

    void onNotificationReceived(n => {
      markFromNotification(n.extra);
    }).then(l => {
      if (!cancelled) listener = l;
      else void l.unregister();
    });

    enqueueTick(true);
    const interval = window.setInterval(() => enqueueTick(true), POLL_MS);

    const onResume = () => {
      if (document.visibilityState === "visible") enqueueTick(true);
    };

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
