## Why

Attachment metadata unions by id with no tombstone, so a delete on one device is resurrected from a peer that still carries it. Blob GC only runs locally against the merged document's live refs, so cross-device deletes leave orphans until every replica drops the metadata. Issues #121 and #123.

## What Changes

- Add document-level `deleted_attachments` tombstones (same `Tombstone` shape as tasks/tags)
- On attachment remove, record a tombstone; merge suppresses attachments whose `created_at` is not newer than the tombstone (recreate still wins)
- Persist attachment tombstones in SQLite via existing `tombstones` table (`kind = attachment`)
- Strengthen blob GC: after local remove and after peer merge/reload, delete managed blobs whose path is unreferenced in the merged Document (opportunistic, any device, shared folder)
- Spec/docs: remove the "cross-device delete limitation" scenario; document GC rules

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `attachments`: tombstone delete propagation + clarified blob GC rules
- `multi-device-sync`: note attachment tombstones in the merge story (brief)

## Impact

- `model.rs` merge + Document field; `db.rs` tombstone kind; `commands.rs` remove + GC; `store.rs` post-merge GC hook
- `schemas/tasks.schema.json`, TS types if Document is exposed with the new field
- Tests for merge suppress/recreate and GC after tombstone
