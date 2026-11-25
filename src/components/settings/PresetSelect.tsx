import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClampedDraft } from "./useClampedDraft";

type Props = {
  value: number;
  presets: readonly number[];
  /** Option text for a preset, e.g. "14 days". */
  presetLabel: (n: number) => string;
  ariaLabel: string;
  customAriaLabel: string;
  min: number;
  max: number;
  clamp: (raw: string | number) => number;
  onChange: (n: number) => void;
};

const CUSTOM = "custom";

/** Dropdown of common values plus "Custom…", which reveals a number field. */
export function PresetSelect({
  value, presets, presetLabel, ariaLabel, customAriaLabel, min, max, clamp, onChange,
}: Props) {
  const { t } = useTranslation();
  const isPreset = presets.includes(value);
  const [custom, setCustom] = useState(!isPreset);
  const inputRef = useRef<HTMLInputElement>(null);
  const { draft, setDraft, commit } = useClampedDraft(value, clamp, onChange);

  // A value set elsewhere that isn't a preset must show as custom.
  useEffect(() => { if (!isPreset) setCustom(true); }, [isPreset]);

  return (
    <>
      <select
        className="select-input"
        aria-label={ariaLabel}
        value={custom ? CUSTOM : String(value)}
        onChange={e => {
          const v = e.currentTarget.value;
          if (v === CUSTOM) {
            setCustom(true);
            requestAnimationFrame(() => inputRef.current?.focus());
            return;
          }
          setCustom(false);
          onChange(Number(v));
        }}
      >
        {presets.map(n => <option key={n} value={n}>{presetLabel(n)}</option>)}
        <option value={CUSTOM}>{t("settings.customOption")}</option>
      </select>
      {custom && (
        <input
          ref={inputRef}
          type="number"
          className="weight-input"
          aria-label={customAriaLabel}
          min={min}
          max={max}
          value={draft}
          onChange={e => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
      )}
    </>
  );
}
