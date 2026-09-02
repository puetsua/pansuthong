## Context

New tags were seeded from `defaultTagColor(settings)`, which returned `settings.default_tag_color` or a built-in slate `#475569`. The first cut of this change used `--c-accent`; after evaluating in the DEV app the default is the theme **background** `--c-bg` instead. The ColorPicker static list does not include typical `--c-bg` hexes (`#f9fafb` light, `#0f172a` dark), so they must be injected as an extra swatch.

Theme tokens live in `src/lib/themes.ts`. Tag colors are persisted as hex on the tag entity (not CSS variables), so a tag created in dark mode keeps that hex after switching to light.

There is a Settings control for new-tag **weight** but none for new-tag **color**. This change does not add one.

## Goals / Non-Goals

**Goals:**
- Resolve the color for a brand-new tag from the active theme’s `--c-bg` at creation time.
- Use that color on every creation path (Tag editor, composer `#tag`, task-editor create).
- Show that background as a selectable swatch in the ColorPicker even when it is not in the static palette.
- Leave existing tags and the `default_tag_color` config field in place.

**Non-Goals:**
- No Settings UI for default tag color.
- No migration of existing tags.
- Tags do not restyle when the theme later changes.
- Do not remove `default_tag_color` from config/API (backward compatible).
- Do not change tag-weight defaults.

## Decisions

- **Resolve `--c-bg` from theme tokens, not from `default_tag_color`.** `defaultTagColor(settings)` calls `activeVariant` + `resolveThemeVars` and returns `--c-bg` (normalized `#rrggbb`). Fallback: built-in light background `#f9fafb`. Token is `NEW_TAG_COLOR_TOKEN`. Alternatives considered: `--c-accent` (evaluated, then rejected); `--c-surface` / `--c-accent-bg` (not requested).
- **Ignore stored `default_tag_color` when seeding.** The field remains in `config.json`. Creation no longer reads it, so existing DEV installs show the live background without a config migration.
- **Pass the resolved hex into `resolveTagIds`.** `resolveTagIds(names, byName, addTag, color)` with default `defaultTagColor()`. Drop hashed `TAG_PALETTE` / `pickPaletteColor` from the create path.
- **ColorPicker prepends the theme background when missing.** Static `SWATCHES` stay as-is. Optional `themeSwatch` is prepended if it is a valid hex not already in the list.
- **Frontend-only.** Rust factory `default_tag_color` is unused by the create path. No schema change.

## Risks / Trade-offs

- [Chip fill matches the page background, so light chips can blend into the light UI (no chip border)] → Accept for evaluation; `readableTextColor` still picks dark ink on light fills. User can pick another swatch in one click.
- [Every auto-created `#tag` is the same color until edited] → Accept; user chose this over the hashed palette.
- [Opening Tag editor, then switching theme, does not restyle an already-seeded form] → Seed once at mount.
- [Dead `default_tag_color` field] → Comment that creation uses theme background; field kept for config compatibility.

## Migration Plan

No data migration. Deploy with the frontend. Rollback is revert. Existing tags unchanged.

## Open Questions

- None. Token is `--c-bg` after in-app evaluation of `--c-accent`.
