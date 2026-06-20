import { describe, it, expect } from "vitest";
import { Settings } from "./tauri";
import {
  clampDayStartHour,
  clampMaxAttachmentMb,
  clampRecurrenceHeatmapDays,
  clampReminderInterval,
  clampUpcomingDays,
  DATE_FORMAT_DEFAULT,
  DATE_TIME_FORMAT_DEFAULT,
  dateFormat,
  dateTimeFormat,
  dayStartHour,
  DAY_START_HOUR_DEFAULT,
  DAY_START_HOUR_MAX,
  DAY_START_HOUR_MIN,
  defaultTagColor,
  defaultTagPriority,
  DEFAULT_TAG_COLOR,
  DEFAULT_TAG_PRIORITY,
  clampFirstDayOfWeek,
  firstDayOfWeek,
  FIRST_DAY_OF_WEEK_DEFAULT,
  FIRST_DAY_OF_WEEK_MAX,
  FIRST_DAY_OF_WEEK_MIN,
  maxAttachmentMb,
  MAX_ATTACHMENT_MB_DEFAULT,
  MAX_ATTACHMENT_MB_MAX,
  MAX_ATTACHMENT_MB_MIN,
  RECURRENCE_HEATMAP_DAYS_DEFAULT,
  RECURRENCE_HEATMAP_DAYS_MAX,
  RECURRENCE_HEATMAP_DAYS_MIN,
  recurrenceHeatmapDays,
  reminderIntervalMinutes,
  REMINDER_INTERVAL_DEFAULT,
  REMINDER_INTERVAL_MAX,
  REMINDER_INTERVAL_MIN,
  soundOnComplete,
  TIME_FORMAT_DEFAULT,
  timeFormat,
  upcomingDays,
  UPCOMING_DAYS_DEFAULT,
  UPCOMING_DAYS_MAX,
  UPCOMING_DAYS_MIN,
} from "./settings";
import { WEIGHT_MAX } from "./tags";

const settings = (upcoming_days?: number): Settings =>
  ({ theme: "auto", sort_order: "priority", upcoming_days });

describe("clampMaxAttachmentMb", () => {
  it("keeps in-range integers and clamps out-of-range input", () => {
    expect(clampMaxAttachmentMb("512")).toBe(512);
    expect(clampMaxAttachmentMb(0)).toBe(MAX_ATTACHMENT_MB_MIN);
    expect(clampMaxAttachmentMb("999999")).toBe(MAX_ATTACHMENT_MB_MAX);
  });

  it("falls back to the default on non-numeric input", () => {
    expect(clampMaxAttachmentMb("abc")).toBe(MAX_ATTACHMENT_MB_DEFAULT);
  });

  it("uses the default when settings omit the cap", () => {
    expect(maxAttachmentMb({ theme: "auto", sort_order: "priority" } as Settings))
      .toBe(MAX_ATTACHMENT_MB_DEFAULT);
  });
});

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

describe("clampDayStartHour", () => {
  it("keeps in-range hours", () => {
    expect(clampDayStartHour("0")).toBe(0);
    expect(clampDayStartHour(4)).toBe(4);
    expect(clampDayStartHour("23")).toBe(23);
  });

  it("clamps below/above the 0..23 range", () => {
    expect(clampDayStartHour(-1)).toBe(DAY_START_HOUR_MIN);
    expect(clampDayStartHour("24")).toBe(DAY_START_HOUR_MAX);
    expect(clampDayStartHour(99)).toBe(DAY_START_HOUR_MAX);
  });

  it("falls back to the default on non-numeric input", () => {
    expect(clampDayStartHour("abc")).toBe(DAY_START_HOUR_DEFAULT);
    expect(clampDayStartHour("")).toBe(DAY_START_HOUR_DEFAULT);
  });

  it("truncates fractional input", () => {
    expect(clampDayStartHour(4.9)).toBe(4);
  });
});

