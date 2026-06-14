# Theme customization — design (#15)

## Problem

Today the theme is a fixed enum (`auto / light / dark`) with hardcoded color tokens.
Users cannot change any color or pick an alternate palette. Issue #15 asks for:

- A set of **preset themes** beyond the two built-ins.
- Independent **customization** of the light theme and the dark theme — editing the
  core color tokens — that persists.
- `auto` keeps following the OS, selecting the user's configured light/dark variant.

Constraint from the issue: **frontend-only theme logic, mobile-safe — no Rust theme logic.**
Rust only stores and shape-validates the new settings fields; it has no knowledge of
preset names or token semantics.

## Current state (verified)

- Colors are CSS custom properties in `src/styles/tokens.css`: light palette in `:root`
  (`:19-31`), dark palette duplicated in the `@media (prefers-color-scheme: dark)` block
  (`:34-48`) and `:root[data-theme="dark"]` (`:50-63`).
- `settings.theme` is the enum `"auto" | "light" | "dark"` (`src-tauri/src/model.rs`,
  TS mirror `src/lib/tauri.ts:9-22`), applied by setting/removing `data-theme` on `<html>`
  in `src/state/store.ts:54-58`.
- `update_settings` (`src-tauri/src/commands.rs:767+`) validates each field of
  `UpdateSettingsInput` additively; `is_hex_color` already exists and is used for
  `default_tag_color`.
- The Settings Theme UI is three preset-mode buttons only (`src/views/SettingsView.tsx:202-216`).

## Design

### Data model (additive — zero migration)

New optional `Settings` fields (Rust `#[serde(default)]`, TS optional keys):

| Field | Type | Meaning / default |
|-------|------|-------------------|
| `theme_preset` | `String` | Selected preset id; default `"default"`. |
| `theme_colors_light` | `HashMap<String,String>` | Per-token hex overrides for the light variant; default empty. |
| `theme_colors_dark` | `HashMap<String,String>` | Per-token hex overrides for the dark variant; default empty. |

- `theme` (auto/light/dark) is unchanged and orthogonal: it selects **which variant is
  active**. `theme_preset` + the two override maps define **what each variant looks like**.
- Overrides are stored independently per variant, satisfying "customize light and dark
  independently".
- **Rust stays theme-agnostic:** it does not know preset ids or token names. Validation:
  - `theme_preset`: non-empty, `<= 64` chars, characters in `[a-z0-9_-]`. (Frontend falls
    back to Default if the id isn't a known preset.)
  - override maps: every **value** must pass `is_hex_color`; every **key** is a short
    identifier (`<= 32` chars, `[a-z0-9_-]`). Token-name meaning is the frontend's concern.
  - Wholesale replace semantics: when an override map key is present in the patch it
    replaces the stored map; when absent the stored map is left unchanged. Clearing a single
    token = the frontend resends the full map without that key.

### Presets (`src/lib/themes.ts`, new)

A `THEME_PRESETS` record. Each preset is `{ id, name, light, dark }` where `light`/`dark`
are **complete** token maps (all 11 `--c-*` tokens + `color-scheme`). Ids are stable;
display names are i18n keys.

Shipped set (6):

1. **default** — today's indigo palette. `default.light`/`default.dark` reproduce the
   current `tokens.css` values **exactly**, so "Default + no overrides" is a pixel-identical
   no-op.
2. **slate** — cooler neutral greys, blue-grey accent.
3. **sepia** — warm paper light / warm-tinted dark.
4. **high_contrast** — maximum text/background contrast (accessibility).
5. **emerald** — green accent on neutral base.
6. **rose** — rose/plum accent on neutral base.

`tokens.css` remains the authoritative **default base**. Presets are data, not CSS.

### Editable tokens (curated 4)

Only these are exposed in the UI, per variant:

- `--c-accent`
- `--c-bg`
- `--c-surface`
- `--c-text`

The remaining 7 tokens (`--c-surface-2`, `--c-border`, `--c-text-muted`, `--c-text-subtle`,
`--c-accent-bg`, `--c-danger`, `--c-success`) come from the chosen preset's variant map and
are not individually editable. A single exported `EDITABLE_TOKENS` array is the source of
truth, used by both the UI and the resolver.

### Rendering (`src/state/store.ts`)

Replace the current `theme` effect with one that also applies inline tokens:

1. Determine the **active variant**:
   - `theme === "light"` → `"light"`; `theme === "dark"` → `"dark"`;
   - `theme === "auto"` → `matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"`.
2. Keep setting/removing `data-theme` as today (drives `color-scheme` + the CSS fallback
   before/independent of JS).
3. Compute `effective = preset[variant] ⊕ overrides[variant]` via a pure
   `resolveThemeVars(settings, variant)` in `themes.ts`:
   - look up the preset (fallback Default on unknown id),
   - start from its variant token map, layer the variant's override map (only known
     editable tokens; unknown keys ignored).
