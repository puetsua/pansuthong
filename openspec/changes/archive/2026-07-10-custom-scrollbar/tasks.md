## 1. Scrollbar CSS

- [x] 1.1 Add global thin scrollbar rules in `src/styles/global.css` using `::-webkit-scrollbar`, `::-webkit-scrollbar-track`, `::-webkit-scrollbar-thumb` (and hover/active states) plus `scrollbar-width` / `scrollbar-color` fallbacks
- [x] 1.2 Derive track/thumb colors from existing theme tokens (`--c-border`, `--c-surface` / `--c-bg`, etc.) so light, dark, and custom presets pick them up automatically
- [x] 1.3 Ensure both vertical and horizontal axes are covered (width and height on the scrollbar pseudo-element)

## 2. Heatmap fit-to-width

- [x] 2.1 In `HeatmapGrid`, measure available width and render only as many trailing week columns as fit (always include today); drop older weeks from the left
- [x] 2.2 Update `.heatmap` CSS so horizontal scrolling is not the overflow strategy (`overflow-x: hidden` or equivalent)
- [x] 2.3 Add or extend a unit test covering “narrow width → fewer weeks, still ends at today”

## 3. Verification

- [x] 3.1 On **Pansuthong Dev** desktop, confirm themed thin scrollbars on a long task list and a modal/settings panel
- [x] 3.2 Switch theme mode/preset (including at least one custom or non-default preset) and confirm scrollbar colors update without restart
- [x] 3.3 Narrow the window on Tag/Recurrence heatmap: older weeks drop off, no horizontal scrollbar; widen and confirm more weeks return
- [x] 3.4 Confirm Settings has no new scrollbar control and native scroll input (wheel / drag) still works on lists

## 4. Desktop window floor (follow-up)

- [x] 4.1 Set `minWidth` / `minHeight` on desktop window configs so Today/Inbox/Upcoming bottom tabs cannot be cropped
- [x] 4.2 Harden shell/tab overflow (`overflow-x: hidden`, `min-width: 0`) to avoid page-level horizontal scrollbars
