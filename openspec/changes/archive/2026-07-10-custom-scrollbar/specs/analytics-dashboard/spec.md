## ADDED Requirements

### Requirement: Heatmap fits available width

The system SHALL render activity heatmaps (tag and recurrence) so that when the configured day range produces more week columns than fit in the available width, only as many trailing weeks as fit are shown, always including today, without relying on horizontal scrolling as the primary overflow behavior. The device-local `recurrence_heatmap_days` setting remains an upper bound on the computed range; visible weeks MAY be fewer than that bound when space is limited.

#### Scenario: Narrow panel shows fewer recent weeks
- **WHEN** the heatmap container is too narrow to show every week in the configured range
- **THEN** older week columns are omitted from the display and the visible grid ends at today without a horizontal scrollbar

#### Scenario: Wide panel shows full configured range
- **WHEN** the heatmap container is wide enough for every week in the configured `recurrence_heatmap_days` range
- **THEN** the full range is shown as today

#### Scenario: Resize reveals or hides older weeks
- **WHEN** the user widens or narrows the window (or panel) while a heatmap is visible
- **THEN** the number of visible week columns updates to match the new width while still ending at today
