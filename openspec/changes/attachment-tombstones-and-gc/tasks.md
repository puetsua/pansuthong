## 1. Model and persistence

- [x] 1.1 Add `deleted_attachments` to `Document` (+ compat/default)
- [x] 1.2 Persist/read `kind = attachment` tombstones in `db.rs`
- [x] 1.3 Update schema JSON / TS if Document exposes the field

## 2. Merge and remove

- [x] 2.1 Merge: collect attachment tombs; filter attachments by created_at vs deleted_at
- [x] 2.2 `remove_task_attachment` / `remove_template_attachment` record tombstones
- [x] 2.3 Tests: delete propagates; recreate survives

## 3. Blob GC

- [x] 3.1 Shared helper: GC all unreferenced managed blobs in the data folder
- [x] 3.2 Call after local remove/delete and after peer reload when doc changed
- [x] 3.3 Tests: GC after tombstone merge; shared path retained

## 4. Specs

- [x] 4.1 Update main `attachments` spec; mark tasks done
