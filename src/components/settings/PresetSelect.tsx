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

  // Follow the committed value: a non-preset shows as custom; a preset (typed
  // into the custom field, or set elsewhere) shows as that preset once the
  // field isn't being edited.
  useEffect(() => {
    if (!isPreset) setCustom(true);
    else if (document.activeElement !== inputRef.current) setCustom(false);
  }, [isPreset, value]);

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
          onBlur={() => {
            commit();
            // An unchanged commit doesn't re-run the sync effect, so return an
            // already-saved preset to the dropdown here. A changed value waits
            // for the saved prop (the effect), so a failed save never shows a
            // preset that isn't stored.
            const n = clamp(draft);
            if (n === value && presets.includes(n)) setCustom(false);
          }}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
      )}
    </>
  );
}
