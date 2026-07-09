## ADDED Requirements

### Requirement: Search view

The system SHALL provide a Search view that filters active (non-archived) tasks by
**text search**: a case-insensitive substring match against task title, notes, and
the names of tags on the task. The Search view is a computed query — never a
persisted list. An empty (whitespace-only) query SHALL NOT list all active tasks;
the view SHALL show an empty/prompt state until the user enters a non-empty query.
Matching results SHALL follow the device-local `sort_order`. Completed (archived)
tasks SHALL never appear in Search. The view SHALL NOT require date-range or
dedicated tag-filter controls for v1 (single text query only).

#### Scenario: Match on title
- **WHEN** the user enters a non-empty query that appears in an active task's title
- **THEN** that task appears in the Search results

#### Scenario: Match on notes
- **WHEN** the user enters a non-empty query that appears only in an active task's notes
- **THEN** that task appears in the Search results

#### Scenario: Match on tag name
- **WHEN** the user enters a non-empty query that appears only in a tag name on an active task
- **THEN** that task appears in the Search results

#### Scenario: Empty query shows no dump
- **WHEN** the Search query is empty or whitespace-only
- **THEN** the view does not list the full set of active tasks

#### Scenario: Completed tasks excluded
- **WHEN** a task is completed
- **THEN** it never appears in Search results

#### Scenario: Case-insensitive match
- **WHEN** the user searches with different casing than the stored title, notes, or tag name
- **THEN** matching active tasks still appear in the results

### Requirement: Search results are paginated

The system SHALL paginate Search results using the shared list paging controls
(page size and previous/next), matching the History/Archived search pattern, so a
large match set does not render as one unbounded list.

#### Scenario: Large match set is paged
- **WHEN** a text query matches more active tasks than the selected page size
- **THEN** the view shows only the current page of matches and offers controls to
  change page and page size

#### Scenario: Query change resets to first page
- **WHEN** the user changes the Search text query while viewing a later page
- **THEN** the results return to the first page of the new match set

### Requirement: Search in primary sidebar nav

The system SHALL place a Search entry in the primary sidebar navigation immediately
below Upcoming and above the Tags section, linking to the Search view.

#### Scenario: Nav order
- **WHEN** the sidebar primary nav is rendered
- **THEN** the order is Today, Inbox, Upcoming, then Search, before the Tags section
