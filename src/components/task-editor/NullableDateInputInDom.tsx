import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  todayIso,
  formatIsoDate,
  formatIsoYearMonth,
  currentDateFormat,
} from "../../lib/dates";
import {
  buildEditorDatePickerWeeks,
  claimEditorDatePopover,
  shiftEditorDatePickerMonth,
} from "../../lib/editorDatePicker";
import { FIRST_DAY_OF_WEEK_DEFAULT } from "../../lib/settings";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAY_KEYS = [
  "taskEditor.weekdaySun", "taskEditor.weekdayMon", "taskEditor.weekdayTue",
  "taskEditor.weekdayWed", "taskEditor.weekdayThu", "taskEditor.weekdayFri",
  "taskEditor.weekdaySat",
] as const;

function shouldClearDateOnDeleteKey(el: HTMLInputElement): boolean {
  const v = el.value;
  if (!v) return false;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? v.length;
  return start === 0 && end === v.length;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
};

/** Task-editor date field without native modal picker (Linux WebKitGTK #237). */
export function NullableDateInputInDom({ value, onChange, "aria-label": ariaLabel }: Props) {
  const { t, i18n } = useTranslation();
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => (value || todayIso()).slice(0, 7));

  const close = () => setOpen(false);

  const openPopover = () => {
    setViewMonth((value || todayIso()).slice(0, 7));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const release = claimEditorDatePopover(close);
    const onDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      release();
    };
  }, [open]);

  const dateFmt = currentDateFormat();
  const display = value ? formatIsoDate(value, dateFmt, i18n.language) : "";
  const weeks = buildEditorDatePickerWeeks(viewMonth, FIRST_DAY_OF_WEEK_DEFAULT);
  const monthLabel = formatIsoYearMonth(viewMonth, dateFmt, i18n.language);
  const today = todayIso();

  const pick = (iso: string) => {
    onChange(iso);
    close();
    inputRef.current?.focus();
  };

  const empty = !value;

  return (
    <div className="te-date-popover-root" ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        className={empty ? "te-date-unset" : undefined}
        value={empty ? "" : display}
        readOnly={!empty}
        onClick={openPopover}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPopover();
            return;
          }
          if (empty) return;
          if (e.key !== "Backspace" && e.key !== "Delete") return;
          if (!shouldClearDateOnDeleteKey(e.currentTarget)) return;
          e.preventDefault();
          onChange("");
        }}
        onChange={e => {
          if (!empty) return;
          const v = e.currentTarget.value;
          if (ISO_DATE.test(v)) onChange(v);
        }}
      />
      {open && (
        <div
          id={popoverId}
          className="te-date-popover"
          role="dialog"
          aria-label={ariaLabel}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="te-date-popover-head">
            <button type="button" className="te-date-popover-nav" aria-label={t("calendar.prevMonth")}
                    onClick={() => setViewMonth(m => shiftEditorDatePickerMonth(m, -1))}>‹</button>
            <span className="te-date-popover-month">{monthLabel}</span>
            <button type="button" className="te-date-popover-nav" aria-label={t("calendar.nextMonth")}
                    onClick={() => setViewMonth(m => shiftEditorDatePickerMonth(m, 1))}>›</button>
          </div>
          <div className="te-date-popover-weekdays" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} className="te-date-popover-weekday">
                {t(WEEKDAY_KEYS[(FIRST_DAY_OF_WEEK_DEFAULT + i) % 7])}
              </span>
            ))}
          </div>
          <div className="te-date-popover-grid">
            {weeks.flat().map(cell => {
              const selected = cell.iso === value;
              const isToday = cell.iso === today;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  className={[
                    "te-date-popover-day",
                    !cell.inMonth ? "te-date-popover-day-out" : "",
                    selected ? "te-date-popover-day-selected" : "",
                    isToday ? "te-date-popover-day-today" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => pick(cell.iso)}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
