## Why

Pansutong’s UI is fully themed via CSS tokens, but scrollable regions still use the WebView’s native scrollbar chrome. On Windows desktop especially, that OS chrome clashes with dark and custom themes and breaks the polished look established by the custom titlebar and surface styling. A thin, token-driven scrollbar keeps chrome consistent without adding settings surface area.

Separately, activity heatmaps currently grow to the full configured day range and scroll horizontally when the panel is narrow. Prefer showing fewer (more recent) weeks so the grid stays fully visible without a horizontal scrollbar.

## What Changes

- Style all app scrollbars (vertical and horizontal) with theme tokens so track/thumb match the active light/dark/custom preset.
- Prefer a thin, low-contrast scrollbar that stays usable on hover/active without dominating the layout.
- Cover the main scroll containers (task lists, sidebars, modals, editors, etc.) via shared CSS rather than per-component one-offs.
- Keep native scroll behavior (wheel, touch, keyboard, programmatic) unchanged; this is visual chrome only.
- No new Settings section or user preference — themed scrollbars are always on with the active theme.
- When a heatmap cannot fit its container width, show fewer week columns (keep the most recent weeks ending today) instead of forcing horizontal scroll. The Settings heatmap range remains an upper bound, not a guarantee that every week is painted.

## Capabilities

### New Capabilities
- `ui-scrollbar`: Themed scrollbar appearance for scrollable surfaces across desktop and Android WebViews, driven by existing theme tokens.

### Modified Capabilities
- `analytics-dashboard`: Heatmaps fit available width by truncating older weeks rather than scrolling horizontally.

## Impact

- Frontend CSS primarily (`src/styles/global.css`) for scrollbar theming.
- Heatmap layout in `src/components/HeatmapGrid.tsx` (and related CSS under `.heatmap`) to measure width and limit visible weeks; callers that pass a full cell range keep working — the grid clips for display.
- Theme system (`src/lib/themes.ts`) only if dedicated scrollbar tokens are added; default plan is to derive from existing `--c-*` tokens so presets and the theme editor stay unchanged.
- No Rust/Tauri, model, sync, or Settings API changes (`recurrence_heatmap_days` semantics stay “max days back”).
- Affects WebView2 (desktop) and Android WebView; both support `::-webkit-scrollbar` styling. Standard `scrollbar-color` / `scrollbar-width` used where helpful for broader coverage.
