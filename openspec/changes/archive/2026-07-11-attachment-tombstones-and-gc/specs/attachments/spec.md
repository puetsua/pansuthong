## MODIFIED Requirements

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
