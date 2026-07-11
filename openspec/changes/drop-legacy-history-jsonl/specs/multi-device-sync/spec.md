## MODIFIED Requirements

### Requirement: Relocatable data folder

The system SHALL let the user point the data folder at a chosen directory (or clear
back to the default app-data dir), repointing the store, restarting the watcher,
and extending the attachment asset scope to the new folder. When seeding an empty
target, the device's history sidecar SHALL be copied beside the new data file so
History stays continuous. The system SHALL copy only `history_<device>.jsonl` (after
migrating any bare `history.jsonl` on the source into that sidecar) and SHALL NOT
copy bare `history.jsonl` into the new folder.

#### Scenario: Choosing a non-folder is rejected
- **WHEN** `set_data_folder` is given a path that is not a directory
- **THEN** it fails with an invalid-input error and the location is unchanged

#### Scenario: Seeding an empty folder keeps history
- **WHEN** the user points at an empty folder that has no task replicas
- **THEN** the current document is seeded there and `history_<device>.jsonl` is
  copied beside it (not bare `history.jsonl`)

#### Scenario: Adopting an existing folder keeps that folder's history
- **WHEN** the chosen folder already holds task data
- **THEN** that folder's document is adopted and this device's previous history
  sidecar is not copied over it
