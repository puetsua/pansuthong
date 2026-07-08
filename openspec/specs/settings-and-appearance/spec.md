# settings-and-appearance Specification

## Purpose

Settings are device-local: they live in `config.json` in app-private storage and
are never synced, so each device keeps its own theme, sort order, horizon,
language, formats, and other preferences. This capability covers the settings
store and the appearance choices it holds — theme mode, custom theme presets,
language, and date/time display formats.

## Requirements

### Requirement: Device-local settings store

The system SHALL persist settings in a non-synced `config.json`, updating memory
only after a successful atomic write so a validation error or failed persist
leaves memory and disk in agreement.

#### Scenario: Failed update does not partially mutate
- **WHEN** a settings update mutates a field and then fails validation
- **THEN** neither memory nor disk reflects the partial change

#### Scenario: Missing keys default without failing the parse
- **WHEN** an older `config.json` lacks newly added keys
- **THEN** each missing key takes its default and the rest of the settings still load

### Requirement: Settings migration

The system SHALL, on first launch after the rename, migrate the chosen folder from
a legacy `data_location.json` and lift the `settings` object out of `tasks.json`,
deferring the one-shot migration when the configured folder is not yet mounted.

#### Scenario: Migration deferred when folder unavailable
- **WHEN** a configured data folder is offline at launch so its `tasks.json` cannot be read
- **THEN** defaults are used for the session and no `config.json` is committed, so the migration retries next launch

### Requirement: Theme mode and presets

The system SHALL store a theme mode ("auto"/"light"/"dark"), an active theme
preset id, and user-defined custom presets (each a full light+dark token map),
storing preset strings opaquely while the frontend owns token semantics.

#### Scenario: Custom preset round-trips
- **WHEN** a custom theme preset is saved
- **THEN** it persists with its light and dark token maps and re-loads unchanged

### Requirement: Language

The system SHALL store a UI language ("auto" to follow the OS, or a supported tag
like "en"/"zh-TW"), defaulting to "auto".

#### Scenario: Auto follows the OS locale
- **WHEN** language is "auto"
- **THEN** the UI renders in the OS locale where supported

### Requirement: Date and time formats

The system SHALL store separate date and time display format presets, falling back
to the legacy combined `date_time_format`, then to "locale", when unset.

#### Scenario: Absent formats fall back to locale
- **WHEN** neither `date_format`/`time_format` nor a legacy `date_time_format` is set
- **THEN** dates and times display in the locale format

### Requirement: New-tag and view defaults

The system SHALL store defaults that other capabilities consume: new-tag color and
priority, Upcoming horizon, day-start hour, sort order, completion sound, reminder
interval, attachment size ceiling, and recurrence-heatmap range and week start.

#### Scenario: Bounds are enforced by the UI
- **WHEN** a bounded setting is edited (e.g. `upcoming_days` 1..=365, `max_attachment_mb` 1..=10240)
- **THEN** the value is constrained to its documented range
