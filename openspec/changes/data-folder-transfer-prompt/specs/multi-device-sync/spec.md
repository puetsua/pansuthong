## MODIFIED Requirements

### Requirement: Relocatable data folder

The system SHALL let the user point the data folder at a chosen directory (or clear
back to the default app-data dir), repointing the store, restarting the watcher,
and extending the attachment asset scope to the new folder. Before applying a
folder change that seeds an empty target or leaves a folder that still holds this
device's local payload, the desktop UI SHALL obtain an explicit transfer choice
(Copy, Move, or Cancel). Cancel SHALL leave the data location unchanged.

When the user chooses **Copy** or **Move**, the system SHALL transfer this
device's owned payload as needed for the seed or adopt path:

- **Seed** (target has no task replicas): seed the current document into the new
  folder; copy `history_<device>.jsonl` beside the new data file (after migrating
  any bare `history.jsonl` on the source into that sidecar; SHALL NOT copy bare
  `history.jsonl` into the new folder); copy this device's `attachments_<device>/`
  tree so attachment opens keep working.
- **Adopt** (target already holds task data): adopt/merge the target document;
  SHALL NOT overwrite that folder's history with the old sidecar wholesale; MAY
  copy only missing own history/attachment blobs from the old folder (fill-missing);
  SHALL NOT overwrite existing attachment blobs in the target.

**Copy** SHALL leave this device's owned files intact in the old folder.
**Move** SHALL, only after a successful transfer of the owned set, remove this
device's owned files from the old folder (`tasks_<device>.db` / legacy own
`tasks_<device>.json` if present, `history_<device>.jsonl`, and
`attachments_<device>/`). The system SHALL NOT copy, move, or delete peer
`tasks_<peer>.*`, `history_<peer>.jsonl`, or `attachments_<peer>/` directories.

#### Scenario: Choosing a non-folder is rejected
- **WHEN** `set_data_folder` is given a path that is not a directory
- **THEN** it fails with an invalid-input error and the location is unchanged

#### Scenario: Cancel leaves the location unchanged
- **WHEN** the user cancels the Copy / Move dialog during a data-folder change
- **THEN** the data location is unchanged and no transfer or cleanup runs

#### Scenario: Seeding with Copy keeps history and own attachments
- **WHEN** the user points at an empty folder that has no task replicas and chooses Copy
- **THEN** the current document is seeded there, `history_<device>.jsonl` and
  `attachments_<device>/` are present beside the new data file, and the old folder
  still holds the original own history sidecar and attachment tree

#### Scenario: Seeding with Move removes own payload from the old folder
- **WHEN** the user seeds an empty folder and chooses Move and the transfer succeeds
- **THEN** the new folder holds the seeded document, own history, and own
  attachments, and the old folder no longer contains this device's
  `tasks_<device>.*`, `history_<device>.jsonl`, or `attachments_<device>/`

#### Scenario: Seeding does not touch peer files
- **WHEN** the previous folder also holds peer `tasks_<peer>.*`,
  `history_<peer>.jsonl`, or `attachments_<peer>/`
- **THEN** Copy and Move leave those peer files and directories unchanged

#### Scenario: Adopting an existing folder keeps that folder's history
- **WHEN** the chosen folder already holds task data
- **THEN** that folder's document is adopted and this device's previous history
  sidecar is not copied over it wholesale

#### Scenario: Adopting does not overwrite attachment blobs
- **WHEN** the chosen folder already holds task data and attachment files
- **THEN** existing blobs in the target are left unchanged (no overwrite from the
  previous folder)

#### Scenario: Clear data folder uses the same transfer choice
- **WHEN** the user clears the data folder back to the default app-data directory
  and the operation would seed or leave own local data behind
- **THEN** the same Copy / Move / Cancel choice applies before repointing
