# multi-device-sync Specification

## Purpose

Pansuthong syncs by placing each device's data file in a shared cloud folder
(e.g. Google Drive) as a per-device replica (`tasks_<device>.db`). The app never
writes another device's replica; instead it reads all replicas and computes a
merged document with entity-level last-write-wins plus tombstones. A filesystem
watcher and a polling fallback pick up changes pulled in from other devices.
External cloud conflict copies (`*.sync-conflict*` and similar) are surfaced in
the Conflicts UI; Android SAF pull merges like desktop and does not stash a
whole-document `.conflict-local-*` loser.

The shared folder also holds related sidecars that are **not** part of the
Document merge: per-device history logs (`history_<device>.jsonl`) and attachment
blobs (`attachments_<device>/`). Those use different consistency rules (see
`archive-and-history` and `attachments`); there is no single master file for all
synced data.
## Requirements
### Requirement: Per-device replicas

The system SHALL write only this device's replica, named from its stable
`device_id`, and never modify another device's replica file. The primary at-rest
format is `tasks_<device>.db`; legacy `tasks_<device>.json` (and `tasks.json`) MAY
still be read as peer/migration input.

#### Scenario: Each device owns its file
- **WHEN** two devices sync into the same folder
- **THEN** each writes only its own `tasks_<device>.db` and reads the others read-only

#### Scenario: Legacy JSON peers still merge
- **WHEN** a sibling `tasks_*.json` replica is present beside `.db` files
- **THEN** it is read read-only and included in the same entity-level merge

### Requirement: Entity-level merge

The system SHALL compute the visible document by merging all replicas with
last-write-wins per entity (task/tag/template) keyed by its edit stamp, applying
tombstones so a deleted entity is not resurrected by a stale replica.

#### Scenario: Newer edit wins
- **WHEN** two replicas carry different versions of the same task
- **THEN** the one with the greater edit stamp wins the fields (time entries and attachments still union)

#### Scenario: Tombstone suppresses a stale entity
- **WHEN** one replica deleted an entity (tombstone) and another still has an older copy
- **THEN** the merged document omits it

### Requirement: Watcher and polling fallback

The system SHALL detect data-file changes via a filesystem watcher and also poll
periodically, because native FS events are unreliable on cloud-sync folders. Freshness
is guaranteed by these automatic mechanisms alone; there is no user-facing manual
"sync now" trigger.

#### Scenario: Watcher detects a peer change
- **WHEN** a peer replica in the data folder changes on disk
- **THEN** the filesystem watcher re-reads it and, if the merged document changed, a store-changed event is emitted

#### Scenario: Polling picks up changes the watcher missed
- **WHEN** a cloud-sync client pulls in a peer change without firing a native FS event
- **THEN** the periodic poll re-reads the data file and, if the merged document changed, a store-changed event is emitted

### Requirement: Whole-document conflict files

The system SHALL surface external conflict copies left by cloud sync clients
(e.g. `*.sync-conflict*`) in the Conflicts UI rather than ignoring them.
Android SAF pull SHALL merge local with remote replicas in place (same LWW as
desktop) and MUST NOT create a `.conflict-local-*` stash for that case.

#### Scenario: Conflict badge lists divergences
- **WHEN** conflict copies exist in the data folder
- **THEN** `list_conflicts` returns them and a conflicts-detected event surfaces the badge

#### Scenario: SAF pull merges instead of conflict-local
- **WHEN** the phone has unpushed local edits and remote replica(s) differ
- **THEN** pull merges via `merge_documents([local, …remotes])` and does not write a `.conflict-local-*` file

### Requirement: Conflict resolution

The system SHALL let the user review per-task differences from a conflict file and
apply keep-mine/keep-theirs decisions, merging in referenced tags so they do not
dangle, then remove the resolved conflict file.

#### Scenario: Only vetted conflict paths are touched
- **WHEN** a conflict path is not one produced by `list_conflicts` in the data directory
- **THEN** read/resolve/dismiss reject it rather than touching an arbitrary file

#### Scenario: Resolving applies decisions and clears the file
- **WHEN** the user resolves a conflict with a set of decisions
- **THEN** the chosen tasks (and their tags) are merged into the document and the conflict file is deleted

### Requirement: Version gate

The system SHALL refuse to load a data or conflict file written by a newer schema
version, surfacing an "update the app" condition instead of dropping unknown fields.

#### Scenario: Newer file is rejected, not downgraded
- **WHEN** a replica or conflict file declares a version higher than the running build supports
- **THEN** it is rejected rather than parsed and rewritten with fields stripped

### Requirement: Durable writes under external lock contention

The replica lives in a folder a cloud-sync client also writes, so the system MUST
assume its own database file can be locked by another process at any moment.

The system SHALL retry a write that fails because the replica is locked by another
process, within a bounded time budget, before reporting failure. Retries SHALL apply
only to lock contention; any other database error SHALL be reported immediately
without retrying.

The system SHALL make a write atomic with respect to its in-memory state: either the
mutation is persisted to the replica and reflected in the in-memory document, or
neither. A write that ultimately fails SHALL leave the in-memory document byte-for-byte
as it was before the mutation, SHALL leave the document's `last_modified` unchanged,
and SHALL NOT append a history entry for the change that did not happen.

This SHALL hold for every path that replaces the in-memory document: a local edit, a
desktop peer re-merge, an Android SAF pull, and a data-source switch.

The system SHALL report lock contention as a distinct error kind carrying a message
that names the likely cause and the fact that the edit was not saved, rather than
surfacing the underlying SQLite error text.

#### Scenario: Transient sync-client lock is ridden out
- **WHEN** another process holds a write lock on this device's replica
- **AND** it releases the lock within the retry budget
- **THEN** the write succeeds and the change is persisted, with no error shown

#### Scenario: A lock held past the budget fails without diverging
- **WHEN** another process holds a write lock for longer than the retry budget
- **THEN** the write reports a lock-contention error
- **AND** a subsequent read returns the document as it was before the attempted change
- **AND** no history entry is recorded for that change

#### Scenario: A non-lock database error is not retried
- **WHEN** a write fails for a reason other than lock contention
- **THEN** the failure is reported immediately without consuming the retry budget

#### Scenario: A failed peer re-merge does not adopt the merged document
- **WHEN** a peer change is detected and the merged document cannot be persisted
- **THEN** the in-memory document remains the pre-merge document
- **AND** no history entry is recorded for the merge
- **AND** the peer bookkeeping hashes are left so the merge is retried on a later poll

#### Scenario: A retried merge does not double-record history
- **WHEN** a merge that failed to persist succeeds on a later poll
- **THEN** its history entries are recorded exactly once

#### Scenario: A failed SAF pull does not adopt the incoming document
- **WHEN** an Android SAF pull merges an incoming document that cannot be persisted
- **THEN** the in-memory document remains the pre-merge document
- **AND** no history entry is recorded for the pull

#### Scenario: A failed data-source switch keeps the previous document
- **WHEN** the user switches data source and the incoming document cannot be persisted
- **THEN** the in-memory document remains the previous one

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

