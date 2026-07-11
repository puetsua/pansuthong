## 1. History schema and device identity

- [x] 1.1 Extend `HistoryEntry` with optional `device_id`, `device_name`, and `dedup_key` (serde defaults; legacy lines still load)
- [x] 1.2 Add device-name helper (OS hostname, fallback to sanitized device_id) and stamp helpers for history entries
- [x] 1.3 Stamp device fields on local `AppState::write` history appends (thread device context into store)

## 2. Peer-merge history append + dedup

- [x] 2.1 In `reload_replicas_if_changed`, diff before/after; append history when merged Document content changes
- [x] 2.2 Filter merge-derived entries by stable `dedup_key` against this device's existing history sidecar
- [x] 2.3 Rust tests: merge appends once; second reload with same peers does not duplicate; device round-trip; legacy lines load

## 3. Frontend History view

- [x] 3.1 Extend TS `HistoryEntry` with optional device fields; show device name (or id fallback) in `HistoryView`; include in search
- [x] 3.2 Update History view tests / i18n as needed

## 4. Specs and issue hygiene

- [x] 4.1 Sync delta into `openspec/specs/archive-and-history/spec.md` (or archive/sync per project pattern)
- [x] 4.2 Comment on #126 with sidecar rationale and close as not planned; ensure PR references `Fixes #124`
