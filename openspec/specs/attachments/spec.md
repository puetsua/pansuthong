# attachments Specification

## Purpose

Tasks and templates may carry file attachments. Blobs are copied into a per-device
subdirectory of the data folder (`attachments_<device>/`) and mirrored with the
rest of the synced data. Metadata lives in the Document and merges by id union
with document-level attachment tombstones so deletes propagate. Stored paths are
validated so a crafted reference can never escape the data folder. A configurable
size ceiling bounds how much each attachment can bloat every device's synced copy.

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

The system SHALL remove an attachment's metadata, record an attachment tombstone,
and delete its blob when no task or template in the merged document still
references that path. Blob GC is opportunistic per device: after a local remove
and after a peer merge that changes the document, the device MAY delete any
managed attachment file under the data folder whose path is unreferenced —
including blobs under a peer's `attachments_*` subdirectory.

#### Scenario: Shared blob is retained
- **WHEN** an attachment is removed but another entity still references the same path
- **THEN** the on-disk blob is kept

#### Scenario: Deleting an entity GCs its unreferenced blobs
- **WHEN** a task is deleted
- **THEN** its attachment blobs that are no longer referenced anywhere are removed

#### Scenario: Tombstoned attachment enables cross-device GC
- **WHEN** a peer merge applies an attachment tombstone so no live metadata
  references the path
- **THEN** this device deletes the unreferenced managed blob on opportunistic GC

### Requirement: Opening and revealing

The system SHALL open an attachment in its default application, and reveal it in
the OS file manager on desktop (degrading to open on mobile), routed through Rust
so no opener permission leaks into the shared Android capabilities.

#### Scenario: Reveal on mobile falls back to open
- **WHEN** `reveal_attachment` runs on a platform without a file manager
- **THEN** the attachment is opened instead of revealed

### Requirement: Attachments merge additively across replicas

The system SHALL union attachments by id when merging replicas, and SHALL suppress
an attachment when a document-level attachment tombstone for that id has
`deleted_at` greater than or equal to the attachment's `created_at`. A newer
recreate (`created_at` after the tombstone) SHALL survive.

#### Scenario: Concurrent additions survive a merge
- **WHEN** two replicas each add a distinct attachment to the same task
- **THEN** the merged task contains both

#### Scenario: Attachment delete propagates via tombstone
- **WHEN** one replica deletes an attachment (recording a tombstone) and another
  still lists that attachment with an older `created_at`
- **THEN** the merged document omits the attachment

#### Scenario: Recreate after delete survives a stale tombstone
- **WHEN** an attachment id is recreated with `created_at` newer than the tombstone
- **THEN** the recreated attachment is kept in the merge
