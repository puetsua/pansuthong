## Why

A newly created tag currently prefills a slate hex (`#475569`) that is not a color from the active theme, so new chips look unrelated to the rest of the UI. The default should be the live theme **background** (`--c-bg`), and that same color should appear in the color picker's preset swatches.

## What Changes

- Seed a new tag's color from the **active theme's `--c-bg`** (built-in or custom, light or dark) at creation time. The hex is persisted on the tag and does not change later when the theme changes.
- Use that same background for every creation path: Tag editor, composer `#tag`, and task-editor "create tag".
- Show that background in the color picker's preset swatch list, even when it is not already one of the static swatches.
- Stop using the stored `default_tag_color` setting to seed new tags. The field stays in `config.json` for backward compatibility; no Settings UI is added or removed.
- Existing tags keep their colors.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `tag-management`: new-tag color defaults to the active theme background; the color picker includes that background among presets.
- `settings-and-appearance`: new-tag color is derived from the active theme rather than consumed from `default_tag_color`.

## Impact

- `src/lib/settings.ts` — `defaultTagColor` resolves `--c-bg` from the active theme (fallback: built-in light background `#f9fafb`).
- `src/components/ColorPicker.tsx` — include the theme background in the swatch list.
- `src/components/TagEditor.tsx` / `TagInput.tsx` — seed / preview with theme background.
- `src/state/quickAdd.ts` — auto-created tags use the theme background instead of the hashed palette.
- `src/components/Composer.tsx`, `src/components/TaskEditor.tsx` — pass the resolved background into tag creation.
- Tests for settings, ColorPicker, TagEditor, TagInput, quickAdd.
- No new Settings controls. No synced-model change. Rust `default_tag_color` field remains.
