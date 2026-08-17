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
import { useClampedDraft } from "./useClampedDraft";

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
    <section className="settings-section">
      <h2>{t("settings.language")}</h2>
      <p className="view-sub">{t("settings.languageSub")}</p>
      <label className="te-field">
        <span>{t("settings.language")}</span>
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
      </label>
    </section>
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
    <section className="settings-section">
      <h2>{t("settings.dateTimeFormat")}</h2>
      <p className="view-sub">{t("settings.dateTimeFormatSub")}</p>
      <label className="te-field">
        <span>{t("settings.dateFormat")}</span>
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
      </label>
      <label className="te-field">
        <span>{t("settings.timeFormat")}</span>
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
      </label>
    </section>
  );
}

export function SortSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const sortOrder = settings.sort_order;
  const sortLabel: Record<"priority" | "date", string> = {
    priority: t("settings.sortPriority"), date: t("settings.sortDate"),
  };
  return (
    <section className="settings-section">
      <h2>{t("settings.sortOrder")}</h2>
      <p className="view-sub">
        {t("settings.sortSub")}
      </p>
      <div className="theme-options">
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
      </div>
    </section>
  );
}

export function UpcomingSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const days = upcomingDays(settings);
  const { draft, setDraft, commit } = useClampedDraft(
    days, clampUpcomingDays, n => { void applySettings({ upcoming_days: n }); },
  );
  return (
    <section className="settings-section">
      <h2>{t("settings.upcomingRange")}</h2>
      <p className="view-sub">{t("settings.upcomingSub")}</p>
      <div className="theme-options">
        {[7, 14, 30].map(n => (
          <button
            key={n}
            className={`theme-option ${days === n ? "active" : ""}`}
            aria-pressed={days === n}
            onClick={() => { void applySettings({ upcoming_days: n }); }}
          >
            {t("settings.daysPreset", { count: n })}
          </button>
        ))}
        <input
          type="number"
          className="weight-input"
          aria-label={t("settings.customUpcomingAria")}
          min={UPCOMING_DAYS_MIN}
          max={UPCOMING_DAYS_MAX}
          value={draft}
          onChange={e => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
      </div>
    </section>
  );
}

export function DayStartSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const startHour = dayStartHour(settings);
  return (
    <section className="settings-section">
      <h2>{t("settings.dayStart")}</h2>
      <p className="view-sub">
        {t("settings.dayStartSub")}
      </p>
      <label className="te-field">
        <span>{t("settings.dayStartsAt")}</span>
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
      </label>
    </section>
  );
}

export function HeatmapSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const heatDays = dashboardHeatmapDays(settings);
  const { draft, setDraft, commit } = useClampedDraft(
    heatDays, clampDashboardHeatmapDays, n => { void applySettings({ recurrence_heatmap_days: n }); },
  );
  return (
    <section className="settings-section">
      <h2>{t("settings.dashboardHeatmapRange")}</h2>
      <p className="view-sub">{t("settings.dashboardHeatmapSub")}</p>
      <div className="theme-options">
        {[30, 60, 90, 180].map(n => (
          <button
            key={n}
            className={`theme-option ${heatDays === n ? "active" : ""}`}
            aria-pressed={heatDays === n}
            onClick={() => { void applySettings({ recurrence_heatmap_days: n }); }}
          >
            {t("settings.daysPreset", { count: n })}
          </button>
        ))}
        <input
          type="number"
          className="weight-input"
          aria-label={t("settings.customHeatmapAria")}
          min={DASHBOARD_HEATMAP_DAYS_MIN}
          max={DASHBOARD_HEATMAP_DAYS_MAX}
          value={draft}
          onChange={e => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
      </div>
    </section>
  );
}

export function WeekStartSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const weekStart = firstDayOfWeek(settings);
  return (
    <section className="settings-section">
      <h2>{t("settings.firstDayOfWeek")}</h2>
      <p className="view-sub">{t("settings.firstDayOfWeekSub")}</p>
      <div className="theme-options">
        {([[0, t("taskEditor.weekdaySun")], [1, t("taskEditor.weekdayMon")], [6, t("taskEditor.weekdaySat")]] as const).map(([d, label]) => (
          <button
            key={d}
            className={`theme-option ${weekStart === d ? "active" : ""}`}
            aria-pressed={weekStart === d}
            onClick={() => { void applySettings({ first_day_of_week: d }); }}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function SoundSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const soundOn = soundOnComplete(settings);
  return (
    <section className="settings-section">
      <h2>{t("settings.sound")}</h2>
      <p className="view-sub">{t("settings.soundSub")}</p>
      <div className="theme-options">
        {([[true, t("settings.soundOn")], [false, t("settings.soundOff")]] as const).map(([on, label]) => (
          <button
            key={String(on)}
            className={`theme-option ${soundOn === on ? "active" : ""}`}
            aria-pressed={soundOn === on}
            onClick={() => { void applySettings({ sound_on_complete: on }); }}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function ReminderSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const reminderMinutes = reminderIntervalMinutes(settings);
  const { draft, setDraft, commit } = useClampedDraft(
    reminderMinutes, clampReminderInterval, n => { void applySettings({ reminder_interval_minutes: n }); },
  );
  return (
    <section className="settings-section">
      <h2>{t("settings.reminderInterval")}</h2>
      <p className="view-sub">{t("settings.reminderIntervalSub")}</p>
      <div className="theme-options">
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
      </div>
    </section>
  );
}

export function AttachmentCapSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const maxAttachMb = maxAttachmentMb(settings);
  const { draft, setDraft, commit } = useClampedDraft(
    maxAttachMb, clampMaxAttachmentMb, n => { void applySettings({ max_attachment_mb: n }); },
  );
  return (
    <section className="settings-section">
      <h2>{t("settings.maxAttachment")}</h2>
      <p className="view-sub">{t("settings.maxAttachmentSub")}</p>
      <div className="theme-options">
        {[100, 512, 1024, 4096].map(n => (
          <button
            key={n}
            className={`theme-option ${maxAttachMb === n ? "active" : ""}`}
            aria-pressed={maxAttachMb === n}
            onClick={() => { void applySettings({ max_attachment_mb: n }); }}
          >
            {t("settings.megabytesPreset", { count: n })}
          </button>
        ))}
        <input
          type="number"
          className="weight-input"
          aria-label={t("settings.customMaxAttachmentAria")}
          min={MAX_ATTACHMENT_MB_MIN}
          max={MAX_ATTACHMENT_MB_MAX}
          value={draft}
          onChange={e => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
      </div>
      {maxAttachMb > MAX_ATTACHMENT_MB_WARN && (
        <p className="view-sub settings-warn" role="status">{t("settings.maxAttachmentWarning")}</p>
      )}
    </section>
  );
}

export function NewTagWeightSection({ settings, applySettings }: SectionProps) {
  const { t } = useTranslation();
  const newTagWeight = defaultTagPriority(settings);
  const { draft, setDraft, commit } = useClampedDraft(
    newTagWeight, raw => clampWeight(String(raw)), n => { void applySettings({ default_tag_priority: n }); },
  );
  return (
    <section className="settings-section">
      <h2>{t("settings.newTagWeight")}</h2>
      <p className="view-sub">{t("settings.newTagWeightSub")}</p>
      <label className="te-field">
        <span>{t("settings.weight")}</span>
        <input
          type="number"
          className="weight-input"
          min={WEIGHT_MIN}
          max={WEIGHT_MAX}
          value={draft}
          onChange={e => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
      </label>
    </section>
  );
}
