## Why

Desktop peers already exchange `tasks_<device>.db` and store blobs under `attachments_<device>/`, but Android SAF still pushes/pulls JSON and only mirrors top-level `attachment_*` files. PC↔phone cannot share one folder as first-class peers until SAF matches the desktop wire format (issues #120 and #122; deferred sqlite-data-store group 6).

## What Changes

- SAF push writes this device's `tasks_<device>.db` snapshot (not JSON); pull merges remote `.db` replicas (and still accepts legacy JSON peers) through the existing `merge_documents` path
- Sync bookkeeping uses document content hashes (same as desktop), not JSON/DB file bytes
- SAF attachment mirroring recurses into `attachments_<device>/` while still handling legacy flat `attachment_*`
- Conflict-copy mirroring and resolved-conflict deletion from the SAF folder stay as today
- No WAL/`-shm` sidecars are written into the SAF folder

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `android-folder-sync`: Bidirectional mirror uses `.db` replicas; attachment mirroring includes per-device subdirectories
- `attachments`: Clarify that Android SAF mirrors the same per-device subdirectory layout as desktop (no tombstone/GC changes here — those are #121/#123)

## Impact

- `src-tauri/src/safsync.rs` (push/pull, attachment mirror, `SafBackend` nested paths, Android backend, FakeBackend tests)
- `src-tauri/src/store.rs` (`adopt_synced` / `load_replacing_local` take `Document` + content hash)
- `src-tauri/src/commands.rs` (export `is_attachments_subdir` for SAF)
- Existing `db::load_from_bytes` / on-disk master `.db` for encode/decode
- Live Android device testing still needed after unit tests with `SafBackend` fake
