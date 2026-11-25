import { useTranslation } from "react-i18next";
import type { Settings } from "../../lib/tauri";
import { currentLocale } from "../../i18n";
import { DATE_FORMATS, formatDate, formatTime, TIME_FORMATS } from "../../lib/dates";
import type { DateFormat, TimeFormat } from "../../lib/dates";
import {
  clampUpcomingDays, upcomingDays, UPCOMING_DAYS_MAX, UPCOMING_DAYS_MIN,
  dayStartHour, DAY_START_HOUR_MAX, DAY_START_HOUR_MIN,
  defaultTagPriority, soundOnComplete,
  clampReminderInterval, reminderIntervalMinutes, REMINDER_INTERVAL_MAX, REMINDER_INTERVAL_MIN,
  clampMaxAttachmentMb, maxAttachmentMb, MAX_ATTACHMENT_MB_MAX, MAX_ATTACHMENT_MB_MIN, MAX_ATTACHMENT_MB_WARN,
  clampDashboardHeatmapDays, dashboardHeatmapDays, DASHBOARD_HEATMAP_DAYS_MAX, DASHBOARD_HEATMAP_DAYS_MIN,
  firstDayOfWeek,
  dateFormat, timeFormat,
} from "../../lib/settings";
import { clampWeight, WEIGHT_MAX, WEIGHT_MIN } from "../../lib/tags";
import type { ApplySettings } from "./types";
import { SettingRow, SettingsSection } from "./SettingRow";
import { ToggleSwitch } from "./ToggleSwitch";
import { useClampedDraft } from "./useClampedDraft";
import { PresetSelect } from "./PresetSelect";

type SectionProps = { settings: Settings; applySettings: ApplySettings };

