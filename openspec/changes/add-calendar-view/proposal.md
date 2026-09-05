## Why

Upcoming was a horizon list; users need a calendar with Month, Week, and Day modes
(#172). Calendar supersedes Upcoming in navigation.

## What Changes

- Rewrite Calendar with Month | Week | Day toggle (default Month, not persisted).
- Month: task lines in cells, overflow link to Day, date click to Day.
- Week: seven-column chips; narrow uses day strip + list.
- Day: full TaskRow list without timers.
- Remove Upcoming from nav; redirect `/upcoming` → `/calendar`.

## Capabilities

### Modified Capabilities

- `task-views`: Calendar requirement updated from Proposal C dots to A+B+Day.

## Impact

- `src/views/CalendarView.tsx`, `src/lib/calendar.ts`, calendar row components, CSS.
- Sidebar, App route redirect, i18n, tests, OpenSpec delta.
