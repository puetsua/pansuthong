import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, DataLocation, Document, SyncStatus } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { currentLocale } from "../i18n";
import { isAndroid } from "../lib/platform";
import { DATE_FORMATS, formatDate, formatDateTime, formatTime, TIME_FORMATS } from "../lib/dates";
import type { DateFormat, TimeFormat } from "../lib/dates";
import {
  clampUpcomingDays, upcomingDays, UPCOMING_DAYS_MAX, UPCOMING_DAYS_MIN,
  dayStartHour, DAY_START_HOUR_MAX, DAY_START_HOUR_MIN,
  defaultTagPriority, soundOnComplete,
  clampReminderInterval, reminderIntervalMinutes, REMINDER_INTERVAL_MAX, REMINDER_INTERVAL_MIN,
  clampMaxAttachmentMb, maxAttachmentMb, MAX_ATTACHMENT_MB_MAX, MAX_ATTACHMENT_MB_MIN, MAX_ATTACHMENT_MB_WARN,
  clampRecurrenceHeatmapDays, recurrenceHeatmapDays, RECURRENCE_HEATMAP_DAYS_MAX, RECURRENCE_HEATMAP_DAYS_MIN,
  firstDayOfWeek,
  dateFormat, timeFormat,
} from "../lib/settings";
import { clampWeight, WEIGHT_MAX, WEIGHT_MIN } from "../lib/tags";
import { ThemeSettings } from "../components/ThemeSettings";

type Props = { doc: Document };