describe("dayStartHour", () => {
  it("defaults to midnight (0) when unset (older documents)", () => {
    expect(dayStartHour(settings())).toBe(DAY_START_HOUR_DEFAULT);
    expect(DAY_START_HOUR_DEFAULT).toBe(0);
  });

  it("uses the configured hour when present", () => {
    expect(dayStartHour({ ...settings(), day_start_hour: 4 })).toBe(4);
  });

  it("clamps an out-of-range stored value defensively", () => {
    expect(dayStartHour({ ...settings(), day_start_hour: 99 })).toBe(DAY_START_HOUR_MAX);
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

describe("soundOnComplete", () => {
  it("defaults to on when unset (older documents) (#80)", () => {
    expect(soundOnComplete(settings())).toBe(true);
  });

  it("uses the configured value when present", () => {
    expect(soundOnComplete({ ...settings(), sound_on_complete: false })).toBe(false);
    expect(soundOnComplete({ ...settings(), sound_on_complete: true })).toBe(true);
  });
});

describe("clampReminderInterval", () => {
  it("keeps in-range integers", () => {
    expect(clampReminderInterval("10")).toBe(10);
    expect(clampReminderInterval(30)).toBe(30);
  });

  it("clamps below/above the allowed range", () => {
    expect(clampReminderInterval("0")).toBe(REMINDER_INTERVAL_MIN);
    expect(clampReminderInterval(-5)).toBe(REMINDER_INTERVAL_MIN);
    expect(clampReminderInterval("99999")).toBe(REMINDER_INTERVAL_MAX);
  });

  it("falls back to the default on non-numeric input", () => {
    expect(clampReminderInterval("abc")).toBe(REMINDER_INTERVAL_DEFAULT);
    expect(clampReminderInterval("")).toBe(REMINDER_INTERVAL_DEFAULT);
  });

  it("truncates fractional input", () => {
    expect(clampReminderInterval(10.9)).toBe(10);
  });
});

describe("reminderIntervalMinutes", () => {
  it("defaults to 10 when unset (older documents)", () => {
    expect(reminderIntervalMinutes(settings())).toBe(REMINDER_INTERVAL_DEFAULT);
    expect(REMINDER_INTERVAL_DEFAULT).toBe(10);
  });

  it("uses the configured value when present", () => {
    expect(reminderIntervalMinutes({ ...settings(), reminder_interval_minutes: 30 })).toBe(30);
  });

  it("clamps an out-of-range stored value defensively", () => {
    expect(reminderIntervalMinutes({ ...settings(), reminder_interval_minutes: 99999 })).toBe(REMINDER_INTERVAL_MAX);
  });
});

describe("dateTimeFormat", () => {
  it("defaults to locale when unset (older documents)", () => {
    expect(dateTimeFormat(settings())).toBe(DATE_TIME_FORMAT_DEFAULT);
    expect(DATE_TIME_FORMAT_DEFAULT).toBe("locale");
  });

  it("uses the configured preset when present", () => {
    expect(dateTimeFormat({ ...settings(), date_time_format: "japanese" })).toBe("japanese");
  });

  it("normalizes an unsupported stored value to the default", () => {
    expect(dateTimeFormat({ ...settings(), date_time_format: "klingon" as "locale" })).toBe("locale");
  });
});

describe("dateFormat", () => {
  it("defaults to locale when unset", () => {
    expect(dateFormat(settings())).toBe(DATE_FORMAT_DEFAULT);
    expect(DATE_FORMAT_DEFAULT).toBe("locale");
  });

  it("uses the configured date preset when present", () => {
    expect(dateFormat({ ...settings(), date_format: "chinese_lunar" })).toBe("chinese_lunar");
  });

  it("falls back to the legacy combined preset", () => {
    expect(dateFormat({ ...settings(), date_time_format: "japanese" })).toBe("japanese");
  });

  it("normalizes an unsupported stored value to the default", () => {
    expect(dateFormat({ ...settings(), date_format: "klingon" as "locale" })).toBe("locale");
  });
});

describe("timeFormat", () => {
  it("defaults to locale when unset", () => {
    expect(timeFormat(settings())).toBe(TIME_FORMAT_DEFAULT);
    expect(TIME_FORMAT_DEFAULT).toBe("locale");
  });

  it("uses the configured time preset when present", () => {
    expect(timeFormat({ ...settings(), time_format: "chinese_day_period" })).toBe("chinese_day_period");
  });

  it("normalizes an unsupported stored value to the default", () => {
    expect(timeFormat({ ...settings(), time_format: "metric" as "locale" })).toBe("locale");
  });
});

describe("clampRecurrenceHeatmapDays", () => {
  it("keeps in-range integers", () => {
    expect(clampRecurrenceHeatmapDays("90")).toBe(90);
    expect(clampRecurrenceHeatmapDays(180)).toBe(180);
  });

  it("clamps below/above the allowed range", () => {
    expect(clampRecurrenceHeatmapDays("0")).toBe(RECURRENCE_HEATMAP_DAYS_MIN);
    expect(clampRecurrenceHeatmapDays(-5)).toBe(RECURRENCE_HEATMAP_DAYS_MIN);
    expect(clampRecurrenceHeatmapDays("99999")).toBe(RECURRENCE_HEATMAP_DAYS_MAX);
  });

  it("falls back to the default on non-numeric input", () => {
    expect(clampRecurrenceHeatmapDays("abc")).toBe(RECURRENCE_HEATMAP_DAYS_DEFAULT);
    expect(clampRecurrenceHeatmapDays("")).toBe(RECURRENCE_HEATMAP_DAYS_DEFAULT);
  });

  it("truncates fractional input", () => {
    expect(clampRecurrenceHeatmapDays(90.9)).toBe(90);
  });
});

describe("recurrenceHeatmapDays", () => {
  it("defaults to 90 when unset (older documents)", () => {
    expect(recurrenceHeatmapDays(settings())).toBe(RECURRENCE_HEATMAP_DAYS_DEFAULT);
    expect(RECURRENCE_HEATMAP_DAYS_DEFAULT).toBe(90);
  });

  it("uses the configured value when present", () => {
    expect(recurrenceHeatmapDays({ ...settings(), recurrence_heatmap_days: 120 })).toBe(120);
  });

  it("clamps an out-of-range stored value defensively", () => {
    expect(recurrenceHeatmapDays({ ...settings(), recurrence_heatmap_days: 99999 })).toBe(RECURRENCE_HEATMAP_DAYS_MAX);
  });
});

describe("clampFirstDayOfWeek", () => {
  it("keeps in-range weekday indices", () => {
    expect(clampFirstDayOfWeek("0")).toBe(0);
    expect(clampFirstDayOfWeek(6)).toBe(6);
  });

  it("clamps below/above 0..6", () => {
    expect(clampFirstDayOfWeek(-1)).toBe(FIRST_DAY_OF_WEEK_MIN);
    expect(clampFirstDayOfWeek("9")).toBe(FIRST_DAY_OF_WEEK_MAX);
  });

  it("falls back to the default on non-numeric input", () => {
    expect(clampFirstDayOfWeek("abc")).toBe(FIRST_DAY_OF_WEEK_DEFAULT);
  });
});

describe("firstDayOfWeek", () => {
  it("defaults to Monday (1) when unset (older documents)", () => {
    expect(firstDayOfWeek(settings())).toBe(FIRST_DAY_OF_WEEK_DEFAULT);
    expect(FIRST_DAY_OF_WEEK_DEFAULT).toBe(1);
  });

  it("uses the configured value when present", () => {
    expect(firstDayOfWeek({ ...settings(), first_day_of_week: 0 })).toBe(0);
  });

  it("clamps an out-of-range stored value defensively", () => {
    expect(firstDayOfWeek({ ...settings(), first_day_of_week: 99 })).toBe(FIRST_DAY_OF_WEEK_MAX);
  });
});
