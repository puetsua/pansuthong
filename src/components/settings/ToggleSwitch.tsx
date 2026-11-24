type Props = {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
};

/** On/off setting rendered as a switch; the label text names it. */
export function ToggleSwitch({ label, checked, onChange, disabled }: Props) {
  return (
    <label className="settings-toggle">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        className="toggle-switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </label>
  );
}
