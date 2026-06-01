import clsx from "clsx";

// A curated palette spanning the hue wheel at a couple of lightness levels so
// users can tell many tags apart at a glance. `tag.color` is a free-form string,
// so the custom <input type="color"> below covers anything not in this set.
const SWATCHES = [
  "#4338ca", "#3b82f6", "#06b6d4", "#14b8a6", "#10b981", "#84cc16",
  "#eab308", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#d946ef",
  "#a855f7", "#8b5cf6", "#0ea5e9", "#22c55e", "#64748b", "#78716c",
];

const HEX = /^#[0-9a-f]{6}$/;
const DEFAULT_COLOR = SWATCHES[0];

type Props = { value: string; onChange: (color: string) => void };

export function ColorPicker({ value, onChange }: Props) {
  const normalized = value.toLowerCase();
  const customValue = HEX.test(normalized) ? normalized : DEFAULT_COLOR;

  return (
    <div className="color-picker">
      <div className="color-picker-swatches">
        {SWATCHES.map(c => {
          const active = normalized === c;
          return (
            <button
              key={c}
              type="button"
              className={clsx("swatch", active && "swatch-active")}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              aria-pressed={active}
              onClick={() => onChange(c)}
            />
          );
        })}
      </div>
      <label className="color-picker-custom">
        <input
          type="color"
          value={customValue}
          aria-label="Custom color"
          onChange={e => onChange(e.target.value)}
        />
        <span>Custom</span>
      </label>
    </div>
  );
}
