## 1. Resolve theme background as the new-tag default

- [x] 1.1 Change `DEFAULT_TAG_COLOR` to the built-in light background `#f9fafb` and make `defaultTagColor(settings)` return the active theme’s `--c-bg` (ignore stored `default_tag_color`).
- [x] 1.2 Comment in `settings.ts` / `tauri.ts` that `default_tag_color` is kept for config compatibility only.
- [x] 1.3 Update `src/lib/settings.test.ts` for theme-background resolution (light/dark/custom) and that a stored `default_tag_color` is not used.

## 2. Color picker swatch

- [x] 2.1 Prepend an optional `themeSwatch` in `ColorPicker` when it is a valid hex not already in the static list.
- [x] 2.2 Pass the resolved background from `TagEditor` into `ColorPicker`.
- [x] 2.3 Update `ColorPicker.test.tsx` and `TagEditor.test.tsx` (new tags seed from theme background, not `default_tag_color`).

## 3. All create paths

- [x] 3.1 Change `resolveTagIds` to take a color (theme background) instead of `pickPaletteColor`; update `quickAdd.test.ts`.
- [x] 3.2 Pass the resolved background from `Composer` and `TaskEditor` into `resolveTagIds`.
- [x] 3.3 Preview pending new tags in `TagInput` with the same background instead of `pickPaletteColor`.

## 4. Verify

- [x] 4.1 Run `npm test -- settings ColorPicker TagEditor TagInput quickAdd` and `npm run lint`.
- [x] 4.2 `openspec validate default-tag-color --strict` passes.
