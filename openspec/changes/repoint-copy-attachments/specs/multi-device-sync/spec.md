## MODIFIED Requirements

### Requirement: Relocatable data folder

The system SHALL let the user point the data folder at a chosen directory (or clear
back to the default app-data dir), repointing the store, restarting the watcher,
and extending the attachment asset scope to the new folder. When seeding an empty
target, the device's history sidecar SHALL be copied beside the new data file so
History stays continuous, and this device's `attachments_<device>/` tree SHALL be
copied (not moved) from the previous folder so attachment opens keep working. The
system SHALL copy only `history_<device>.jsonl` (after migrating any bare
`history.jsonl` on the source into that sidecar) and SHALL NOT copy bare
`history.jsonl` into the new folder. The system SHALL NOT copy peer
`attachments_<other>/` directories when seeding. When adopting a folder that already
holds task data, the system SHALL NOT overwrite existing attachment blobs in the
target; it MAY copy only referenced blobs that are missing under the new folder
(fill-missing), leaving sources intact.

#### Scenario: Choosing a non-folder is rejected
- **WHEN** `set_data_folder` is given a path that is not a directory
- **THEN** it fails with an invalid-input error and the location is unchanged

#### Scenario: Seeding an empty folder keeps history
- **WHEN** the user points at an empty folder that has no task replicas
- **THEN** the current document is seeded there and `history_<device>.jsonl` is
  copied beside it (not bare `history.jsonl`)

#### Scenario: Seeding an empty folder keeps own attachments
- **WHEN** the user points at an empty folder that has no task replicas and the
  previous folder holds `attachments_<device>/` blobs for this device
- **THEN** that subdirectory is copied into the new folder and the source tree
  remains intact

#### Scenario: Seeding does not copy peer attachment dirs
- **WHEN** the previous folder also holds `attachments_<other>/` for a peer device
- **THEN** seeding copies only this device's `attachments_<device>/` and leaves
  peer attachment directories behind

#### Scenario: Adopting an existing folder keeps that folder's history
- **WHEN** the chosen folder already holds task data
- **THEN** that folder's document is adopted and this device's previous history
  sidecar is not copied over it

#### Scenario: Adopting does not overwrite attachment blobs
- **WHEN** the chosen folder already holds task data and attachment files
- **THEN** existing blobs in the target are left unchanged (no overwrite from the
  previous folder)
