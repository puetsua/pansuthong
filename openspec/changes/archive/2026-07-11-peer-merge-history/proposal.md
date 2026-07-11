## Why

Peer merges update the live Document but do not append history, so the History view can omit changes that arrived via another device. Product decision (#124 option B): peer merges SHOULD append history with stable dedup so poll/reload does not spam duplicates, and entries should show a readable device identity.

## What Changes

- On peer-merge reload (`reload_replicas_if_changed`), diff before/after and append history entries when the merged document actually changed.
- Deduplicate merge-derived appends with a stable key so a second reload with the same peer state does not duplicate lines.
- Extend `HistoryEntry` with optional `device_id` / `device_name` (backward-compatible serde defaults); stamp them on local writes and merge-derived entries.
- Prefer OS hostname as the readable device name (no new Settings control); fall back to a sanitized device id.
- History UI shows the readable device name when present; legacy lines without device fields still load.
- Explicitly keep `history_<device>.jsonl` as a sidecar (closes the #126 open question: do not move history into SQLite).

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `archive-and-history`: Peer merge appends history with dedup; history entries carry optional device identity; History view surfaces device name.

## Impact

- Rust: `history.rs`, `store.rs` (`write`, `reload_replicas_if_changed`), possibly a small hostname helper; tests for merge append / dedup / device round-trip / legacy load.
- Frontend: `HistoryEntry` type, `HistoryView` (+ tests), i18n strings as needed.
- Specs: `openspec/specs/archive-and-history` via delta, then sync to main specs when archiving/applying.
- Out of scope: embedding history in SQLite (#126), new Settings UI for device display name.
