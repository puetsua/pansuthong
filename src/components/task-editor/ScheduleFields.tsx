import { useTranslation } from "react-i18next";
import { EditorForm } from "../../state/taskUpdate";

type Props = {
  form: EditorForm;
  dateError: string | null;
  estimateError: string | null;
  showEstimate: boolean;
  set: <K extends keyof EditorForm>(k: K, v: EditorForm[K]) => void;
  setForm: (updater: (f: EditorForm) => EditorForm) => void;
};

export function ScheduleFields({ form, dateError, estimateError, showEstimate, set, setForm }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <div className="te-row">
        <label className="te-field">
          <span>{t("taskEditor.startDate")}</span>
          <div className="te-datetime">
            <input type="date" value={form.start_date}
                   onChange={e => { const v = e.currentTarget.value; setForm(f => ({
                     ...f,
                     start_date: v,
                     start_time: v ? f.start_time : "",
                   })); }} />
            <input type="time" aria-label={t("taskEditor.startTime")} className="te-time"
                   value={form.start_time} disabled={!form.start_date}
                   onChange={e => set("start_time", e.currentTarget.value)} />
          </div>
        </label>
        <label className="te-field">
          <span>{t("taskEditor.dueDate")}</span>
          <div className="te-datetime">
            <input type="date" value={form.due_date}
                   onChange={e => { const v = e.currentTarget.value; setForm(f => ({
                     ...f,
                     due_date: v,
                     due_time: v ? f.due_time : "",
                   })); }} />
            <input type="time" aria-label={t("taskEditor.dueTime")} className="te-time"
                   value={form.due_time} disabled={!form.due_date}
                   onChange={e => set("due_time", e.currentTarget.value)} />
          </div>
        </label>
      </div>
      {dateError && <p className="te-warn" role="alert">{dateError}</p>}
      {showEstimate && (
        <>
          <label className="te-field">
            <span>{t("taskEditor.estimatedSeconds")}</span>
            <input type="text" inputMode="text" placeholder={t("taskEditor.estimatedSecondsPlaceholder")}
                   value={form.estimated_seconds}
                   onChange={e => set("estimated_seconds", e.currentTarget.value)} />
          </label>
          {estimateError && <p className="te-warn" role="alert">{estimateError}</p>}
        </>
      )}
    </>
  );
}
