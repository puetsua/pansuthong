## Context

Pansuthong themes the entire UI through CSS custom properties (`--c-bg`, `--c-surface`, `--c-border`, `--c-text-muted`, etc.) applied from `src/lib/themes.ts`. Scrollable regions (`overflow: auto` / `overflow-y: auto`) still render the WebView’s default scrollbar, which on Windows WebView2 is a thick, OS-styled bar that ignores the app theme — especially jarring in dark and custom presets.

The app already has many scroll containers in `src/styles/global.css` (task lists, nav, modals, editors, analytics). A shared CSS approach is enough for scrollbar theming.

Heatmaps (`.heatmap` in `HeatmapGrid`) currently use `overflow-x: auto` and render every week in the configured `recurrence_heatmap_days` window. On narrow panels that produces a horizontal scrollbar instead of a glanceable grid. Product preference: show less history when space is tight.

## Goals / Non-Goals

**Goals:**
- Theme scrollbar track and thumb with existing color tokens so they follow light/dark/custom presets automatically.
- Use a thin scrollbar that remains easy to grab on desktop without stealing layout width aggressively.
- Apply globally to scrollable content in the app shell (desktop and Android WebViews).
- Preserve all native scrolling input (wheel, touch, keyboard, drag).
- Fit heatmaps to available width by showing fewer recent weeks (no horizontal scroll as the primary overflow strategy).

**Non-Goals:**
- Custom JS scrollbar libraries or overlay scroll components.
- A Settings toggle or per-user scrollbar preference (would need explicit approval for a new Settings control).
- New theme-editor tokens for scrollbar colors (derive from existing `--c-*` tokens).
- Changing scroll container structure or virtualization for task lists.
- Changing `recurrence_heatmap_days` bounds, defaults, or Settings UI — it remains the maximum range to compute; visible weeks may be fewer.
- Styling OS-level chrome outside the WebView (titlebar already handled separately).

## Decisions

### 1. Global CSS pseudo-elements, not a component library

**Choice:** Add `::-webkit-scrollbar*` rules (and `scrollbar-width` / `scrollbar-color` where useful) in `src/styles/global.css`, scoped to the document so every `overflow: auto|scroll` region inherits them.

**Why:** WebView2 and Android WebView are Chromium-based and honor webkit scrollbar pseudo-elements. One stylesheet change covers all existing and future scroll containers without touching React trees.

**Alternatives considered:**
- Per-class utility (e.g. `.themed-scroll`) — more explicit, but easy to miss containers and duplicates work.
- Overlay JS scrollbar — heavier, breaks accessibility/native feel, unnecessary for this polish pass.

### 2. Derive colors from existing tokens

**Choice:** Map thumb to a muted border/text token (e.g. `--c-border` idle, slightly stronger on hover) and track to transparent or `--c-surface-2` / `--c-bg` so it blends with the panel.

**Why:** Custom presets and the theme editor keep working with zero schema or `THEME_TOKENS` changes. Scrollbars always match the active theme.

**Alternatives considered:**
- Dedicated `--c-scrollbar-*` tokens — more control, but expands the theme contract and editor UI without clear user demand.

### 3. Thin width, always visible when content overflows

**Choice:** Use a thin fixed width (roughly 8–10px) via `::-webkit-scrollbar { width/height }` and `scrollbar-width: thin`. Do not auto-hide via overlay tricks that fight WebView behavior.

**Why:** Predictable hit targets on desktop; thin enough to feel modern. Overlay/auto-hide scrollbars are inconsistent across WebView versions and hurt discoverability.

### 4. No Settings surface for scrollbars

**Choice:** Always-on themed scrollbars; no config key.

**Why:** AGENTS.md requires explicit approval for new Settings sections/controls. Visual chrome consistency does not need a preference for v1.

### 5. Heatmap fits width by dropping older weeks

**Choice:** In `HeatmapGrid`, measure the available width (ResizeObserver or equivalent), compute how many week columns fit given cell size, weekday gutter, and gaps, and render only the trailing weeks that fit (always including today). Drop `overflow-x: auto` as the intended overflow mode (use `hidden` or no overflow). Keep computing/passing the full settings-bounded cell list from callers if convenient; the grid truncates for display.

**Why:** A GitHub-style heatmap is meant to be scanned at a glance. Horizontal scrolling hides older weeks behind chrome and fights the custom-scrollbar polish. Truncating from the past preserves the useful “recent activity” end.

**Alternatives considered:**
- Shrink cell size to fit all weeks — becomes unreadable on narrow panels.
- Keep horizontal scroll with themed scrollbar — works, but user preference is to show less instead.
- Change Settings range automatically — mutates user preference; wrong layer. Visible weeks are a layout concern.

## Risks / Trade-offs

- **[Risk] Webkit-only styling looks different if a non-Chromium host appears** → Mitigation: also set standard `scrollbar-color` / `scrollbar-width` on `*` or `html` for graceful fallback; current targets are Chromium WebViews.
- **[Risk] Very light themes make a border-colored thumb hard to see** → Mitigation: pick tokens with enough contrast against typical surfaces; verify against built-in presets (default, slate, parchment, high-contrast, etc.) during manual QA.
- **[Risk] Narrow scrollbars harder to grab** → Mitigation: keep ~8–10px and a clearer hover/active thumb state; do not go to 4px “hairline” widths.
- **[Risk] Very narrow panels show only a few weeks** → Mitigation: always keep at least one week (today’s); accept short history as correct for the space.
- **[Risk] Resize flicker while measuring** → Mitigation: measure before paint where possible; clamp week count with a stable formula from `--heat-cell` and known gutters.

## Migration Plan

1. Land scrollbar CSS in `global.css`; no data migration.
2. Update `HeatmapGrid` (+ `.heatmap` CSS) to fit-to-width truncation; no settings migration.
3. Smoke-test on **Pansuthong Dev** desktop: long task list, Settings/modals, theme switch; narrow the window on Tag/Recurrence heatmap and confirm older weeks drop off without horizontal scroll.
4. Optional Android WebView glance to confirm no regression.
5. Rollback = revert CSS + HeatmapGrid changes; no persisted state to clean up.

## Open Questions

- None blocking. If later we want user-tunable scrollbar thickness/colors, that would be a separate change with Settings approval.
