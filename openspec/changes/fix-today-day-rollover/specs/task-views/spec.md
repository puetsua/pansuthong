## MODIFIED Requirements

### Requirement: Configurable day rollover

The system SHALL let the logical "today" boundary roll over at a configured hour
(`day_start_hour`, 0..=23), defaulting to midnight.

The system SHALL keep the logical day current as wall-clock time passes: when the
clock crosses the configured boundary, the derived views SHALL advance to the new
logical day without requiring a document mutation, a navigation, or a restart. All
consumers of the logical day (Today membership and its date header, the overdue
split, recurrence ghosts, and the default `start_date` for newly composed tasks)
SHALL observe the same boundary crossing together.

The system SHALL detect a boundary crossed while the app was suspended or its window
hidden, and advance on resume rather than waiting for the next scheduled check.

#### Scenario: Night-owl rollover
- **WHEN** `day_start_hour` is 4 and the wall-clock time is 02:00
- **THEN** the Today view still treats the date as the previous calendar day

#### Scenario: Idle app advances at the boundary
- **WHEN** `day_start_hour` is 4, the app has been left open and untouched since 03:00,
  and the clock reaches 04:00
- **THEN** the Today view advances to the new logical day without any user action

#### Scenario: Midnight rollover with the default hour
- **WHEN** `day_start_hour` is 0 and the clock crosses 00:00 while the app is open
- **THEN** the Today view advances to the new calendar day

#### Scenario: Rollover during sleep is picked up on resume
- **WHEN** the app is suspended before the boundary and becomes visible again after it
- **THEN** the Today view shows the new logical day on resume

#### Scenario: Composer inherits the advanced day
- **WHEN** the logical day has advanced while the app stayed open
- **AND** the user adds a task from the Today view
- **THEN** the new task's `start_date` is the new logical day, not the previous one
