## Context

Active views (Today, Inbox, Upcoming, Tag) are computed in `src/state/indexes.ts` and listed in the primary sidebar block above Tags. Archived and History already offer client-side text search over past items; there is no equivalent for open tasks. Users with large active sets need a way to find a task without knowing which view or tag owns it.

Constraints: views stay computed (never persisted); completed/archived tasks stay out of active views; no Projects; no new Settings without approval; reuse existing list/search UI patterns.

## Goals / Non-Goals

**Goals:**

- Sidebar **Search** entry immediately below **Upcoming**.
- `/search` view focused on **text search** over active tasks (case-insensitive substring of title, notes, and tag names).
- Empty query does not dump the full active list; results use normal task rows and device-local sort.
- **Paginated results** using the same `usePagedItems` + `PageSizeSelect` / `PaginationControls` pattern as History (and Archived).

**Non-Goals:**

- Searching archived/history from this view (those screens keep their own search).
- Date-range filters or dedicated tag-picker facets (History/Archived may have dates; Search stays a single text box — tag names are matched as text).
- Full-text index, fuzzy match, or backend query APIs.
- Persisting the query, recent searches, or a “saved search” entity.
- Matching by tag id or status in v1.
- Global keyboard shortcut / command palette (can follow later).
- New Settings controls.

## Decisions

### 1. Frontend-only computed view over `indexes.tasks`

- **Choice:** Filter `indexes.tasks` (already active-only) in a new `SearchView`; no Rust/store changes.
- **Why:** Same model as other views; `indexes.tasks` is the active set; avoids sync/schema work.
- **Alternatives:** New index field / Tauri command — unnecessary for in-memory substring match.

### 2. Match title + notes + tag names

- **Choice:** Case-insensitive `includes` on `title`, `notes`, and each resolvable tag's `name` (via `tagsById`).
- **Why:** Users often remember the tag more than the exact title; keeps a single text box without a separate tag filter UI.
- **Alternatives:** Title/notes only (too narrow once tag match was requested); dedicated tag-picker facet (defer).

### 3. Require a non-empty query before listing

- **Choice:** Trimmed empty query → prompt / empty state, not the full active list.
- **Why:** Same rationale as Archived (“could be enormous”); Search is for lookup, not a fourth “all tasks” dump.
- **Alternatives:** Show all active tasks until typed — fights the “tons of tasks” problem.

### 4. Sidebar placement and route

- **Choice:** Nav link after Upcoming, before the Tags section; route `/search`.
- **Why:** Matches the request; keeps primary active-nav block coherent (Today → Inbox → Upcoming → Search).
- **Alternatives:** Footer next to History — weaker discoverability for the active-task use case.

### 5. Results UI: TaskList + required pagination (History pattern)

- **Choice:** Render matches with `TaskList` (active rows); apply device `sort_order`. Always page results with `usePagedItems`, `PaginationControls`, and `PageSizeSelect` — same controls as History/Archived, not “optional when large.”
- **Why:** Large active sets and broad text queries are the reason for this view; pagination is part of the product, not a fallback. Completing/editing from Search should still feel like other active views.
- **Alternatives:** Flat unpaged list — rejected; fights the “tons of tasks” problem.

### 6. Query state is view-local

- **Choice:** `useState` in the view; leaving and returning clears the query (or remount clears it).
- **Why:** No persisted view state; simplest; avoids URL/query sync complexity for v1.
- **Alternatives:** `?q=` in the URL — nice for deep links; defer unless needed.

## Risks / Trade-offs

- **[Trade-off] Text-only (no date/tag facets)** → Accepted for v1; copy and empty states stay about typing a query. Facets can layer on later without model changes.
- **[Risk] Duplication of Archived title/notes match** → Mitigate by extracting a shared `taskMatchesQuery(task, q)` used by Search (and optionally Archived).
- **[Risk] Very broad queries still feel slow on huge docs** → Pagination keeps the DOM bounded; revisit indexing only if client filter becomes a real bottleneck.

## Migration Plan

- Pure UI/route addition; no data migration.
- Rollback: remove nav link, route, and view; no document format impact.

## Open Questions

- None blocking: tag-name matching and URL-synced query are explicitly deferred.
