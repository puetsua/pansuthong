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

### Requirement: Own attachments follow folder relocate under transfer mode

When the data folder is relocated, the system SHALL transfer this device's
`attachments_<device>/` directory according to the user's Copy or Move choice.
On seed, the subdirectory SHALL be copied into the new folder so document
attachment paths remain resolvable. On adopt, the system MAY copy only
document-referenced managed paths that are missing under the new folder and
present under the old folder (fill-missing), and SHALL NOT overwrite existing
destination blobs. **Copy** SHALL leave the source `attachments_<device>/` tree
intact. **Move** SHALL remove this device's attachment subdirectory from the old
folder only after a successful transfer. The system SHALL NOT copy, move, or
delete peer `attachments_<other>/` trees. Failure mid-transfer SHALL NOT delete
source attachments; the system MAY warn and continue without rolling back a
successful document seed when only attachment copy fails under Copy (same class
as history sidecar warnings), but Move cleanup of the old tree MUST NOT run
unless the owned attachment transfer succeeded.

#### Scenario: Seed Copy places own attachment subdirectory
- **WHEN** `repoint` seeds an empty folder with transfer mode Copy and
  `attachments_<device>/` exists beside the previous data file
- **THEN** the new folder contains a copy of that subdirectory with the same
  relative blob paths and the previous folder still contains the original tree

#### Scenario: Seed Move removes own attachments from the old folder
- **WHEN** `repoint` seeds an empty folder with transfer mode Move and own
  attachment transfer succeeds
- **THEN** the new folder contains the attachment subdirectory and the previous
  folder no longer contains `attachments_<device>/`

#### Scenario: Peer attachment dirs are never transferred or deleted
- **WHEN** the previous folder also holds `attachments_<other>/` for a peer device
- **THEN** Copy and Move leave that peer directory unchanged at the old folder
  and do not create a peer attachment directory from it at the new folder

#### Scenario: Same-folder repoint is a no-op for attachments
- **WHEN** the new data path shares the same parent directory as the old path
- **THEN** no attachment directory copy or cleanup is attempted

#### Scenario: Failed Move transfer does not delete source attachments
- **WHEN** Move is chosen and copying own attachments to the new folder fails
- **THEN** the previous folder's `attachments_<device>/` tree remains intact
