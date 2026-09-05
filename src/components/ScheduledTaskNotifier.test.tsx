import { render, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ScheduledTaskNotifier } from "./ScheduledTaskNotifier";
import { Task } from "../lib/tauri";
import {
  notificationIdForKey,
  registerOsNotification,
} from "../lib/scheduledNotifications";

const notification = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  pending: vi.fn(),
  active: vi.fn(),
  cancel: vi.fn(),
  onNotificationReceived: vi.fn(),
  channels: vi.fn(),
  createChannel: vi.fn(),
  Importance: { Default: 3 },
  Schedule: {
    at: vi.fn((date: Date) => ({ at: { date, repeating: false, allowWhileIdle: true } })),
  },
}));

const platform = vi.hoisted(() => ({
  isAndroid: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  ...notification,
  Schedule: notification.Schedule,
  Importance: notification.Importance,
}));

vi.mock("../lib/platform", () => platform);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "k_test",
    title: "Write report",
    notes: "",
    tag_ids: [],
    created_at: "2026-01-01T00:00:00+00:00",
    ...overrides,
  };
}

describe("ScheduledTaskNotifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 8, 9, 5, 0, 0));
    localStorage.clear();
    platform.isAndroid.mockResolvedValue(false);
    notification.isPermissionGranted.mockResolvedValue(true);
    notification.requestPermission.mockResolvedValue("granted");
    notification.sendNotification.mockClear();
    notification.pending.mockResolvedValue([]);
    notification.active.mockResolvedValue([]);
    notification.cancel.mockResolvedValue(undefined);
    notification.onNotificationReceived.mockResolvedValue({ unregister: vi.fn() });
    notification.channels.mockResolvedValue([]);
    notification.createChannel.mockResolvedValue(undefined);
    notification.Schedule.at.mockClear();
    notification.cancel.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("notifies when a start arrival is due", async () => {
    render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(notification.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "scheduledTaskNotifier.startTitle",
      body: "Write report",
    }));
  });

  it("does not notify twice for the same arrival", async () => {
    render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(notification.sendNotification).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    const immediate = notification.sendNotification.mock.calls.filter(
      ([arg]) => typeof arg === "object" && arg != null && !("schedule" in arg),
    );
    expect(immediate).toHaveLength(1);
  });

  it("serializes concurrent checkDue calls", async () => {
    let permissionWaits = 0;
    notification.isPermissionGranted.mockImplementation(async () => {
      permissionWaits++;
      await Promise.resolve();
      return true;
    });

    const { container } = render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => { await Promise.resolve(); });

    const immediate = notification.sendNotification.mock.calls.filter(
      ([arg]) => typeof arg === "object" && arg != null && !("schedule" in arg),
    );
    expect(immediate).toHaveLength(1);
    expect(container).toBeTruthy();
    expect(permissionWaits).toBeGreaterThan(0);
  });

  it("schedules upcoming OS notifications", async () => {
    vi.setSystemTime(new Date(2026, 5, 8, 8, 0, 0, 0));
    render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(notification.Schedule.at).toHaveBeenCalled();
    expect(notification.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      schedule: expect.anything(),
    }));
  });

  it("does not re-schedule when the upcoming set is unchanged", async () => {
    vi.setSystemTime(new Date(2026, 5, 8, 8, 0, 0, 0));
    render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    const scheduleCalls = notification.sendNotification.mock.calls.filter(
      ([arg]) => typeof arg === "object" && arg != null && "schedule" in arg,
    ).length;

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    const scheduleCallsAfter = notification.sendNotification.mock.calls.filter(
      ([arg]) => typeof arg === "object" && arg != null && "schedule" in arg,
    ).length;
    expect(scheduleCallsAfter).toBe(scheduleCalls);
  });

  it("creates the Android channel before scheduling", async () => {
    platform.isAndroid.mockResolvedValue(true);
    vi.setSystemTime(new Date(2026, 5, 8, 8, 0, 0, 0));
    render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(notification.createChannel).toHaveBeenCalledWith(expect.objectContaining({
      id: "scheduled-tasks",
    }));
  });

  it("notifies even when a past-due pending id still exists", async () => {
    const arrivalKey = "start:k_test:2026-06-08:09:00";
    const id = notificationIdForKey(arrivalKey);
    notification.pending.mockResolvedValue([{ id, schedule: {} }]);
    render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    const immediate = notification.sendNotification.mock.calls.filter(
      ([arg]) => typeof arg === "object" && arg != null && !("schedule" in arg),
    );
    expect(immediate).toHaveLength(1);
    expect(notification.cancel).toHaveBeenCalledWith([id]);
  });

  it("immediate-notifies on desktop when OS delivered without active evidence", async () => {
    const arrivalKey = "start:k_test:2026-06-08:09:00";
    registerOsNotification(new Map(), arrivalKey, notificationIdForKey(arrivalKey));
    notification.pending.mockResolvedValue([]);
    notification.active.mockResolvedValue([]);

    render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });

    const immediate = notification.sendNotification.mock.calls.filter(
      ([arg]) => typeof arg === "object" && arg != null && !("schedule" in arg),
    );
    expect(immediate).toHaveLength(1);
  });

  it("does not immediate-notify on Android when OS already delivered in background", async () => {
    platform.isAndroid.mockResolvedValue(true);
    const arrivalKey = "start:k_test:2026-06-08:09:00";
    registerOsNotification(new Map(), arrivalKey, notificationIdForKey(arrivalKey));
    notification.pending.mockResolvedValue([]);
    notification.active.mockResolvedValue([]);

    render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });

    const immediate = notification.sendNotification.mock.calls.filter(
      ([arg]) => typeof arg === "object" && arg != null && !("schedule" in arg),
    );
    expect(immediate).toHaveLength(0);
  });

  it("suppresses duplicate notify when active evidence exists", async () => {
    const arrivalKey = "start:k_test:2026-06-08:09:00";
    registerOsNotification(new Map(), arrivalKey, notificationIdForKey(arrivalKey));
    notification.pending.mockResolvedValue([]);
    notification.active.mockResolvedValue([{ extra: { arrivalKey } }]);

    render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });

    const immediate = notification.sendNotification.mock.calls.filter(
      ([arg]) => typeof arg === "object" && arg != null && !("schedule" in arg),
    );
    expect(immediate).toHaveLength(0);
  });

  it("cancels orphan pending ids when a task is completed", async () => {
    const arrivalKey = "start:k_test:2026-06-09:09:00";
    const id = notificationIdForKey(arrivalKey);
    registerOsNotification(new Map(), arrivalKey, id);
    notification.pending.mockResolvedValue([{ id, schedule: {} }]);

    vi.setSystemTime(new Date(2026, 5, 8, 8, 0, 0, 0));
    const { rerender } = render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-09", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });

    rerender(
      <ScheduledTaskNotifier
        tasks={[task({
          start_date: "2026-06-09",
          start_time: "09:00",
          completed_at: "2026-06-08T08:00:00+00:00",
        })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });

    expect(notification.cancel).toHaveBeenCalledWith([id]);
  });

  it("cancels orphan pending ids when a task is deleted", async () => {
    const arrivalKey = "start:k_test:2026-06-09:09:00";
    const id = notificationIdForKey(arrivalKey);
    registerOsNotification(new Map(), arrivalKey, id);
    notification.pending.mockResolvedValue([{ id, schedule: {} }]);

    vi.setSystemTime(new Date(2026, 5, 8, 8, 0, 0, 0));
    const { rerender } = render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-09", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });

    rerender(<ScheduledTaskNotifier tasks={[]} dayStartHour={0} />);
    await act(async () => { await Promise.resolve(); });

    expect(notification.cancel).toHaveBeenCalledWith([id]);
  });

  it("cancels orphan pending ids when start becomes due-only", async () => {
    const startKey = "start:k_test:2026-06-09:09:00";
    const startId = notificationIdForKey(startKey);
    registerOsNotification(new Map(), startKey, startId);
    notification.pending.mockResolvedValue([{ id: startId, schedule: {} }]);

    vi.setSystemTime(new Date(2026, 5, 8, 8, 0, 0, 0));
    const { rerender } = render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-09", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });

    rerender(
      <ScheduledTaskNotifier
        tasks={[task({ due_date: "2026-06-09", due_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });

    expect(notification.cancel).toHaveBeenCalledWith([startId]);
  });

  it("skips completed tasks", async () => {
    render(
      <ScheduledTaskNotifier
        tasks={[task({
          start_date: "2026-06-08",
          start_time: "09:00",
          completed_at: "2026-06-08T08:00:00+00:00",
        })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(notification.sendNotification).not.toHaveBeenCalled();
  });

  it("marks notified when a scheduled notification is received", async () => {
    let receivedCb: ((n: { extra?: Record<string, unknown> }) => void) | undefined;
    notification.onNotificationReceived.mockImplementation(async (cb) => {
      receivedCb = cb;
      return { unregister: vi.fn() };
    });

    vi.setSystemTime(new Date(2026, 5, 8, 8, 55, 0, 0));
    render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });

    const immediateBefore = notification.sendNotification.mock.calls.filter(
      ([arg]) => typeof arg === "object" && arg != null && !("schedule" in arg),
    );
    expect(immediateBefore).toHaveLength(0);

    vi.setSystemTime(new Date(2026, 5, 8, 9, 0, 0, 0));
    receivedCb?.({ extra: { arrivalKey: "start:k_test:2026-06-08:09:00" } });

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    const immediateAfter = notification.sendNotification.mock.calls.filter(
      ([arg]) => typeof arg === "object" && arg != null && !("schedule" in arg),
    );
    expect(immediateAfter).toHaveLength(0);
  });

  it("re-runs OS sync on resume", async () => {
    vi.setSystemTime(new Date(2026, 5, 8, 8, 0, 0, 0));
    const { rerender } = render(
      <ScheduledTaskNotifier
        tasks={[task({ start_date: "2026-06-08", start_time: "09:00" })]}
        dayStartHour={0}
      />,
    );
    await act(async () => { await Promise.resolve(); });

    rerender(
      <ScheduledTaskNotifier
        tasks={[task({ id: "k_other", start_date: "2026-06-08", start_time: "10:00", title: "Other" })]}
        dayStartHour={0}
      />,
    );
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => { await Promise.resolve(); });

    expect(notification.sendNotification.mock.calls.some(
      ([arg]) => typeof arg === "object" && arg != null && "schedule" in arg && arg.body === "Other",
    )).toBe(true);
  });
});
