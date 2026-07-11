# attachments Specification

## Purpose

Tasks and templates may carry file attachments. Blobs are copied into a per-device
subdirectory of the data folder (`attachments_<device>/`) and mirrored with the
rest of the synced data. Metadata lives in the Document and merges by id union;
blobs are ordinary files and are not entity-tombstoned like tasks (see the
cross-device delete limitation below). Stored paths are validated so a crafted
reference can never escape the data folder. A configurable size ceiling bounds
how much each attachment can bloat every device's synced copy.

## Requirements

### Requirement: Adding attachments

The system SHALL persist attachments from picked file paths or in-memory bytes
(paste/drop) as managed blobs named `attachment_<id>_<safe-name>` under the
per-device attachment subdirectory, recording id, name, mime type, and size.

#### Scenario: Oversized attachment is rejected
- **WHEN** an attachment exceeds the configured `max_attachment_mb` ceiling
- **THEN** it is rejected before being written (checked by metadata for picked files, before buffering)

### Requirement: Path safety

The system SHALL accept only managed attachment paths — a flat `attachment_*` or
`attachments_<device>/attachment_*` — and reject any path containing `..` or a
backslash, both on write and on read.

#### Scenario: Escaping path is rejected
- **WHEN** an IPC payload supplies an attachment path with `..` or an absolute path
- **THEN** it is rejected with an invalid-input error and never persisted

### Requirement: Attachment removal and garbage collection

The system SHALL remove an attachment's metadata and delete its blob only when no
task or template still references that path.

#### Scenario: Shared blob is retained
- **WHEN** an attachment is removed but another entity still references the same path
- **THEN** the on-disk blob is kept

#### Scenario: Deleting an entity GCs its unreferenced blobs
- **WHEN** a task is deleted
- **THEN** its attachment blobs that are no longer referenced anywhere are removed

### Requirement: Opening and revealing

The system SHALL open an attachment in its default application, and reveal it in
the OS file manager on desktop (degrading to open on mobile), routed through Rust
so no opener permission leaks into the shared Android capabilities.

#### Scenario: Reveal on mobile falls back to open
- **WHEN** `reveal_attachment` runs on a platform without a file manager
- **THEN** the attachment is opened instead of revealed

### Requirement: Attachments merge additively across replicas

The system SHALL union attachments by id when merging replicas.

#### Scenario: Concurrent additions survive a merge
- **WHEN** two replicas each add a distinct attachment to the same task
- **THEN** the merged task contains both

#### Scenario: Cross-device delete limitation
- **WHEN** an attachment is deleted on one replica but still present on another
- **THEN** the union re-adds it (attachment deletes do not propagate until the blob is gone from every replica)
