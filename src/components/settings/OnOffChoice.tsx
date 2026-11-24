import { useId } from "react";

type Props = {
  label: string;
  value: boolean;
  onLabel: string;
  offLabel: string;
  onChange: (on: boolean) => void;
  disabled?: boolean;
};

/** Labelled On/Off button pair, matching the other Settings choices. */
export function OnOffChoice({ label, value, onLabel, offLabel, onChange, disabled }: Props) {
  const id = useId();
  return (
    // A div, not a label: a label would forward clicks to its first button.
    <div className="te-field">
      <span id={id}>{label}</span>
      <div className="theme-options on-off-choice" role="group" aria-labelledby={id}>
        {([[true, onLabel], [false, offLabel]] as const).map(([on, text]) => (
          <button
            key={String(on)}
            type="button"
            className={`theme-option ${value === on ? "active" : ""}`}
            aria-pressed={value === on}
            disabled={disabled}
            onClick={() => { if (value !== on) onChange(on); }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
