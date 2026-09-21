import { useEffect, useRef, useState } from "react";
import { dismissOpenDatePickersIn } from "../../lib/nativeDatePicker";
import { usePreferInDomTaskEditorDatePicker } from "../../lib/useLinuxDesktop";
import { NullableDateInputInDom } from "./NullableDateInputInDom";

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

function NullableDateInputNative({ value, onChange, "aria-label": ariaLabel }: Props) {
  const [picking, setPicking] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!picking || value) return;
    const el = dateRef.current;
    if (!el) return;
    const editor = el.closest(".task-editor");
    if (editor) dismissOpenDatePickersIn(editor, el);
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

/**
 * Optional calendar date (YYYY-MM-DD or ""). Linux desktop uses an in-DOM popover
 * instead of native `type=date` (WebKitGTK modal picker blocks Cancel, #237).
 * Other platforms keep the native control with empty-state text field (#217).
 */
export function NullableDateInput(props: Props) {
  const preferInDom = usePreferInDomTaskEditorDatePicker();
  if (preferInDom) return <NullableDateInputInDom {...props} />;
  return <NullableDateInputNative {...props} />;
}
