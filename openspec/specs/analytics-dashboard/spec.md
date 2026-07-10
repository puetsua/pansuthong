# analytics-dashboard Specification

## Purpose

The Dashboard and Tag stats surface activity analytics: per-tag statistics and
activity heatmaps aggregated across every task carrying a tag, plus recurrence
streak/heatmap views for recurring templates. Tags and recurring templates can be
pinned to the Dashboard in a named view.

## Requirements

### Requirement: Tag analytics

The system SHALL compute per-tag statistics and an activity heatmap aggregated
across all tasks carrying the tag.

#### Scenario: Heatmap aggregates across tasks
- **WHEN** a tag is shown on the Dashboard
- **THEN** its heatmap reflects activity from every task carrying that tag

### Requirement: Recurrence heatmap range

The system SHALL bound the recurrence heatmap by the device-local
`recurrence_heatmap_days` (7..=365, default 90) and start weeks on the configured
`first_day_of_week`.

#### Scenario: Range and week start follow settings
- **WHEN** `recurrence_heatmap_days` or `first_day_of_week` changes
- **THEN** the heatmap span and column alignment update accordingly

### Requirement: Heatmap fits available width

The system SHALL render activity heatmaps (tag and recurrence) so that when the
configured day range produces more week columns than fit in the available width,
only as many trailing weeks as fit are shown, always including today, without
relying on horizontal scrolling as the primary overflow behavior. The device-local
`recurrence_heatmap_days` setting remains an upper bound on the computed range;
visible weeks MAY be fewer than that bound when space is limited.

#### Scenario: Narrow panel shows fewer recent weeks
- **WHEN** the heatmap container is too narrow to show every week in the configured range
- **THEN** older week columns are omitted from the display and the visible grid ends at today without a horizontal scrollbar

#### Scenario: Wide panel shows full configured range
- **WHEN** the heatmap container is wide enough for every week in the configured `recurrence_heatmap_days` range
- **THEN** the full range is shown as today

#### Scenario: Resize reveals or hides older weeks
- **WHEN** the user widens or narrows the window (or panel) while a heatmap is visible
- **THEN** the number of visible week columns updates to match the new width while still ending at today

### Requirement: Dashboard pinning

The system SHALL render a pinned tag or recurring template in its chosen Dashboard
view ("heatmap" or "streak"), with the pin synced as part of the entity.

#### Scenario: Pin view selects the rendering
- **WHEN** an entity is pinned with `dashboard_view` = "streak"
- **THEN** it renders as a streak view on the Dashboard, and its pin follows across devices
