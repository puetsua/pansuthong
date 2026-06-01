import clsx from "clsx";

// A curated palette spanning the hue wheel so users can tell many tags apart at
// a glance. Every swatch is dark enough that the chip's auto-contrast text lands
// on white (see readableTextColor), keeping chips legible. `tag.color` is a
// free-form string, so the custom <input type="color"> below covers anything not
// in this set.
const SWATCHES = [
  "#4338ca", "#1d4ed8", "#0891b2", "#0d9488", "#059669", "#4d7c0f",
  "#a16207", "#b45309", "#c2410c", "#dc2626", "#db2777", "#c026d3",
  "#9333ea", "#7c3aed", "#0284c7", "#16a34a", "#475569", "#57534e",
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
