import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { Task } from "../lib/tauri";
import { TimeEstimateReminder } from "./TimeEstimateReminder";

const notification = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => notification);

const base: Task = {
  id: "k_1",
  title: "Write report",
  notes: "",
  tag_ids: [],
  created_at: "2026-06-08T10:00:00+08:00",
  estimated_seconds: 5,
};

const running = (start: string): Task => ({
  ...base,
  time_entries: [{ id: "te_1", start }],
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("TimeEstimateReminder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-08T10:05:00+08:00"));
    notification.isPermissionGranted.mockResolvedValue(true);
    notification.requestPermission.mockResolvedValue("granted");
    notification.sendNotification.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("sends when tracked time reaches the estimate", async () => {
    render(<TimeEstimateReminder tasks={[running("2026-06-08T10:00:00+08:00")]} />);

    await flush();

    expect(notification.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Task estimate reached",
      body: expect.stringContaining("Write report"),
    }));
  });

  it("repeats every ten minutes while the timer keeps running", async () => {
    render(<TimeEstimateReminder tasks={[running("2026-06-08T10:00:00+08:00")]} />);
    await flush();
    expect(notification.sendNotification).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(9 * 60_000 + 59_000);
    await flush();
    expect(notification.sendNotification).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    await flush();
    expect(notification.sendNotification).toHaveBeenCalledTimes(2);
  });

  it("stops repeating after the timer is stopped", async () => {
    const { rerender } = render(<TimeEstimateReminder tasks={[running("2026-06-08T10:00:00+08:00")]} />);
    await flush();
    expect(notification.sendNotification).toHaveBeenCalledTimes(1);

    rerender(
      <TimeEstimateReminder tasks={[{
        ...base,
        time_entries: [{
          id: "te_1",
          start: "2026-06-08T10:00:00+08:00",
          end: "2026-06-08T10:06:00+08:00",
        }],
      }]} />,
    );
    vi.advanceTimersByTime(10 * 60_000);
    await flush();

    expect(notification.sendNotification).toHaveBeenCalledTimes(1);
  });
});
