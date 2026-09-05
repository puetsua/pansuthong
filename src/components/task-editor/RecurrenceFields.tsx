import { useTranslation } from "react-i18next";
import { Tag } from "../../lib/tauri";
import { tagPillStyle } from "../../lib/tagColorDisplay";
import { useThemeVariant } from "../../lib/useThemeVariant";
import { EditorForm, maxDayForMonth, OFFSET_DAYS_MAX } from "../../state/taskUpdate";

type Props = {
  form: EditorForm;
  allTags: Map<string, Tag>;
  isStartOffsetDisabled: boolean;
  offsetError: string | null;
  recurError: string | null;
  set: <K extends keyof EditorForm>(k: K, v: EditorForm[K]) => void;
  setForm: (updater: (f: EditorForm) => EditorForm) => void;
};

export function RecurrenceFields({
  form, allTags, isStartOffsetDisabled, offsetError, recurError, set, setForm,
}: Props) {
  const { t } = useTranslation();
  const theme = useThemeVariant();
  const MONTHS = t("taskEditor.months", { returnObjects: true }) as string[];
  return (
    <>
      <div className="te-row">
        <label className="te-field">
          <span>{t("taskEditor.startInDays")}</span>
          <input type="number" min={0} max={OFFSET_DAYS_MAX} inputMode="numeric" placeholder="—"
                 value={isStartOffsetDisabled ? "" : form.start_offset_days}
                 disabled={isStartOffsetDisabled}
                 onChange={e => set("start_offset_days", e.currentTarget.value)} />
        </label>
        <label className="te-field">
          <span>{t("taskEditor.dueInDays")}</span>
          <input type="number" min={0} max={OFFSET_DAYS_MAX} inputMode="numeric" placeholder="—"
                 value={form.due_offset_days}
                 onChange={e => set("due_offset_days", e.currentTarget.value)} />
        </label>
      </div>
      {offsetError && <p className="te-warn" role="alert">{offsetError}</p>}
      <div className="te-field">
        <span>{t("taskEditor.repeat")}</span>
        <select value={form.repeat}
                onChange={e => set("repeat", e.currentTarget.value as EditorForm["repeat"])}>
          <option value="none">{t("taskEditor.repeatNone")}</option>
          <option value="daily">{t("taskEditor.repeatDaily")}</option>
          <option value="weekly">{t("taskEditor.repeatWeekly")}</option>
          <option value="monthly">{t("taskEditor.repeatMonthly")}</option>
          <option value="yearly">{t("taskEditor.repeatYearly")}</option>
        </select>
      </div>
      {form.repeat === "weekly" && (
        <div className="te-weekdays" role="group" aria-label={t("taskEditor.weekdaysAria")}>
          {([["taskEditor.weekdayMon",1],["taskEditor.weekdayTue",2],["taskEditor.weekdayWed",3],["taskEditor.weekdayThu",4],["taskEditor.weekdayFri",5],["taskEditor.weekdaySat",6],["taskEditor.weekdaySun",7]] as const).map(([labelKey, day]) => {
            const on = form.repeat_weekdays.includes(day);
            return (
              <button type="button" key={day} aria-pressed={on}
                      className={on ? "te-weekday on" : "te-weekday"}
                      onClick={() => set("repeat_weekdays",
                        on ? form.repeat_weekdays.filter(d => d !== day)
                           : [...form.repeat_weekdays, day])}>
                {t(labelKey)}
              </button>
            );
          })}
          <button type="button" className="te-weekday-preset"
                  onClick={() => set("repeat_weekdays", [1, 2, 3, 4, 5])}>
            {t("taskEditor.weekdaysPreset")}
          </button>
        </div>
      )}
      {form.repeat === "monthly" && (
        <label className="te-field">
          <span>{t("taskEditor.monthlyLabel")}</span>
          <input type="text" inputMode="numeric" placeholder={t("taskEditor.monthlyPlaceholder")}
                 value={form.repeat_days}
                 onChange={e => set("repeat_days", e.currentTarget.value)} />
        </label>
      )}
      {form.repeat === "yearly" && (
        <div className="te-field">
          <span>{t("taskEditor.yearlyLabel")}</span>
          <div className="te-yearly-dates">
            {form.repeat_dates.map((d, i) => (
              <div className="te-yearly-row" key={i}>
                <select aria-label={t("taskEditor.month")} value={d.month || ""}
                        onChange={e => set("repeat_dates", form.repeat_dates.map((x, j) =>
                          j === i ? { ...x, month: parseInt(e.currentTarget.value, 10) || 0 } : x))}>
                  <option value="">{t("taskEditor.monthPlaceholder")}</option>
                  {MONTHS.map((name, m) => <option key={name} value={m + 1}>{name}</option>)}
                </select>
                <input type="number" aria-label={t("taskEditor.day")} min={1}
                       max={maxDayForMonth(d.month || 1)} inputMode="numeric" placeholder={t("taskEditor.dayPlaceholder")}
                       value={d.day || ""}
                       onChange={e => set("repeat_dates", form.repeat_dates.map((x, j) =>
                         j === i ? { ...x, day: parseInt(e.currentTarget.value, 10) || 0 } : x))} />
                <button type="button" className="te-yearly-remove" aria-label={t("taskEditor.removeDate")}
                        onClick={() => set("repeat_dates", form.repeat_dates.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="te-yearly-add"
                    onClick={() => set("repeat_dates", [...form.repeat_dates, { month: 0, day: 0 }])}>
              {t("taskEditor.addDate")}
            </button>
          </div>
        </div>
      )}
      {form.repeat !== "none" && (
        <>
          <label className="te-field">
            <span>{t("taskEditor.recurrenceTag")}</span>
            <select value={form.recurrence_tag_id}
                    onChange={e => setForm(f => ({
                      ...f,
                      recurrence_tag_id: e.currentTarget.value,
                      start_offset_days: e.currentTarget.value ? "" : f.start_offset_days,
                    }))}>
              <option value="">{t("taskEditor.chooseTag")}</option>
              {form.tag_ids
                .map(id => allTags.get(id))
                .filter((tag): tag is Tag => tag !== undefined)
                .map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </label>
          {(() => {
            const recurTag = form.tag_ids.includes(form.recurrence_tag_id)
              ? allTags.get(form.recurrence_tag_id) : undefined;
            return recurTag ? (
              <p className="te-recur-tags">
                <span className="te-recur-tags-label">{t("taskEditor.recursUnder")}</span>
                <span className="task-tag"
                      style={tagPillStyle(recurTag.color, theme)}>{recurTag.name}</span>
              </p>
            ) : null;
          })()}
          <label className="te-field">
            <span>{t("taskEditor.recurrenceStartDate")}</span>
            <input type="date" value={form.recurrence_start_date}
                   onChange={e => set("recurrence_start_date", e.currentTarget.value)} />
          </label>
        </>
      )}
      {recurError && <p className="te-warn" role="alert">{recurError}</p>}
    </>
  );
}
