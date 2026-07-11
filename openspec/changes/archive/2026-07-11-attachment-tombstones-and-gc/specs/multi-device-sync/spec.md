## ADDED Requirements

### Requirement: Attachment tombstones in the document merge

The system SHALL carry `deleted_attachments` tombstones in each per-device
document replica and merge them with last-`deleted_at`-wins, applying them when
computing the live attachment lists on tasks and templates.

#### Scenario: Latest attachment tombstone wins
- **WHEN** two replicas disagree on `deleted_at` for the same attachment id
- **THEN** the later `deleted_at` is kept in the merged document
