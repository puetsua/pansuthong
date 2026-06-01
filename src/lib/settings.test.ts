import { describe, it, expect } from "vitest";
import { Settings } from "./tauri";
import {
  clampUpcomingDays,
  upcomingDays,
  UPCOMING_DAYS_DEFAULT,
  UPCOMING_DAYS_MAX,
  UPCOMING_DAYS_MIN,
  defaultTagColor,
  defaultTagPriority,
  DEFAULT_TAG_COLOR,
  DEFAULT_TAG_PRIORITY,
} from "./settings";
import { WEIGHT_MAX } from "./tags";

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

describe("defaultTagColor", () => {
  it("falls back to the built-in default when unset or settings absent", () => {
    expect(defaultTagColor(undefined)).toBe(DEFAULT_TAG_COLOR);
    expect(defaultTagColor(settings())).toBe(DEFAULT_TAG_COLOR);
  });

  it("uses the configured color when present", () => {
    expect(defaultTagColor({ ...settings(), default_tag_color: "#ef4444" })).toBe("#ef4444");
  });
});

describe("defaultTagPriority", () => {
  it("falls back to 0 when unset or settings absent", () => {
    expect(defaultTagPriority(undefined)).toBe(DEFAULT_TAG_PRIORITY);
    expect(defaultTagPriority(settings())).toBe(DEFAULT_TAG_PRIORITY);
  });

  it("uses the configured weight when present", () => {
    expect(defaultTagPriority({ ...settings(), default_tag_priority: 7 })).toBe(7);
  });

  it("clamps an out-of-range stored value defensively", () => {
    expect(defaultTagPriority({ ...settings(), default_tag_priority: 999999 })).toBe(WEIGHT_MAX);
  });
});
