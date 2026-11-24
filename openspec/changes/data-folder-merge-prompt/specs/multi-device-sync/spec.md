## ADDED Requirements

### Requirement: Data-folder target inspection

The system SHALL expose a desktop command that reports whether a candidate data
folder already holds Pansuthong task data, using the same detection the store uses
when repointing: a non-empty own replica (`tasks_<device>.db`), any readable peer
replica (`tasks_*.db` / `tasks_*.json`), or a legacy `tasks.json`. When no folder is
given, the command SHALL inspect the default app-data directory. The command SHALL
also report whether the candidate is the folder currently in use. The command SHALL
NOT create, modify, or delete any file.

#### Scenario: Current folder is reported as current
- **WHEN** the candidate folder is the parent of the current data file
- **THEN** the inspection reports that it is the current folder

#### Scenario: Empty folder reports no data
- **WHEN** the candidate folder contains no task replicas
- **THEN** the inspection reports that the folder has no Pansuthong data

#### Scenario: Folder with a peer replica reports data
- **WHEN** the candidate folder contains a readable `tasks_<peer>.db` with tasks
- **THEN** the inspection reports that the folder has Pansuthong data

#### Scenario: Default location is inspected when no folder is given
- **WHEN** the inspection is invoked without a folder
- **THEN** it reports on the default app-data directory

## MODIFIED Requirements

### Requirement: Relocatable data folder

The system SHALL let the user point the data folder at a chosen directory (or clear
back to the default app-data dir), repointing the store, restarting the watcher,
and extending the attachment asset scope to the new folder. Before applying a
folder change on desktop, the UI SHALL inspect the target and obtain an explicit
choice. Cancel SHALL leave the data location unchanged.

The choice depends on whether the target already holds Pansuthong task data:

- **Seed** (target has no task replicas) — **Copy** or **Move**: seed the current
  document into the new folder; copy `history_<device>.jsonl` beside the new data
  file (after migrating any bare `history.jsonl` on the source into that sidecar;
  SHALL NOT copy bare `history.jsonl` into the new folder); copy this device's
  `attachments_<device>/` tree so attachment opens keep working.
- **Existing data** (target already holds task data) — **Merge** or **Adopt**:
  - **Merge** SHALL combine the current document with the target's replicas using
    the same entity-level last-write-wins + tombstone merge as peer sync, so no
    current task, tag, or template is dropped unless a newer target edit or
    tombstone supersedes it.
  - **Adopt** SHALL load the target's merged replicas and discard the current
    in-memory document (no conflict file).
  - Neither SHALL overwrite that folder's history with the old sidecar
    wholesale. **Merge** SHALL append to the target's `history_<device>.jsonl`
    every line of the old own sidecar that the target sidecar does not already
    contain (creating it if absent), never removing target lines. **Adopt** SHALL
    NOT copy own history.
  - Both SHALL copy only document-referenced own attachment blobs that are
    missing in the target (fill-missing) and SHALL NOT overwrite existing
    attachment blobs.
  - Both SHALL leave every file in the old folder untouched.

If the target holds task data and the requested mode is Copy or Move, the backend
SHALL reject the change with an invalid-input error and leave the data location
unchanged. If the target holds no task data and the requested mode is Merge or
Adopt, the backend SHALL seed with Copy semantics.

**Copy** SHALL leave this device's owned files intact in the old folder.
**Move** SHALL, only after a successful seed transfer of the owned set, remove this
device's owned files from the old folder (`tasks_<device>.db` / legacy own
`tasks_<device>.json` if present, `history_<device>.jsonl`, and
`attachments_<device>/`). The system SHALL NOT copy, move, or delete peer
`tasks_<peer>.*`, `history_<peer>.jsonl`, or `attachments_<peer>/` directories.

#### Scenario: Choosing a non-folder is rejected
- **WHEN** `set_data_folder` is given a path that is not a directory
- **THEN** it fails with an invalid-input error and the location is unchanged

#### Scenario: Cancel leaves the location unchanged
- **WHEN** the user cancels the data-folder dialog
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

#### Scenario: Merging keeps current and target tasks
- **WHEN** the chosen folder holds a peer replica with task A, the current document
  holds task B, and the user chooses Merge
- **THEN** the resulting document contains both task A and task B

#### Scenario: Adopting uses only the folder's data
- **WHEN** the chosen folder holds a peer replica with task A, the current document
  holds task B, and the user chooses Adopt
- **THEN** the resulting document contains task A and not task B

#### Scenario: Merge and Adopt never delete old-folder files
- **WHEN** the chosen folder already holds task data and the user chooses Merge or Adopt
- **THEN** this device's `tasks_<device>.*`, `history_<device>.jsonl`, and
  `attachments_<device>/` remain in the old folder

#### Scenario: Move is rejected when the target has data
- **WHEN** `set_data_folder` is called with Copy or Move for a folder that already
  holds task data
- **THEN** it fails with an invalid-input error, the location is unchanged, and no
  file in either folder is modified

#### Scenario: Adopt keeps that folder's history
- **WHEN** the chosen folder already holds task data and the user chooses Adopt
- **THEN** this device's previous history sidecar is not copied into that folder

#### Scenario: Merge unions own history without losing target lines
- **WHEN** the chosen folder already holds `history_<device>.jsonl` with line X,
  the old sidecar holds lines X and Y, and the user chooses Merge
- **THEN** the target sidecar holds X once and Y

#### Scenario: Existing-data path does not overwrite attachment blobs
- **WHEN** the chosen folder already holds task data and attachment files
- **THEN** existing blobs in the target are left unchanged (no overwrite from the
  previous folder)

#### Scenario: Clear data folder uses the same choice
- **WHEN** the user clears the data folder back to the default app-data directory
- **THEN** the default directory is inspected first and the same seed
  (Copy / Move / Cancel) or existing-data (Merge / Adopt / Cancel) choice applies
  before repointing