/** A 24-hour clock hour as a friendly label, e.g. 0 -> "12:00 AM", 16 -> "4:00 PM". */
function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${period}`;
}

export function SettingsView({ doc }: Props) {
  const { t } = useTranslation();
  // Settings writes used to be fire-and-forget; surface a failure so a click that
  // didn't stick is visible rather than silently swallowed (#51).
  const [settingsErr, setSettingsErr] = useState<string | null>(null);
  const applySettings = async (patch: Parameters<typeof api.updateSettings>[0]) => {
    setSettingsErr(null);
    try {
      await api.updateSettings(patch);
    } catch (e) {
      setSettingsErr(errorMessage(e));
    }
  };

  const sortOrder = doc.settings.sort_order;
  const setSort = (s: "priority" | "date") => { void applySettings({ sort_order: s }); };
  const sortLabel: Record<"priority" | "date", string> = {
    priority: t("settings.sortPriority"), date: t("settings.sortDate"),
  };

  const language = doc.settings.language ?? "auto";
  const setLanguage = (next: "auto" | "en" | "zh-TW") => { void applySettings({ language: next }); };

  const locale = currentLocale();
  const exampleNow = new Date();
  const dateFmt = dateFormat(doc.settings);
  const timeFmt = timeFormat(doc.settings);
  const setDateFormat = (next: DateFormat) => {
    void applySettings({ date_format: next });
  };
  const setTimeFormat = (next: TimeFormat) => {
    void applySettings({ time_format: next });
  };
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

  const soundOn = soundOnComplete(doc.settings);
  const setSound = (on: boolean) => { void applySettings({ sound_on_complete: on }); };

  // Time-estimate reminder cadence: presets apply immediately; the free input
  // commits on blur/Enter. This is how often a still-running task re-notifies
  // once it passes its estimate.
  const reminderMinutes = reminderIntervalMinutes(doc.settings);
  const [draftReminder, setDraftReminder] = useState(String(reminderMinutes));
  useEffect(() => { setDraftReminder(String(reminderMinutes)); }, [reminderMinutes]);
  const setReminder = (n: number) => { void applySettings({ reminder_interval_minutes: n }); };
  const commitDraftReminder = () => {
    const n = clampReminderInterval(draftReminder);
    setDraftReminder(String(n));
    if (n !== reminderMinutes) setReminder(n);
  };

  // Largest attachment the user may add (MiB): presets apply immediately; the
  // free input commits on blur/Enter. A large cap is allowed but warned about.
  const maxAttachMb = maxAttachmentMb(doc.settings);
  const [draftMaxAttach, setDraftMaxAttach] = useState(String(maxAttachMb));
  useEffect(() => { setDraftMaxAttach(String(maxAttachMb)); }, [maxAttachMb]);
  const setMaxAttach = (n: number) => { void applySettings({ max_attachment_mb: n }); };
  const commitDraftMaxAttach = () => {
    const n = clampMaxAttachmentMb(draftMaxAttach);
    setDraftMaxAttach(String(n));
    if (n !== maxAttachMb) setMaxAttach(n);
  };

  // Upcoming horizon: presets apply immediately; the free input commits on blur/Enter.
  const days = upcomingDays(doc.settings);
  const [draftDays, setDraftDays] = useState(String(days));
  useEffect(() => { setDraftDays(String(days)); }, [days]); // resync when the doc changes
  const setUpcoming = (n: number) => { void applySettings({ upcoming_days: n }); };
  const commitDraftDays = () => {
    const n = clampUpcomingDays(draftDays);
    setDraftDays(String(n));
    if (n !== days) setUpcoming(n);
  };

  // Day-start hour: the Today view rolls over at this hour instead of midnight,
  // for people who treat the late-night hours as still "yesterday".
  const startHour = dayStartHour(doc.settings);
  const setStartHour = (h: number) => { void applySettings({ day_start_hour: h }); };

  // Recurrence dashboard heatmap range (#recurrence-dashboard): presets apply
  // immediately; the free input commits on blur/Enter. Controls how far back the
  // dashboard's heatmap reaches (ending today).
  const weekStart = firstDayOfWeek(doc.settings);
  const setWeekStart = (d: number) => { void applySettings({ first_day_of_week: d }); };

  const heatDays = recurrenceHeatmapDays(doc.settings);
  const [draftHeat, setDraftHeat] = useState(String(heatDays));
  useEffect(() => { setDraftHeat(String(heatDays)); }, [heatDays]);
  const setHeatDays = (n: number) => { void applySettings({ recurrence_heatmap_days: n }); };
  const commitDraftHeat = () => {
    const n = clampRecurrenceHeatmapDays(draftHeat);
    setDraftHeat(String(n));
    if (n !== heatDays) setHeatDays(n);
  };

  // New-tag default weight (#79): commits on blur/Enter. (The default color is
  // fixed, not user-configurable — new tags start from a neutral gray.)
  const newTagWeight = defaultTagPriority(doc.settings);
  const [draftTagWeight, setDraftTagWeight] = useState(String(newTagWeight));
  useEffect(() => { setDraftTagWeight(String(newTagWeight)); }, [newTagWeight]);
  const commitDraftTagWeight = () => {
    const n = clampWeight(draftTagWeight);
    setDraftTagWeight(String(n));
    if (n !== newTagWeight) void applySettings({ default_tag_priority: n });
  };

  const [android, setAndroid] = useState(false);
  const [loc, setLoc] = useState<DataLocation | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void isAndroid().then(setAndroid); }, []);
  useEffect(() => { void api.getDataLocation().then(setLoc).catch(() => {}); }, []);
  useEffect(() => { if (android) void api.safStatus().then(setSync).catch(() => {}); }, [android]);

  const pick = async () => {
    setBusy(true); setErr(null);
    try {
      const next = await api.pickAndSetDataFolder();
      if (next) setLoc(next);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setErr(null);
    try { setLoc(await api.clearDataFolder()); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  // Android SAF folder sync (#Phase 4B).
  const pickSaf = async () => {
    setBusy(true); setErr(null);
    try { setSync(await api.safPickFolder()); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const syncNowSaf = async () => {
    setBusy(true); setErr(null);
    try { setSync(await api.safSyncNow()); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const unlinkSaf = async () => {
    setBusy(true); setErr(null);
    try { await api.safClearFolder(); setSync(await api.safStatus()); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <section>
      <header className="view-header">
        <h1>{t("settings.title")}</h1>
      </header>

      {settingsErr && <p className="composer-error" role="alert">{t("settings.saveError", { error: settingsErr })}</p>}

      <ThemeSettings settings={doc.settings} applySettings={applySettings} />

      <section className="settings-section">
        <h2>{t("settings.language")}</h2>
        <p className="view-sub">{t("settings.languageSub")}</p>
        <label className="te-field">
          <span>{t("settings.language")}</span>
          <select
            className="select-input"
            aria-label={t("settings.language")}
            value={language}
            onChange={e => setLanguage(e.currentTarget.value as "auto" | "en" | "zh-TW")}
          >
            <option value="auto">{t("settings.langAuto")}</option>
            <option value="en">{t("settings.langEn")}</option>
            <option value="zh-TW">{t("settings.langZhTW")}</option>
          </select>
        </label>
      </section>

      <section className="settings-section">
        <h2>{t("settings.dateTimeFormat")}</h2>
        <p className="view-sub">{t("settings.dateTimeFormatSub")}</p>
        <label className="te-field">
          <span>{t("settings.dateFormat")}</span>
          <select
            className="select-input"
            aria-label={t("settings.dateFormat")}
            value={dateFmt}
            onChange={e => setDateFormat(e.currentTarget.value as DateFormat)}
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
            onChange={e => setTimeFormat(e.currentTarget.value as TimeFormat)}
          >
            {TIME_FORMATS.map(opt => (
              <option key={opt} value={opt}>
                {timeFmtLabel[opt]} ({formatTime(exampleNow, opt, locale)})
              </option>
            ))}
          </select>
        </label>
      </section>

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
              onClick={() => setSort(s)}
            >
              {sortLabel[s]}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("settings.upcomingRange")}</h2>
        <p className="view-sub">{t("settings.upcomingSub")}</p>
        <div className="theme-options">
          {[7, 14, 30].map(n => (
            <button
              key={n}
              className={`theme-option ${days === n ? "active" : ""}`}
              aria-pressed={days === n}
              onClick={() => setUpcoming(n)}
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
            value={draftDays}
            onChange={e => setDraftDays(e.currentTarget.value)}
            onBlur={commitDraftDays}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        </div>
      </section>

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
            onChange={e => setStartHour(Number(e.currentTarget.value))}
          >
            {Array.from({ length: DAY_START_HOUR_MAX - DAY_START_HOUR_MIN + 1 }, (_, i) => i + DAY_START_HOUR_MIN).map(h => (
              <option key={h} value={h}>
                {hourLabel(h)}{h === 0 ? t("settings.midnight") : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="settings-section">
        <h2>{t("settings.recurrenceHeatmapRange")}</h2>
        <p className="view-sub">{t("settings.recurrenceHeatmapSub")}</p>
        <div className="theme-options">
          {[30, 60, 90, 180].map(n => (
            <button
              key={n}
              className={`theme-option ${heatDays === n ? "active" : ""}`}
              aria-pressed={heatDays === n}
              onClick={() => setHeatDays(n)}
            >
              {t("settings.daysPreset", { count: n })}
            </button>
          ))}
          <input
            type="number"
            className="weight-input"
            aria-label={t("settings.customHeatmapAria")}
            min={RECURRENCE_HEATMAP_DAYS_MIN}
            max={RECURRENCE_HEATMAP_DAYS_MAX}
            value={draftHeat}
            onChange={e => setDraftHeat(e.currentTarget.value)}
            onBlur={commitDraftHeat}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("settings.firstDayOfWeek")}</h2>
        <p className="view-sub">{t("settings.firstDayOfWeekSub")}</p>
        <div className="theme-options">
          {([[0, t("taskEditor.weekdaySun")], [1, t("taskEditor.weekdayMon")], [6, t("taskEditor.weekdaySat")]] as const).map(([d, label]) => (
            <button
              key={d}
              className={`theme-option ${weekStart === d ? "active" : ""}`}
              aria-pressed={weekStart === d}
              onClick={() => setWeekStart(d)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("settings.sound")}</h2>
        <p className="view-sub">{t("settings.soundSub")}</p>
        <div className="theme-options">
          {([[true, t("settings.soundOn")], [false, t("settings.soundOff")]] as const).map(([on, label]) => (
            <button
              key={String(on)}
              className={`theme-option ${soundOn === on ? "active" : ""}`}
              aria-pressed={soundOn === on}
              onClick={() => setSound(on)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("settings.reminderInterval")}</h2>
        <p className="view-sub">{t("settings.reminderIntervalSub")}</p>
        <div className="theme-options">
          {[5, 10, 15, 30].map(n => (
            <button
              key={n}
              className={`theme-option ${reminderMinutes === n ? "active" : ""}`}
              aria-pressed={reminderMinutes === n}
              onClick={() => setReminder(n)}
            >
              {t("settings.minutesPreset", { count: n })}
            </button>
          ))}
          <input
            type="number"
            className="weight-input"
            aria-label={t("settings.customReminderAria")}
            min={REMINDER_INTERVAL_MIN}
            max={REMINDER_INTERVAL_MAX}
            value={draftReminder}
            onChange={e => setDraftReminder(e.currentTarget.value)}
            onBlur={commitDraftReminder}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("settings.maxAttachment")}</h2>
        <p className="view-sub">{t("settings.maxAttachmentSub")}</p>
        <div className="theme-options">
          {[100, 512, 1024, 4096].map(n => (
            <button
              key={n}
              className={`theme-option ${maxAttachMb === n ? "active" : ""}`}
              aria-pressed={maxAttachMb === n}
              onClick={() => setMaxAttach(n)}
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
            value={draftMaxAttach}
            onChange={e => setDraftMaxAttach(e.currentTarget.value)}
            onBlur={commitDraftMaxAttach}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        </div>
        {maxAttachMb > MAX_ATTACHMENT_MB_WARN && (
          <p className="view-sub settings-warn" role="status">{t("settings.maxAttachmentWarning")}</p>
        )}
      </section>

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
            value={draftTagWeight}
            onChange={e => setDraftTagWeight(e.currentTarget.value)}
            onBlur={commitDraftTagWeight}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        </label>
      </section>

      <section className="settings-section">
        <h2>{t("settings.dataFile")}</h2>
        <p className="view-sub">
          {t("settings.tasksPersist")}<code>{loc?.effective_path ?? "…"}</code>
        </p>
        {android ? (
          sync?.linked ? (
            <>
              <p className="view-sub">
                {t("settings.syncedFolder")}<code>{sync.folder_label ?? t("settings.linked")}</code>
                {!sync.permission_ok && t("settings.accessLost")}
              </p>
              <p className="view-sub">
                {sync.last_synced_ms
                  ? t("settings.lastSynced", { when: formatDateTime(sync.last_synced_ms, dateFmt, timeFmt, locale) })
                  : t("settings.notSyncedYet")}
                {sync.conflict_count > 0 && t("settings.conflictCount", { count: sync.conflict_count })}
                {sync.last_error && t("settings.syncError", { error: sync.last_error })}
              </p>
              <div className="theme-options">
                <button className="theme-option" disabled={busy} onClick={syncNowSaf}>{t("settings.syncNow")}</button>
                <button className="theme-option" disabled={busy} onClick={pickSaf}>{t("settings.changeFolder")}</button>
                <button className="theme-option" disabled={busy} onClick={unlinkSaf}>{t("settings.unlink")}</button>
              </div>
            </>
          ) : (
            <>
              <p className="view-sub">
                {t("settings.pickFolderHintAndroid")}
              </p>
              <button className="theme-option" disabled={busy} onClick={pickSaf}>{t("settings.pickFolder")}</button>
            </>
          )
        ) : (
          <>
            <p className="view-sub">
              {t("settings.desktopHint")}
            </p>
            <div className="theme-options">
              <button className="theme-option" disabled={busy} onClick={pick}>{t("settings.chooseFolder")}</button>
              {loc?.folder && (
                <button className="theme-option" disabled={busy} onClick={reset}>{t("settings.useDefault")}</button>
              )}
            </div>
          </>
        )}
        {err && <p className="view-sub" style={{ color: "var(--c-danger)" }}>{err}</p>}
      </section>
    </section>
  );
}
