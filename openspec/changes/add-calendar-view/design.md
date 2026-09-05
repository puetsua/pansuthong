## Context

Issue #172 chose Proposal C: stacked month grid + agenda (desktop and mobile), sidebar
entry under Upcoming, computed query only.

## Goals / Non-Goals

**Goals**

- Month navigation (prev/next/today) with `first_day_of_week` respected.
- Day cells show count badge, up to three marker dots (tasks then ghosts).
- Selected day agenda uses `mergeRowsByWeight` like Upcoming and `RowList` rows.
- Exclude done and archived tasks from calendar markers and agenda.

**Non-Goals**

- Week view, drag-to-reschedule, persisted calendar state, or Dashboard heatmap reuse.
- New Settings section for calendar horizon (month view is implicit).

## Decisions

1. **Membership rule** — Match Upcoming day matching: `start_date === iso || due_date === iso`,
   plus `ghostsForDate`. Done tasks filtered out (unlike Today linger).
2. **Indexing module** — `src/lib/calendar.ts` keeps view code thin and testable.
3. **Mobile nav** — Bottom tab shows Calendar (mock C); Upcoming remains in More menu.

## Risks / Trade-offs

- Spanning tasks (start before, due after) only mark explicit start/due days, not every
  day in between — same as Upcoming, avoids heatmap-style span semantics.