4. **Apply minimally:** if preset is `"default"` **and** the active variant has no
   overrides, remove any previously-set inline `--c-*` and apply nothing — today's behavior
   is byte-for-byte preserved. Otherwise set each token as an inline style property on
   `document.documentElement` (and `color-scheme`).
5. For `theme === "auto"`, add a `matchMedia` `change` listener so the variant re-resolves
   when the OS flips light/dark. Clean up on unmount / dependency change.

The effect depends on `theme`, `theme_preset`, and both override maps.

### UI (`src/views/SettingsView.tsx`, Theme section)

- Keep the auto/light/dark **mode** buttons unchanged.
- Add a **preset picker**: a row of buttons, one per preset, each showing the preset name
  and a small swatch (accent over surface). Selecting sets `theme_preset`.
- Add a **Customize colors** area with two labeled groups, **Light** and **Dark**. Each group
  has 4 rows — one per editable token — with a native `<input type="color">` bound to the
  effective value (override ?? preset[variant][token]) and a per-group **Reset to preset**
  button that clears that variant's override map.
- Editing a color sends the **full** override map for that variant (current map with the one
  token set). `<input type="color">` is supported in the Android webview → mobile-safe.

### i18n

New keys in `en` and `zh-TW`: `settings.themePreset`, the six preset display names,
`settings.customizeColors`, `settings.themeLightGroup` / `settings.themeDarkGroup`, the four
token labels (accent/background/surface/text), and `settings.resetToPreset`.

## Testing (TDD)

**Rust** (`commands.rs` tests, mirroring `update_settings_input_parses_*`):
- parses `theme_preset` / `theme_colors_light` / `theme_colors_dark` keys; absent → `None`.
- `update_settings` rejects a non-hex override value and an over-long / bad-char preset id.

**TS** (`themes.test.ts`, `tauri.test.ts`):
- `resolveThemeVars` returns the preset variant map when there are no overrides.
- overrides win over preset values; unknown override keys are ignored.
- unknown `theme_preset` falls back to Default.
- `default` + no overrides yields a map equal to the current token defaults (guards the
  no-op path).
- `tauri.ts` `Settings` / `updateSettings` types include the three new keys.

## Out of scope (YAGNI)

- Editing the other 7 tokens, contrast auto-correction, import/export of themes, gradient or
  image backgrounds, per-token reset (whole-variant reset only), arbitrary user-named presets.

## Files touched

- `src-tauri/src/model.rs` — 3 new `Settings` fields + defaults.
- `src-tauri/src/commands.rs` — `UpdateSettingsInput` fields, validation, apply; tests.
- `src/lib/themes.ts` *(new)* — presets, `EDITABLE_TOKENS`, `resolveThemeVars`.
- `src/lib/tauri.ts` — `Settings` + `updateSettings` type mirror.
- `src/lib/settings.ts` — accessors (`themePreset`, `themeColors`).
- `src/state/store.ts` — variant resolution + inline-var application + `matchMedia` listener.
- `src/views/SettingsView.tsx` — preset picker + color editors.
- `src/i18n/*` — new strings (en + zh-TW).
- Tests: `themes.test.ts`, `tauri.test.ts`, `commands.rs`.
</content>