/** A 24-hour clock hour as a friendly label, e.g. 0 -> "12:00 AM", 16 -> "4:00 PM". */
function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${period}`;
}

export function LanguageSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const language = settings.language ?? "auto";
  return (
    <SettingRow title={t("settings.displayLanguage")} description={t("settings.languageSub")}>
      <select
        className="select-input"
        aria-label={t("settings.language")}
        value={language}
        onChange={e => { void applySettings({ language: e.currentTarget.value as "auto" | "en" | "zh-TW" }); }}
      >
        <option value="auto">{t("settings.langAuto")}</option>
        <option value="en">{t("settings.langEn")}</option>
        <option value="zh-TW">{t("settings.langZhTW")}</option>
      </select>
    </SettingRow>
  );
}

export function DateTimeSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const exampleNow = new Date();
  const dateFmt = dateFormat(settings);
  const timeFmt = timeFormat(settings);
  const dateFmtLabel: Record<DateFormat, string> = {
    locale: t("settings.dateFormatLocale"),
    locale_short: t("settings.dateFormatLocaleShort"),
    locale_long: t("settings.dateFormatLocaleLong"),
    locale_full: t("settings.dateFormatLocaleFull"),
    iso: t("settings.dateFormatIso"),
    slash_ymd: t("settings.dateFormatSlashYmd"),
    dot_ymd: t("settings.dateFormatDotYmd"),
    slash_mdy: t("settings.dateFormatSlashMdy"),
    slash_dmy: t("settings.dateFormatSlashDmy"),
    dot_dmy: t("settings.dateFormatDotDmy"),
    compact: t("settings.dateFormatCompact"),
    month_day_year: t("settings.dateFormatMonthDayYear"),
    day_month_year: t("settings.dateFormatDayMonthYear"),
    weekday_short: t("settings.dateFormatWeekdayShort"),
    weekday_long: t("settings.dateFormatWeekdayLong"),
    chinese: t("settings.dateFormatChinese"),
    xiyuan_zh: t("settings.dateFormatXiyuanZh"),
    gongyuan_zh: t("settings.dateFormatGongyuanZh"),
    roc: t("settings.dateFormatRoc"),
    minguo_zh: t("settings.dateFormatMinguoZh"),
    buddhist_thai: t("settings.dateFormatBuddhistThai"),
    hebrew: t("settings.dateFormatHebrew"),
    islamic: t("settings.dateFormatIslamic"),
    persian: t("settings.dateFormatPersian"),
    indian: t("settings.dateFormatIndian"),
    chinese_lunar: t("settings.dateFormatChineseLunar"),
    japanese: t("settings.dateFormatJapanese"),
  };
  const timeFmtLabel: Record<TimeFormat, string> = {
    locale: t("settings.timeFormatLocale"),
    twenty_four: t("settings.timeFormat24"),
    twelve_hour: t("settings.timeFormat12"),
    chinese_day_period: t("settings.timeFormatChineseDayPeriod"),
    japanese_day_period: t("settings.timeFormatJapaneseDayPeriod"),
    korean_day_period: t("settings.timeFormatKoreanDayPeriod"),
    thai_day_period: t("settings.timeFormatThaiDayPeriod"),
    arabic_day_period: t("settings.timeFormatArabicDayPeriod"),
  };
  return (
    <SettingsSection title={t("settings.dateTimeFormat")}>
      <SettingRow title={t("settings.dateFormat")}>
        <select
          className="select-input"
          aria-label={t("settings.dateFormat")}
          value={dateFmt}
          onChange={e => { void applySettings({ date_format: e.currentTarget.value as DateFormat }); }}
        >
          {DATE_FORMATS.map(opt => (
            <option key={opt} value={opt}>
              {dateFmtLabel[opt]} ({formatDate(exampleNow, opt, locale)})
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow title={t("settings.timeFormat")}>
        <select
          className="select-input"
          aria-label={t("settings.timeFormat")}
          value={timeFmt}
          onChange={e => { void applySettings({ time_format: e.currentTarget.value as TimeFormat }); }}
        >
          {TIME_FORMATS.map(opt => (
            <option key={opt} value={opt}>
              {timeFmtLabel[opt]} ({formatTime(exampleNow, opt, locale)})
            </option>
          ))}
        </select>
      </SettingRow>
    </SettingsSection>
  );
}

export function SortSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const sortOrder = settings.sort_order;
  const sortLabel: Record<"priority" | "date", string> = {
    priority: t("settings.sortPriority"), date: t("settings.sortDate"),
  };
  return (
    <SettingRow title={t("settings.sortOrder")} description={t("settings.sortSub")}>
      {(["priority", "date"] as const).map(s => (
        <button
          key={s}
          className={`theme-option ${sortOrder === s ? "active" : ""}`}
          aria-pressed={sortOrder === s}
          onClick={() => { void applySettings({ sort_order: s }); }}
        >
          {sortLabel[s]}
        </button>
      ))}
    </SettingRow>
  );
}

export function UpcomingSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  return (
    <SettingRow title={t("settings.upcomingRange")} description={t("settings.upcomingSub")}>
      <PresetSelect
        value={upcomingDays(settings)}
        presets={[7, 14, 30]}
        presetLabel={n => t("settings.daysPreset", { count: n })}
        ariaLabel={t("settings.upcomingRange")}
        customAriaLabel={t("settings.customUpcomingAria")}
        min={UPCOMING_DAYS_MIN}
        max={UPCOMING_DAYS_MAX}
        clamp={clampUpcomingDays}
        onChange={n => { void applySettings({ upcoming_days: n }); }}
      />
    </SettingRow>
  );
}

export function DayStartSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const startHour = dayStartHour(settings);
  return (
    <SettingRow title={t("settings.dayStart")} description={t("settings.dayStartSub")}>
      <select
        className="select-input"
        aria-label={t("settings.dayStartHourAria")}
        value={startHour}
        onChange={e => { void applySettings({ day_start_hour: Number(e.currentTarget.value) }); }}
      >
        {Array.from({ length: DAY_START_HOUR_MAX - DAY_START_HOUR_MIN + 1 }, (_, i) => i + DAY_START_HOUR_MIN).map(h => (
          <option key={h} value={h}>
            {hourLabel(h)}{h === 0 ? t("settings.midnight") : ""}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}

export function HeatmapSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  return (
    <SettingRow title={t("settings.dashboardHeatmapRange")} description={t("settings.dashboardHeatmapSub")}>
      <PresetSelect
        value={dashboardHeatmapDays(settings)}
        presets={[30, 60, 90, 180]}
        presetLabel={n => t("settings.daysPreset", { count: n })}
        ariaLabel={t("settings.dashboardHeatmapRange")}
        customAriaLabel={t("settings.customHeatmapAria")}
        min={DASHBOARD_HEATMAP_DAYS_MIN}
        max={DASHBOARD_HEATMAP_DAYS_MAX}
        clamp={clampDashboardHeatmapDays}
        onChange={n => { void applySettings({ recurrence_heatmap_days: n }); }}
      />
    </SettingRow>
  );
}

export function WeekStartSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const weekStart = firstDayOfWeek(settings);
  // Full weekday names in the UI language; 2024-01-07 is a Sunday.
  const weekdayName = (d: number) =>
    new Intl.DateTimeFormat(currentLocale(), { weekday: "long" }).format(new Date(2024, 0, 7 + d));
  return (
    <SettingRow title={t("settings.firstDayOfWeek")} description={t("settings.firstDayOfWeekSub")}>
      <select
        className="select-input"
        aria-label={t("settings.firstDayOfWeek")}
        value={weekStart}
        onChange={e => { void applySettings({ first_day_of_week: Number(e.currentTarget.value) as 0 | 1 | 6 }); }}
      >
        {([0, 1, 6] as const).map(d => (
          <option key={d} value={d}>{weekdayName(d)}</option>
        ))}
      </select>
    </SettingRow>
  );
}

export function SoundSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const soundOn = soundOnComplete(settings);
  return (
    <SettingRow title={t("settings.sound")} description={t("settings.soundSub")}>
      <ToggleSwitch
        label={t("settings.soundEnable")}
        checked={soundOn}
        onChange={on => { void applySettings({ sound_on_complete: on }); }}
      />
    </SettingRow>
  );
}

export function ReminderSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const reminderMinutes = reminderIntervalMinutes(settings);
  const { draft, setDraft, commit } = useClampedDraft(
    reminderMinutes, clampReminderInterval, n => { void applySettings({ reminder_interval_minutes: n }); },
  );
  return (
    <SettingRow title={t("settings.reminderInterval")} description={t("settings.reminderIntervalSub")}>
      <input
        type="number"
        className="weight-input"
        aria-label={t("settings.customReminderAria")}
        min={REMINDER_INTERVAL_MIN}
        max={REMINDER_INTERVAL_MAX}
        value={draft}
        onChange={e => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
    </SettingRow>
  );
}

export function AttachmentCapSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const maxAttachMb = maxAttachmentMb(settings);
  return (
    <SettingRow
      title={t("settings.maxAttachment")}
      description={t("settings.maxAttachmentSub")}
      footer={maxAttachMb > MAX_ATTACHMENT_MB_WARN && (
        <p className="settings-warn" role="status">{t("settings.maxAttachmentWarning")}</p>
      )}
    >
      <PresetSelect
        value={maxAttachMb}
        presets={[100, 512, 1024, 4096]}
        presetLabel={n => t("settings.megabytesPreset", { count: n })}
        ariaLabel={t("settings.maxAttachment")}
        customAriaLabel={t("settings.customMaxAttachmentAria")}
        min={MAX_ATTACHMENT_MB_MIN}
        max={MAX_ATTACHMENT_MB_MAX}
        clamp={clampMaxAttachmentMb}
        onChange={n => { void applySettings({ max_attachment_mb: n }); }}
      />
    </SettingRow>
  );
}

export function NewTagWeightSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const newTagWeight = defaultTagPriority(settings);
  const { draft, setDraft, commit } = useClampedDraft(
    newTagWeight, raw => clampWeight(String(raw)), n => { void applySettings({ default_tag_priority: n }); },
  );
  return (
    <SettingRow title={t("settings.newTagWeight")} description={t("settings.newTagWeightSub")}>
      <input
        type="number"
        className="weight-input"
        aria-label={t("settings.newTagWeight")}
        min={WEIGHT_MIN}
        max={WEIGHT_MAX}
        value={draft}
        onChange={e => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
    </SettingRow>
  );
}
