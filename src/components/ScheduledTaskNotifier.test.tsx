import { render, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ScheduledTaskNotifier } from "./ScheduledTaskNotifier";
import { Task } from "../lib/tauri";

const notification = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  pending: vi.fn(),
  cancel: vi.fn(),
  Schedule: {
    at: vi.fn((date: Date) => ({ at: { date, repeating: false, allowWhileIdle: true } })),
  },
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  ...notification,
  Schedule: notification.Schedule,
}));

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
    notification.isPermissionGranted.mockResolvedValue(true);
    notification.requestPermission.mockResolvedValue("granted");
    notification.sendNotification.mockClear();
    notification.pending.mockResolvedValue([]);
    notification.cancel.mockResolvedValue(undefined);
    notification.Schedule.at.mockClear();
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
});
