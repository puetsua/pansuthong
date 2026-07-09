## 1. Search matching helper

- [x] 1.1 Add a small shared helper (e.g. `taskMatchesQuery(task, query)`) for case-insensitive title/notes substring match, reusable from Search (and optionally Archived later)
- [x] 1.2 Unit-test the helper: title match, notes match, case-insensitivity, empty query, no match

## 2. Search view + route

- [x] 2.1 Create `SearchView` that filters `indexes.tasks` with the helper (text only — no date/tag filters); empty/whitespace query shows prompt/empty state (no full dump)
- [x] 2.2 Sort matches with the same device `sort_order` path used by other active lists; render with `TaskList` (or equivalent active-row UI)
- [x] 2.3 Always paginate matches with `usePagedItems` + `PaginationControls` + `PageSizeSelect` (History/Archived pattern); reset to page 1 on query change
- [x] 2.4 Wire `/search` in `App.tsx` and pass `doc` / `indexes`

## 3. Sidebar + i18n

- [x] 3.1 Add Search `NavLink` in `Sidebar.tsx` immediately below Upcoming (before Tags section)
- [x] 3.2 Add `nav.search` and Search view strings (placeholder, aria, empty/prompt, filtered subtitle) in `en.json` and `zh-TW.json`
- [x] 3.3 Add `/search` title mapping in `MobileHeader.tsx`; expose Search from the mobile shell/sidebar path used for other primary views (BottomTabs can stay Today/Inbox/Upcoming unless a fourth tab is clearly needed)

## 4. Tests + verify

- [x] 4.1 Add `SearchView` tests: empty query lists nothing; title/notes match; completed/archived excluded; case-insensitive; pagination + page reset on query change
- [x] 4.2 Smoke-check sidebar order (Today → Inbox → Upcoming → Search → Tags) in existing sidebar/shell tests if present, or a focused assertion
- [x] 4.3 Run relevant frontend tests for the touched files
