## Why

Modern installs already use per-device `history_<device>.jsonl` beside `tasks_<device>.db`, but the code still creates, copies, and reads a bare `history.jsonl` sidecar. That legacy path is no longer wanted: it confuses sync folders and keeps a second naming scheme alive after the per-device model is the only supported layout.

## What Changes

- **BREAKING (data layout):** Stop creating, copying, and (after one-time migration) reading bare `history.jsonl`.
- On store open (and before seeding a new folder), if `history.jsonl` still sits beside the data file, migrate its lines into this device's `history_<device>.jsonl` (append, respect existing `dedup_key` dedup), then delete `history.jsonl`.
- `history_path` always resolves to `history_<device>.jsonl` (device id from `tasks_<device>.*`, else a stable fallback from the app device id / `"device"`) — never bare `history.jsonl`.
- Keep reading all peer `history_*.jsonl` sidecars; only drop the bare legacy filename.
- Update specs that still mention copying or retaining `history.jsonl`.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `archive-and-history`: One-time migrate-then-delete of bare `history.jsonl`; writes always go to `history_<device>.jsonl`; reads merge only `history_*.jsonl` peers.
- `multi-device-sync`: Relocating/seeding a data folder copies only the per-device history sidecar, not `history.jsonl`.

## Impact

- Rust: `src-tauri/src/history.rs` (`history_path`, replica discovery, append/read, `copy_own_history`, new migrate helper); `AppState::open` / repoint path in `store.rs` as needed; unit tests in `history.rs` / `store.rs`.
- Specs: `openspec/specs/archive-and-history`, `openspec/specs/multi-device-sync`.
- Existing sync folders that still contain `history.jsonl` are cleaned on next app open via migration (documented in the PR).
