## Why

When a user has many active tasks, Today / Inbox / Upcoming / pinned tags only surface slices of the list. Finding a specific open task by name (or notes) means scrolling through views or guessing which tag holds it. A dedicated Search view over active tasks makes large task sets navigable without inventing a new grouping system.

## What Changes

- Add a **Search** sidebar entry directly below **Upcoming** (before the Tags section).
- Add a `/search` route and Search view that filters **active** (non-archived) tasks by **text search** (title, notes, and tag names), same idea as History/Archived search — no date filters or dedicated tag-picker UI in v1.
- Empty query shows a prompt / empty state (not the full task dump); matching results use the same task row UI and device-local sort as other active views.
- Results are **paginated** with the shared `usePagedItems` + page-size controls pattern used by History/Archived.
- Completed/archived tasks stay out of Search (same rule as other active views); History and Archived keep their own search for past items.
- i18n strings for nav label, placeholders, and empty/filtered subtitles (en + zh-TW).

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `task-views`: Add a Search view as a computed active-task query, and place it in the primary sidebar nav below Upcoming.

## Impact

- Frontend: `Sidebar.tsx` (nav order), `App.tsx` (route), new `SearchView` (or equivalent), possibly a small filter helper near `indexes` / list utilities.
- i18n: `en.json`, `zh-TW.json` (`nav.search`, search view copy).
- No Document / settings / sync model changes; Search remains a computed view (not persisted).
- No new Settings controls.
