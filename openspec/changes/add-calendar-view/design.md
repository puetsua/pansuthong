## Context

Issue #172 confirmed design: Month | Week | Day (A+B+Day), Calendar replaces Upcoming.

## Goals / Non-Goals

**Goals**

- Three modes with shared computed indexing (`start_date`/`due_date` + ghosts).
- Reuse TaskRow/GhostRow/tag pills; neutral calendar chips without color bars.
- Narrow week: day strip + list (Proposal B).

**Non-Goals**

- Persisting last mode, horizontal-scroll week on mobile, Dashboard heatmap semantics.

## Decisions

1. **Day navigation** — Month/Week clicks on dates switch to Day mode (not a side panel).
2. **Day interactions** — Checkboxes on; timers off (via `hideTimer` on RowList).
3. **Upcoming** — Redirect route; remove sidebar/mobile entries.

## Risks / Trade-offs

- Month cells truncate titles; full detail lives in Day mode or the editor.
