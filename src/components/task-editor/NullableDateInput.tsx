import { useEffect, useRef, useState } from "react";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** WebKitGTK `type=date` often ignores Backspace/Delete; treat as clear when whole field (#221). */
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

/**
 * Optional calendar date (YYYY-MM-DD or ""). WebKitGTK renders "today" for
 * `<input type="date" value="">` even when the value is empty; use a plain text
 * field until a date is set or the user opens the native picker (#217).
 */
export function NullableDateInput({ value, onChange, "aria-label": ariaLabel }: Props) {
  const [picking, setPicking] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!picking || value) return;
    const el = dateRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    try {
      el.showPicker();
    } catch {
      // showPicker unsupported (e.g. jsdom)
    }
  }, [picking, value]);

  if (value || picking) {
    return (
      <input
        ref={dateRef}
        type="date"
        aria-label={ariaLabel}
        value={value}
        onChange={e => {
          const v = e.currentTarget.value;
          onChange(v);
          if (!v) setPicking(false);
        }}
        onBlur={e => {
          if (!e.currentTarget.value) setPicking(false);
        }}
        onKeyDown={e => {
          if (e.key !== "Backspace" && e.key !== "Delete") return;
          if (!shouldClearDateOnDeleteKey(e.currentTarget)) return;
          e.preventDefault();
          onChange("");
          setPicking(false);
        }}
      />
    );
  }

  return (
    <input
      type="text"
      aria-label={ariaLabel}
      className="te-date-unset"
      value=""
      onChange={e => {
        const v = e.currentTarget.value;
        if (ISO_DATE.test(v)) onChange(v);
      }}
      onClick={() => setPicking(true)}
    />
  );
}
