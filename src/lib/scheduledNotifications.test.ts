import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Task } from "./tauri";
import {
  arrivalKey,
  arrivalsDueNow,
  isArrivalDue,
  loadNotifiedKeys,
  markNotified,
  notificationId,
  pruneNotifiedKeys,
  saveNotifiedKeys,
  taskArrival,
  taskArrivalKind,
  taskArrivalMoment,
  upcomingArrivals,
} from "./scheduledNotifications";

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

describe("taskArrivalKind", () => {
  it("prefers start over due", () => {
    expect(taskArrivalKind(task({ start_date: "2026-06-08", due_date: "2026-06-09" }))).toBe("start");
  });

  it("uses due when start is absent", () => {
    expect(taskArrivalKind(task({ due_date: "2026-06-09" }))).toBe("due");
  });

  it("skips completed tasks", () => {
    expect(taskArrivalKind(task({ start_date: "2026-06-08", completed_at: "2026-06-08T10:00:00+00:00" }))).toBeNull();
  });

  it("returns null for undated tasks", () => {
    expect(taskArrivalKind(task())).toBeNull();
  });
});

describe("taskArrivalMoment", () => {
  it("uses explicit start time", () => {
    const at = taskArrivalMoment(task({ start_date: "2026-06-08", start_time: "09:30" }), 0);
    expect(at?.getFullYear()).toBe(2026);
    expect(at?.getMonth()).toBe(5);
    expect(at?.getDate()).toBe(8);
    expect(at?.getHours()).toBe(9);
    expect(at?.getMinutes()).toBe(30);
  });

  it("uses day_start_hour for all-day start", () => {
    const at = taskArrivalMoment(task({ start_date: "2026-06-08" }), 4);
    expect(at?.getHours()).toBe(4);
    expect(at?.getMinutes()).toBe(0);
  });

  it("uses due fields when start is absent", () => {
    const at = taskArrivalMoment(task({ due_date: "2026-06-10", due_time: "17:00" }), 0);
    expect(at?.getDate()).toBe(10);
    expect(at?.getHours()).toBe(17);
  });
});

describe("isArrivalDue", () => {
  const at = new Date(2026, 5, 8, 9, 0, 0, 0);

  it("is due at the exact moment", () => {
    expect(isArrivalDue(at, at.getTime())).toBe(true);
  });

  it("is due within grace after arrival", () => {
    expect(isArrivalDue(at, at.getTime() + 30 * 60_000)).toBe(true);
  });

  it("is not due before arrival", () => {
    expect(isArrivalDue(at, at.getTime() - 1)).toBe(false);
  });

  it("is not due after grace expires", () => {
    expect(isArrivalDue(at, at.getTime() + 61 * 60_000)).toBe(false);
  });
});

describe("arrivalsDueNow", () => {
  it("returns due arrivals not yet notified", () => {
    const t = task({ id: "k_a", start_date: "2026-06-08", start_time: "09:00" });
    const now = new Date(2026, 5, 8, 9, 5, 0, 0).getTime();
    const due = arrivalsDueNow([t], now, 0, new Set());
    expect(due).toHaveLength(1);
    expect(due[0].kind).toBe("start");
    expect(due[0].key).toBe(arrivalKey("start", "k_a", due[0].at));
  });

  it("skips already notified keys", () => {
    const t = task({ start_date: "2026-06-08", start_time: "09:00" });
    const arrival = taskArrival(t, 0)!;
    const now = arrival.at.getTime() + 1000;
    expect(arrivalsDueNow([t], now, 0, new Set([arrival.key]))).toHaveLength(0);
  });
});

describe("upcomingArrivals", () => {
  it("includes future arrivals within the horizon", () => {
    const now = new Date(2026, 5, 8, 8, 0, 0, 0).getTime();
    const t = task({ start_date: "2026-06-08", start_time: "09:00" });
    const upcoming = upcomingArrivals([t], now, 0);
    expect(upcoming).toHaveLength(1);
  });

  it("excludes past and far-future arrivals", () => {
    const now = new Date(2026, 5, 8, 10, 0, 0, 0).getTime();
    const past = task({ id: "k_past", start_date: "2026-06-08", start_time: "09:00" });
    const far = task({ id: "k_far", start_date: "2026-07-20" });
    expect(upcomingArrivals([past, far], now, 0)).toHaveLength(0);
  });
});

describe("notificationId", () => {
  it("is stable and non-zero", () => {
    const a = notificationId("start", "k_abc");
    const b = notificationId("start", "k_abc");
    expect(a).toBe(b);
    expect(a).not.toBe(0);
  });

  it("differs by kind", () => {
    expect(notificationId("start", "k_abc")).not.toBe(notificationId("due", "k_abc"));
  });
});

describe("notified key persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips through localStorage", () => {
    const keys = markNotified(new Set(), "start:k_a:2026-06-08:09:00");
    expect(keys.has("start:k_a:2026-06-08:09:00")).toBe(true);
    expect(loadNotifiedKeys().has("start:k_a:2026-06-08:09:00")).toBe(true);
  });

  it("prunes keys for removed tasks", () => {
    saveNotifiedKeys(new Set(["start:k_a:2026-06-08:09:00", "due:k_b:2026-06-09:10:00"]));
    const pruned = pruneNotifiedKeys(loadNotifiedKeys(), new Set(["k_a"]));
    expect([...pruned]).toEqual(["start:k_a:2026-06-08:09:00"]);
  });
});
