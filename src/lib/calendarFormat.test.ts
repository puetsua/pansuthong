import { describe, expect, it, vi } from "vitest";
import {
  calendarDayTitle,
  calendarMonthTitle,
  calendarWeekRange,
  weekdayLabelForIso,
} from "./calendarFormat";

const t = (key: string, opts?: Record<string, string>) => {
  if (key === "calendar.weekRange" && opts) return `${opts.start} – ${opts.end}`;
  if (key === "calendar.today") return "Today";
  const weekdays: Record<string, string> = {
    "taskEditor.weekdaySun": "Sun",
    "taskEditor.weekdayMon": "Mon",
    "taskEditor.weekdayTue": "Tue",
    "taskEditor.weekdayWed": "Wed",
    "taskEditor.weekdayThu": "Thu",
    "taskEditor.weekdayFri": "Fri",
    "taskEditor.weekdaySat": "Sat",
  };
  return weekdays[key] ?? key;
};

describe("calendarFormat", () => {
  it("formats month title with Chinese Minguo preset", () => {
    expect(calendarMonthTitle("2026-09", "minguo_zh", "zh-TW")).toBe("民國115年9月");
    expect(calendarMonthTitle("2026-10", "minguo_zh", "zh-TW")).toBe("民國115年10月");
  });

  it("formats week range with Chinese Minguo preset", () => {
    const range = calendarWeekRange("2026-09-06", "minguo_zh", "zh-TW", t as never);
    expect(range).toBe("民國115年9月6日 – 民國115年9月12日");
    expect(range).not.toMatch(/Sep|2026/);
  });

  it("formats day title with Chinese Minguo preset and today marker", () => {
    const title = calendarDayTitle("2026-09-06", "2026-09-06", "minguo_zh", "zh-TW", t as never);
    expect(title).toBe("民國115年9月6日 (Sun) · Today");
  });

  it("uses i18n weekday keys instead of browser locale", () => {
    const zhT = vi.fn((key: string) => (key === "taskEditor.weekdaySun" ? "日" : key));
    expect(weekdayLabelForIso("2026-09-06", zhT as never)).toBe("日");
    expect(zhT).toHaveBeenCalledWith("taskEditor.weekdaySun");
  });
});
