## MODIFIED Requirements

### Requirement: New-tag and view defaults

The system SHALL store defaults that other capabilities consume: new-tag priority, Upcoming horizon, day-start hour, sort order, completion sound, reminder interval, attachment size ceiling, and Dashboard-heatmap range and week start. New-tag **color** SHALL be derived from the active theme’s `--c-bg` at creation time rather than from the stored `default_tag_color` field. That field MAY remain in `config.json` for backward compatibility but SHALL NOT seed new tags. The system SHALL NOT add a Settings control for default tag color.

#### Scenario: Bounds are enforced by the UI
- **WHEN** a bounded setting is edited (e.g. `upcoming_days` 1..=365, `max_attachment_mb` 1..=10240)
- **THEN** the value is constrained to its documented range

#### Scenario: New-tag color follows the active theme
- **WHEN** the user creates a tag while a built-in or custom theme (light or dark) is active
- **THEN** the new tag’s color is that theme variant’s background hex, not the value stored in `default_tag_color`
