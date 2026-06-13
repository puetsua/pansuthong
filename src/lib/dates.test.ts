import { describe, expect, it } from "vitest";
import {
  addDaysIso, daysBetweenIso, formatDate, formatDateTime, formatIsoDate, formatIsoLocal, formatTime, formatTimeOfDay, logicalDayOf, todayIso,
} from "./dates";

describe("todayIso (day-start hour)", () => {
  it("returns the plain calendar date with the default (midnight) rollover", () => {
    expect(todayIso(new Date(2026, 5, 2, 3, 0, 0))).toBe("2026-06-02");
    expect(todayIso(new Date(2026, 5, 2, 3, 0, 0), 0)).toBe("2026-06-02");
  });

  it("counts the hours before the start hour as still the previous day", () => {
    // 03:00 with a 4am day start -> the day hasn't rolled over yet.
    expect(todayIso(new Date(2026, 5, 2, 3, 0, 0), 4)).toBe("2026-06-01");
    // 03:59 is the last minute of the previous logical day.
    expect(todayIso(new Date(2026, 5, 2, 3, 59, 0), 4)).toBe("2026-06-01");
  });

  it("rolls the day over exactly at the start hour", () => {
    expect(todayIso(new Date(2026, 5, 2, 4, 0, 0), 4)).toBe("2026-06-02");
    expect(todayIso(new Date(2026, 5, 2, 5, 30, 0), 4)).toBe("2026-06-02");
  });

  it("treats the rest of the day (up to midnight) as the same logical day", () => {
    expect(todayIso(new Date(2026, 5, 2, 23, 59, 0), 4)).toBe("2026-06-02");
  });
});

describe("logicalDayOf (day-start hour)", () => {
  it("is a plain date slice with the default (midnight) rollover", () => {
    expect(logicalDayOf("2026-06-11T00:05:00+08:00")).toBe("2026-06-11");
    expect(logicalDayOf("2026-06-11T00:05:00+08:00", 0)).toBe("2026-06-11");
  });

  it("counts a wall-clock hour before the start as the previous logical day", () => {
    // 00:05 with a 3am day start still belongs to the prior day (the bug case).
    expect(logicalDayOf("2026-06-11T00:05:00+08:00", 3)).toBe("2026-06-10");
    // 02:59 is the last minute of the previous logical day.
    expect(logicalDayOf("2026-06-11T02:59:00+08:00", 3)).toBe("2026-06-10");
  });

  it("rolls over exactly at the start hour and stays there until midnight", () => {
    expect(logicalDayOf("2026-06-11T03:00:00+08:00", 3)).toBe("2026-06-11");
    expect(logicalDayOf("2026-06-11T23:59:00+08:00", 3)).toBe("2026-06-11");
  });

  it("reads the wall clock from the string, not the runner's timezone", () => {
    // The offset varies but the written hour (00) is what matters.
    expect(logicalDayOf("2026-06-11T00:30:00+09:00", 3)).toBe("2026-06-10");
    expect(logicalDayOf("2026-06-11T00:30:00-05:00", 3)).toBe("2026-06-10");
  });

  it("crosses a month boundary when shifting back", () => {
    expect(logicalDayOf("2026-06-01T01:00:00+08:00", 3)).toBe("2026-05-31");
  });

  it("returns an empty string for a missing date", () => {
    expect(logicalDayOf("", 3)).toBe("");
  });
});

