import { describe, it, expect } from "vitest";
import { Settings } from "./tauri";
import {
  clampUpcomingDays,
  upcomingDays,
  UPCOMING_DAYS_DEFAULT,
  UPCOMING_DAYS_MAX,
  UPCOMING_DAYS_MIN,
} from "./settings";

const settings = (upcoming_days?: number): Settings =>
  ({ theme: "auto", sort_order: "priority", upcoming_days });

describe("clampUpcomingDays", () => {
  it("keeps in-range integers", () => {
    expect(clampUpcomingDays("30")).toBe(30);
    expect(clampUpcomingDays(7)).toBe(7);
  });

  it("clamps below/above the allowed range", () => {
    expect(clampUpcomingDays("0")).toBe(UPCOMING_DAYS_MIN);
    expect(clampUpcomingDays(-5)).toBe(UPCOMING_DAYS_MIN);
    expect(clampUpcomingDays("99999")).toBe(UPCOMING_DAYS_MAX);
  });

  it("falls back to the default on non-numeric input", () => {
    expect(clampUpcomingDays("abc")).toBe(UPCOMING_DAYS_DEFAULT);
    expect(clampUpcomingDays("")).toBe(UPCOMING_DAYS_DEFAULT);
  });

  it("truncates fractional input", () => {
    expect(clampUpcomingDays(14.9)).toBe(14);
  });
});

describe("upcomingDays", () => {
  it("defaults to 14 when unset (older documents)", () => {
    expect(upcomingDays(settings(undefined))).toBe(UPCOMING_DAYS_DEFAULT);
  });

  it("uses the configured value when present", () => {
    expect(upcomingDays(settings(30))).toBe(30);
  });

  it("clamps an out-of-range stored value defensively", () => {
    expect(upcomingDays(settings(99999))).toBe(UPCOMING_DAYS_MAX);
  });
});
