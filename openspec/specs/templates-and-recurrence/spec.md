# templates-and-recurrence Specification

## Purpose

Templates are reusable task blueprints kept in their own `template_tasks` list,
separate from active tasks, so they never appear in any active view or search. A
template carries relative date offsets (resolved to absolute dates when a task is
spawned) and an optional recurrence schedule. Recurring templates project "ghost"
rows into the date-based views and can be pinned to the Dashboard.
## Requirements
### Requirement: Template creation and offsets

The system SHALL create a template from a non-empty title, storing relative
due/start offsets in days bounded to 0..=3650, and never storing completion or
absolute dates.

#### Scenario: Offset out of range is rejected
- **WHEN** a template is created with a due or start offset outside 0..=3650
- **THEN** the call fails with an invalid-input error

#### Scenario: Spawned task resolves offsets to absolute dates
- **WHEN** a task is spawned from a template
- **THEN** its due/start dates are computed as today plus the template's offsets

### Requirement: Recurrence schedule

The system SHALL support daily, weekly (ISO weekdays 1..=7), monthly (days
1..=31), and yearly (month+day) recurrence, rejecting a schedule that could never
fire or carries an out-of-range value.

#### Scenario: Empty or invalid schedule is rejected
- **WHEN** a weekly schedule has no weekdays, or a yearly date is invalid for its month
- **THEN** the schedule is rejected

#### Scenario: Legacy single-day shapes still load
- **WHEN** a template file carries the pre-multi-day `monthly {day}` or `yearly {month,day}` shape
- **THEN** it loads into the current `monthly {days}` / `yearly {dates}` form

### Requirement: Recurrence tag

The system SHALL require a recurring template to designate a recurrence tag that
is one of its own tags; a task spawned from it carries that tag and suppresses the
matching ghost row.

#### Scenario: Recurrence tag must belong to the template
- **WHEN** a recurring template's recurrence tag is not among its `tag_ids`
- **THEN** the call fails with an invalid-input error

### Requirement: Ghost projection and start bound

The system SHALL project ghost occurrences from a recurring template into the
date-based views, not projecting on days before `recurrence_start_date` when set.

#### Scenario: Occurrences before the start date are suppressed
- **WHEN** a recurrence would fire on a date earlier than its `recurrence_start_date`
- **THEN** no ghost row is projected for that date

### Requirement: Dashboard pinning

The system SHALL let a tag or recurring template be pinned to the Dashboard in a
named view ("heatmap" or "streak"), rejecting any other view name.

#### Scenario: Unknown dashboard view is rejected
- **WHEN** a dashboard view other than "heatmap" or "streak" is supplied
- **THEN** the call fails with an invalid-input error

### Requirement: Template lifecycle

The system SHALL support updating, duplicating, and deleting templates, tombstoning
deletes so stale replicas cannot resurrect them.

#### Scenario: Legacy is_template tasks migrate on load
- **WHEN** an older document carries tasks flagged `is_template` in the `tasks` list
- **THEN** they are lifted into `template_tasks` on load rather than becoming hidden ordinary tasks

### Requirement: Template editor field order

The template editor SHALL present the estimated-time field above the notes field.

#### Scenario: Estimated time appears above notes

- **WHEN** the user opens the editor for a template
- **THEN** the estimated-time (預估時間) field is rendered before the notes (備註) field in the form

