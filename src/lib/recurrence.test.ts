import { describe, expect, it } from "vitest";
import { isoWeekday, daysInMonth, occursOn } from "./recurrence";
import { Recurrence } from "./tauri";

describe("isoWeekday", () => {
  it("maps ISO weekdays with Monday=1 and Sunday=7", () => {
    expect(isoWeekday("2026-06-08")).toBe(1); // Monday
    expect(isoWeekday("2026-06-13")).toBe(6); // Saturday
    expect(isoWeekday("2026-06-14")).toBe(7); // Sunday
  });
});

describe("daysInMonth", () => {
  it("returns the length of the month", () => {
    expect(daysInMonth("2026-02-15")).toBe(28); // non-leap Feb
    expect(daysInMonth("2024-02-15")).toBe(29); // leap Feb
    expect(daysInMonth("2026-04-10")).toBe(30);
    expect(daysInMonth("2026-01-10")).toBe(31);
  });
});

describe("occursOn", () => {
  it("weekly fires only on listed weekdays", () => {
    const mwf: Recurrence = { kind: "weekly", weekdays: [1, 3, 5] };
    expect(occursOn(mwf, "2026-06-08")).toBe(true);  // Mon
    expect(occursOn(mwf, "2026-06-09")).toBe(false); // Tue
    expect(occursOn(mwf, "2026-06-10")).toBe(true);  // Wed
  });

  it("weekday preset fires Mon–Fri only", () => {
    const weekdays: Recurrence = { kind: "weekly", weekdays: [1, 2, 3, 4, 5] };
    expect(occursOn(weekdays, "2026-06-12")).toBe(true);  // Fri
    expect(occursOn(weekdays, "2026-06-13")).toBe(false); // Sat
  });

  it("monthly fires on the day-of-month", () => {
    const r: Recurrence = { kind: "monthly", day: 15 };
    expect(occursOn(r, "2026-06-15")).toBe(true);
    expect(occursOn(r, "2026-06-14")).toBe(false);
  });

  it("monthly clamps a too-large day to the last day of the month", () => {
    const r: Recurrence = { kind: "monthly", day: 31 };
    expect(occursOn(r, "2026-02-28")).toBe(true);  // Feb has no 31st → clamps to 28
    expect(occursOn(r, "2026-02-27")).toBe(false);
    expect(occursOn(r, "2026-04-30")).toBe(true);  // Apr clamps to 30
    expect(occursOn(r, "2026-01-31")).toBe(true);  // Jan really has a 31st
  });

  it("daily fires every day", () => {
    const r: Recurrence = { kind: "daily" };
    expect(occursOn(r, "2026-06-08")).toBe(true);
    expect(occursOn(r, "2026-12-31")).toBe(true);
    expect(occursOn(r, "2024-02-29")).toBe(true);
  });

  it("yearly fires on the exact month and day", () => {
    const r: Recurrence = { kind: "yearly", month: 3, day: 15 };
    expect(occursOn(r, "2026-03-15")).toBe(true);
    expect(occursOn(r, "2027-03-15")).toBe(true);  // any year
    expect(occursOn(r, "2026-03-14")).toBe(false); // wrong day
    expect(occursOn(r, "2026-04-15")).toBe(false); // wrong month
  });

  it("yearly Feb 29 fires in leap years and is skipped otherwise (no clamp)", () => {
    const r: Recurrence = { kind: "yearly", month: 2, day: 29 };
    expect(occursOn(r, "2024-02-29")).toBe(true);  // leap year
    expect(occursOn(r, "2026-02-28")).toBe(false); // non-leap: does NOT clamp to the 28th
    expect(occursOn(r, "2027-02-28")).toBe(false);
  });
});
