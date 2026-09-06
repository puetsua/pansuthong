## 1. Calendar indexing

- [x] 1.1 Extend `src/lib/calendar.ts` with week helpers and month overflow slicing
- [x] 1.2 Update unit tests in `src/lib/calendar.test.ts`

## 2. Calendar UI (Month | Week | Day)

- [x] 2.1 Add `CalendarMonthLine` and `CalendarWeekRow` components
- [x] 2.2 Rewrite `CalendarView` with mode toggle, month grid, week grid, day agenda
- [x] 2.3 Narrow week: day strip + list; `hideTimer` on TaskRow/GhostRow for day view
- [x] 2.4 Replace Proposal C CSS with A+B styles

## 3. Navigation

- [x] 3.1 Remove Upcoming from sidebar/mobile; redirect `/upcoming` → `/calendar`
- [x] 3.2 i18n en + zh-TW for mode labels and overflow copy

## 4. Verify

- [x] 4.1 View and sidebar tests; `npm test`, `npm run lint`, `npm run build`
