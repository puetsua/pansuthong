type Props = {
  /** Accessible name; the setting row's title is the visible label. */
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
};

/** On/off setting rendered as a switch. */
export function ToggleSwitch({ label, checked, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      className="toggle-switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}
