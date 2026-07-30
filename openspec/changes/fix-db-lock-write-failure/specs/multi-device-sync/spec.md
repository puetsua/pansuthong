## ADDED Requirements

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