describe("addDaysIso / daysBetweenIso (#71)", () => {
  it("addDaysIso adds days across month boundaries", () => {
    expect(addDaysIso("2026-05-31", 0)).toBe("2026-05-31");
    expect(addDaysIso("2026-05-31", 3)).toBe("2026-06-03");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("daysBetweenIso is the inverse and signed", () => {
    expect(daysBetweenIso("2026-05-31", "2026-06-03")).toBe(3);
    expect(daysBetweenIso("2026-05-31", "2026-05-31")).toBe(0);
    expect(daysBetweenIso("2026-06-03", "2026-05-31")).toBe(-3);
  });
});

describe("formatIsoLocal", () => {
  it("formats an epoch-ms timestamp as full ISO 8601 with seconds and a timezone offset", () => {
    const out = formatIsoLocal(1_748_589_722_000); // arbitrary instant
    // YYYY-MM-DDTHH:MM:SS±HH:MM (local zone), e.g. 2026-05-30T16:08:42+09:00
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it("accepts an ISO-8601 string in any offset (local is the stored/wire form; UTC stays back-compatible)", () => {
    const out = formatIsoLocal("2026-06-01T12:34:56Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    // Same instant whether given as a UTC string, an offset string, or epoch ms.
    expect(out).toBe(formatIsoLocal(Date.parse("2026-06-01T12:34:56Z")));
    expect(out).toBe(formatIsoLocal("2026-06-01T20:34:56+08:00"));
  });

  it("round-trips to the same instant (timezone-independent), truncated to seconds", () => {
    const ms = 1_748_589_722_123;
    const parsed = new Date(formatIsoLocal(ms)).getTime();
    expect(parsed).toBe(ms - (ms % 1000)); // second precision
  });

  it("renders an em dash for a missing/empty/zero timestamp", () => {
    expect(formatIsoLocal(0)).toBe("—");
    expect(formatIsoLocal(undefined)).toBe("—");
    expect(formatIsoLocal(null)).toBe("—");
    expect(formatIsoLocal("")).toBe("—");
  });
});

describe("formatDateTime", () => {
  // 2026-06-12T20:14:27Z
  const instant = Date.UTC(2026, 5, 12, 20, 14, 27);

  it("renders an em dash for missing/empty/invalid input", () => {
    expect(formatDateTime(undefined, "locale")).toBe("—");
    expect(formatDateTime(null, "locale")).toBe("—");
    expect(formatDateTime("", "locale")).toBe("—");
    expect(formatDateTime("not-a-date", "locale")).toBe("—");
  });

  it("formats as ISO YYYY-MM-DD HH:MM:SS", () => {
    expect(formatDateTime(instant, "iso", "twenty_four")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("uses the supplied locale for the locale preset", () => {
    const en = formatDateTime(instant, "locale", "en");
    const zh = formatDateTime(instant, "locale", "zh-TW");
    expect(en).toContain("2026");
    expect(zh).toContain("2026");
    // The two locales should produce visibly different strings.
    expect(en).not.toBe(zh);
  });

  it("supports Traditional Chinese, ROC, and Japanese era calendars", () => {
    const chinese = formatDateTime(instant, "chinese");
    const roc = formatDateTime(instant, "roc");
    const japanese = formatDateTime(instant, "japanese");
    // Each preset should mention the year and not fall back to an em dash.
    expect(chinese).toContain("2026");
    expect(roc).not.toBe("—");
    expect(japanese).not.toBe("—");
  });
});

describe("formatDate / formatTime", () => {
  const instant = Date.UTC(2026, 5, 12, 20, 14, 27);

  it("formats a date-only ISO field without timezone drift", () => {
    expect(formatIsoDate("2026-06-12", "iso")).toBe("2026-06-12");
  });

  it("formats date presets separately from time presets", () => {
    expect(formatDate(instant, "iso")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatTime(instant, "twenty_four")).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatTime(instant, "twelve_hour", "en")).toMatch(/\d{1,2}:\d{2}:\d{2}\s?(AM|PM)/i);
  });

  it("supports common fixed numeric and named date formats", () => {
    const d = new Date(2026, 5, 12, 8, 9, 10);
    expect(formatDate(d, "slash_ymd")).toBe("2026/06/12");
    expect(formatDate(d, "dot_ymd")).toBe("2026.06.12");
    expect(formatDate(d, "slash_mdy")).toBe("06/12/2026");
    expect(formatDate(d, "slash_dmy")).toBe("12/06/2026");
    expect(formatDate(d, "dot_dmy")).toBe("12.06.2026");
    expect(formatDate(d, "compact")).toBe("20260612");
    expect(formatDate(d, "month_day_year")).toBe("Jun 12, 2026");
    expect(formatDate(d, "day_month_year")).toBe("12 Jun 2026");
    expect(formatDate(d, "weekday_short", "en")).toContain("Fri");
    expect(formatDate(d, "weekday_long", "en")).toContain("Friday");
  });

  it("supports Chinese western-era and Minguo text date formats", () => {
    const d = new Date(2026, 4, 13, 8, 9, 10);
    expect(formatDate(d, "xiyuan_zh")).toBe("西元2026年5月13日");
    expect(formatDate(d, "gongyuan_zh")).toBe("公元2026年5月13日");
    expect(formatDate(d, "minguo_zh")).toBe("民國115年5月13日");
  });

  it("supports non-Gregorian localized calendar presets", () => {
    const d = new Date(2026, 4, 13, 8, 9, 10);
    expect(formatDate(d, "buddhist_thai")).not.toBe("—");
    expect(formatDate(d, "hebrew")).not.toBe("—");
    expect(formatDate(d, "islamic")).not.toBe("—");
    expect(formatDate(d, "persian")).not.toBe("—");
    expect(formatDate(d, "indian")).not.toBe("—");
    expect(formatDate(d, "chinese_lunar")).not.toBe("—");
  });

  it("supports additional locale and compact time formats", () => {
    const d = new Date(2026, 5, 12, 8, 9, 10);
    expect(formatTime(d, "twenty_four_short")).toBe("08:09");
    expect(formatTime(d, "compact_24")).toBe("0809");
    expect(formatTime(d, "twelve_hour_short", "en")).toMatch(/8:09\s?AM/i);
    expect(formatTime(d, "locale_short", "en")).toContain("8:09");
  });

  it("formats HH:MM local task time fields", () => {
    expect(formatTimeOfDay("09:30", "twenty_four", "en-GB")).toBe("09:30:00");
  });
});
