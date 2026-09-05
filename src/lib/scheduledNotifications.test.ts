import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Task } from "./tauri";
import {
  arrivalKey,
  arrivalsDueNow,
  cancelStaleRegisteredPending,
  isArrivalDue,
  isArrivalKeyEligible,
  loadNotifiedKeys,
  loadRegisteredOsNotifications,
  markNotified,
  notificationId,
  notificationIdForKey,
  pruneNotifiedKeys,
  reconcileDeliveredKeys,
  reconcileOsBackgroundDelivered,
  registerOsNotification,
  saveNotifiedKeys,
  scheduleSignature,
  shouldNotifyImmediately,
  taskArrival,
  taskArrivalKind,
  taskArrivalMoment,
  unregisterOsNotification,
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

describe("shouldNotifyImmediately", () => {
  it("skips claimed arrivals", () => {
    const t = task({ id: "k_a", start_date: "2026-06-08", start_time: "09:00" });
    const arrival = taskArrival(t, 0)!;
    const now = arrival.at.getTime() + 1000;
    expect(shouldNotifyImmediately(arrival, now, new Set(), new Set([arrival.key]))).toBe(false);
  });

  it("does not skip due arrivals because of pending ids", () => {
    const t = task({ id: "k_a", start_date: "2026-06-08", start_time: "09:00" });
    const arrival = taskArrival(t, 0)!;
    const now = arrival.at.getTime() + 1000;
    expect(shouldNotifyImmediately(arrival, now, new Set(), new Set())).toBe(true);
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

describe("isArrivalKeyEligible", () => {
  it("returns false when the task is completed", () => {
    const arrival = taskArrival(task({ id: "k_a", start_date: "2026-06-08", start_time: "09:00" }), 0)!;
    const completed = task({
      id: "k_a",
      start_date: "2026-06-08",
      start_time: "09:00",
      completed_at: "2026-06-08T10:00:00+00:00",
    });
    expect(isArrivalKeyEligible(arrival.key, [completed], 0)).toBe(false);
  });

  it("returns false when the arrival kind changes", () => {
    const oldKey = arrivalKey("start", "k_a", new Date(2026, 5, 8, 9, 0, 0, 0));
    const dueOnly = task({ id: "k_a", due_date: "2026-06-08", due_time: "09:00" });
    expect(isArrivalKeyEligible(oldKey, [dueOnly], 0)).toBe(false);
  });
});

describe("reconcileDeliveredKeys", () => {
  it("marks registered arrivals with explicit delivered evidence", () => {
    const arrival = taskArrival(task({ id: "k_a", start_date: "2026-06-08", start_time: "09:00" }), 0)!;
    const registered = registerOsNotification(new Map(), arrival.key, notificationIdForKey(arrival.key));
    const result = reconcileDeliveredKeys(new Set([arrival.key]), new Set(), registered);
    expect(result.notified.has(arrival.key)).toBe(true);
    expect(result.registered.has(arrival.key)).toBe(false);
  });
});

describe("reconcileOsBackgroundDelivered", () => {
  it("infers delivery on Android when registered, due, and not pending", () => {
    const arrival = taskArrival(task({ id: "k_a", start_date: "2026-06-08", start_time: "09:00" }), 0)!;
    const registered = registerOsNotification(new Map(), arrival.key, notificationIdForKey(arrival.key));
    const now = arrival.at.getTime() + 1000;
    const delivered = reconcileOsBackgroundDelivered(registered, now, new Set(), true);
    expect(delivered.has(arrival.key)).toBe(true);
  });

  it("does not infer delivery on desktop without explicit evidence", () => {
    const arrival = taskArrival(task({ id: "k_a", start_date: "2026-06-08", start_time: "09:00" }), 0)!;
    const registered = registerOsNotification(new Map(), arrival.key, notificationIdForKey(arrival.key));
    const now = arrival.at.getTime() + 1000;
    const delivered = reconcileOsBackgroundDelivered(registered, now, new Set(), false);
    expect(delivered.size).toBe(0);
  });
});

describe("cancelStaleRegisteredPending", () => {
  it("cancels orphan pending ids when a task is completed", () => {
    const arrival = taskArrival(task({ id: "k_a", start_date: "2026-06-09", start_time: "09:00" }), 0)!;
    const id = notificationIdForKey(arrival.key);
    const registered = registerOsNotification(new Map(), arrival.key, id);
    const completed = task({
      id: "k_a",
      start_date: "2026-06-09",
      start_time: "09:00",
      completed_at: "2026-06-08T10:00:00+00:00",
    });
    const result = cancelStaleRegisteredPending(
      registered,
      new Set([arrival.key]),
      [completed],
      0,
      new Set([id]),
    );
    expect(result.cancel).toEqual([id]);
    expect(result.registered.has(arrival.key)).toBe(false);
  });

  it("cancels pending ids for registered keys whose tasks were deleted", () => {
    const key = "start:k_gone:2026-06-09:09:00";
    const id = notificationIdForKey(key);
    const registered = registerOsNotification(new Map(), key, id);
    const result = cancelStaleRegisteredPending(
      registered,
      new Set(),
      [],
      0,
      new Set([id]),
    );
    expect(result.cancel).toEqual([id]);
    expect(result.registered.has(key)).toBe(false);
  });

  it("cancels orphan pending ids when the arrival kind changes", () => {
    const oldKey = arrivalKey("start", "k_a", new Date(2026, 5, 9, 9, 0, 0, 0));
    const id = notificationIdForKey(oldKey);
    const registered = registerOsNotification(new Map(), oldKey, id);
    const dueOnly = task({ id: "k_a", due_date: "2026-06-09", due_time: "09:00" });
    const newArrival = taskArrival(dueOnly, 0)!;
    const result = cancelStaleRegisteredPending(
      registered,
      new Set([newArrival.key]),
      [dueOnly],
      0,
      new Set([id]),
    );
    expect(result.cancel).toEqual([id]);
    expect(result.registered.has(oldKey)).toBe(false);
  });

  it("keeps desired future registrations", () => {
    const arrival = taskArrival(task({ id: "k_a", start_date: "2026-06-09", start_time: "09:00" }), 0)!;
    const id = notificationIdForKey(arrival.key);
    const registered = registerOsNotification(new Map(), arrival.key, id);
    const result = cancelStaleRegisteredPending(
      registered,
      new Set([arrival.key]),
      [task({ id: "k_a", start_date: "2026-06-09", start_time: "09:00" })],
      0,
      new Set([id]),
    );
    expect(result.cancel).toEqual([]);
    expect(result.registered.has(arrival.key)).toBe(true);
  });
});

describe("scheduleSignature", () => {
  it("changes when the upcoming set changes", () => {
    const a = taskArrival(task({ start_date: "2026-06-08", start_time: "09:00" }), 0)!;
    const b = taskArrival(task({ start_date: "2026-06-09", start_time: "09:00" }), 0)!;
    expect(scheduleSignature([a])).not.toBe(scheduleSignature([a, b]));
  });
});

describe("notificationIdForKey", () => {
  it("is stable and non-zero", () => {
    const key = "start:k_abc:2026-06-08:09:00";
    const a = notificationIdForKey(key);
    const b = notificationIdForKey(key);
    expect(a).toBe(b);
    expect(a).not.toBe(0);
  });

  it("differs when the arrival moment changes", () => {
    const a = notificationIdForKey("start:k_abc:2026-06-08:09:00");
    const b = notificationIdForKey("start:k_abc:2026-06-08:10:00");
    expect(a).not.toBe(b);
  });

  it("differs by kind for the same task and moment", () => {
    expect(notificationIdForKey("start:k_abc:2026-06-08:09:00"))
      .not.toBe(notificationIdForKey("due:k_abc:2026-06-08:09:00"));
  });
});

describe("notificationId", () => {
  it("remains available for legacy callers", () => {
    expect(notificationId("start", "k_abc")).not.toBe(0);
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

  it("tracks registered OS notification ids", () => {
    const registered = registerOsNotification(new Map(), "start:k_a:2026-06-08:09:00", 42);
    expect(loadRegisteredOsNotifications().get("start:k_a:2026-06-08:09:00")).toBe(42);
    const cleared = unregisterOsNotification(registered, "start:k_a:2026-06-08:09:00");
    expect(cleared.has("start:k_a:2026-06-08:09:00")).toBe(false);
  });
});
