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

### Requirement: Dashboard pinning

The system SHALL render a pinned tag or recurring template in its chosen Dashboard
view ("heatmap" or "streak"), with the pin synced as part of the entity.

#### Scenario: Pin view selects the rendering
- **WHEN** an entity is pinned with `dashboard_view` = "streak"
- **THEN** it renders as a streak view on the Dashboard, and its pin follows across devices
