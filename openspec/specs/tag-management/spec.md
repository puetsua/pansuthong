# tag-management Specification

## Purpose

Tags are the only grouping mechanism for tasks. They are flat (no hierarchy),
carry a color and a priority weight, and can be pinned to the sidebar. Tasks
reference tags through `tag_ids`; tags never own tasks. A task's effective
priority is the maximum weight among its tags.

## Requirements

### Requirement: Tag creation

The system SHALL create a tag from a non-empty name and a valid hex color,
applying the configured new-tag color/priority defaults when not overridden.

#### Scenario: Blank name or bad color is rejected
- **WHEN** `add_tag` is called with an empty name or a non-hex color
- **THEN** the call fails with an invalid-input error and no tag is created

### Requirement: Tag editing

The system SHALL update a tag's name, color, priority, pinned state, dashboard
pin, and dashboard card order, validating the same way creation does, and stamp
`updated_at`.

#### Scenario: Priority weight is bounded
- **WHEN** a tag priority outside -9999..=9999 is supplied
- **THEN** the update is rejected

### Requirement: Derived task priority

The system SHALL derive a task's effective priority as the maximum weight among
its tags, treating a task with no tags (or only unknown tags) as priority 0.

#### Scenario: Highest tag weight wins
- **WHEN** a task carries several tags with different weights
- **THEN** its effective priority equals the greatest of those weights

### Requirement: Sidebar pinning

The system SHALL show only pinned tags in the sidebar's curated list while keeping
every tag reachable on the Tags screen; pinned state syncs across devices.

#### Scenario: Legacy tags load unpinned
- **WHEN** a tag written before the `pinned` field existed is loaded
- **THEN** it defaults to unpinned, keeping it out of the curated sidebar until pinned

### Requirement: Tag deletion

The system SHALL delete a tag, tombstone it, and strip its id from every task and
template that referenced it.

#### Scenario: Deleting a tag detaches it from tasks
- **WHEN** a tag in use is deleted
- **THEN** its id is removed from all referencing tasks/templates and a tombstone is recorded
