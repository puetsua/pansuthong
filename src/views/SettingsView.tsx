import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, DataLocation, Document, SyncStatus } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { currentLocale } from "../i18n";
import { isAndroid } from "../lib/platform";
import {
  clampUpcomingDays, upcomingDays, UPCOMING_DAYS_MAX, UPCOMING_DAYS_MIN,
  dayStartHour, DAY_START_HOUR_MAX, DAY_START_HOUR_MIN,
  defaultTagPriority, soundOnComplete,
} from "../lib/settings";
import { clampWeight, WEIGHT_MAX, WEIGHT_MIN } from "../lib/tags";

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

  const theme = doc.settings.theme;
  const setTheme = (next: "auto" | "light" | "dark") => { void applySettings({ theme: next }); };
  const themeLabel: Record<"auto" | "light" | "dark", string> = {
    auto: t("settings.themeAuto"), light: t("settings.themeLight"), dark: t("settings.themeDark"),
  };

  const sortOrder = doc.settings.sort_order;
  const setSort = (s: "priority" | "date") => { void applySettings({ sort_order: s }); };
  const sortLabel: Record<"priority" | "date", string> = {
    priority: t("settings.sortPriority"), date: t("settings.sortDate"),
  };

  const language = doc.settings.language ?? "auto";
  const setLanguage = (next: "auto" | "en" | "zh-TW") => { void applySettings({ language: next }); };

  const soundOn = soundOnComplete(doc.settings);
  const setSound = (on: boolean) => { void applySettings({ sound_on_complete: on }); };

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

      <section className="settings-section">
        <h2>{t("settings.theme")}</h2>
        <div className="theme-options">
          {(["auto", "light", "dark"] as const).map(opt => (
            <button
              key={opt}
              className={`theme-option ${theme === opt ? "active" : ""}`}
              aria-pressed={theme === opt}
              onClick={() => setTheme(opt)}
            >
              {themeLabel[opt]}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("settings.language")}</h2>
        <p className="view-sub">{t("settings.languageSub")}</p>
        <div className="theme-options">
          {([["auto", t("settings.langAuto")], ["en", t("settings.langEn")], ["zh-TW", t("settings.langZhTW")]] as const).map(([opt, label]) => (
            <button
              key={opt}
              className={`theme-option ${language === opt ? "active" : ""}`}
              aria-pressed={language === opt}
              onClick={() => setLanguage(opt)}
            >
              {label}
            </button>
          ))}
        </div>
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
                  ? t("settings.lastSynced", { when: new Date(sync.last_synced_ms).toLocaleString(currentLocale()) })
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
