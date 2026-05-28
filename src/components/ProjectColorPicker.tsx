import clsx from "clsx";

const SWATCHES = [
  "#4338ca", "#06b6d4", "#10b981", "#84cc16",
  "#f59e0b", "#ef4444", "#ec4899", "#a855f7",
];

type Props = { value: string; onChange: (color: string) => void };

export function ProjectColorPicker({ value, onChange }: Props) {
  return (
    <div className="color-picker">
      {SWATCHES.map(c => (
        <button
          key={c}
          type="button"
          className={clsx("swatch", value === c && "swatch-active")}
          style={{ background: c }}
          aria-label={`Color ${c}`}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}
