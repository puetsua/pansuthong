# android-folder-sync Specification

## Purpose

On Android there is no always-mounted cloud folder, so an app-private local
master remains crash-safe and a mirror layer copies it (and any conflict copies)
to and from a user-picked SAF (Storage Access Framework) folder. Desktop peers
already use per-device `tasks_<device>.db`; the SAF wire format is still JSON until
that layer is converted to `.db` snapshots (tracked separately). All SAF I/O sits
behind a `SafBackend` trait so the mirror logic is testable on desktop; the SAF
commands are no-ops on non-Android targets.

## Requirements

### Requirement: Pick and clear the SAF folder

The system SHALL let the user pick a SAF folder to mirror into, and clear it,
reporting sync status.

#### Scenario: Non-Android is a no-op
- **WHEN** a SAF command runs on desktop
- **THEN** it returns a neutral status without touching any folder

### Requirement: Bidirectional mirror

The system SHALL push the local master to the SAF folder and pull remote replicas
back, merging them through the same document merge used elsewhere.

#### Scenario: Pull merges remote replicas
- **WHEN** `saf_sync_now` runs and the SAF folder holds replicas from other devices
- **THEN** they are read and merged into the local document

#### Scenario: Push mirrors the master out
- **WHEN** `saf_push` runs
- **THEN** the local master (and recognized conflict copies) are written to the SAF folder

### Requirement: Attachment and conflict mirroring

The system SHALL mirror managed attachment files and conflict copies alongside the
data file, validating attachment names with the same guard used on desktop.

#### Scenario: Resolved conflict is removed from the SAF folder
- **WHEN** a conflict is resolved or dismissed on Android
- **THEN** the corresponding conflict copy is also removed from the SAF folder so it does not reappear on the next pull
