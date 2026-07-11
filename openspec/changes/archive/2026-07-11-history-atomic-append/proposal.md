## Why

History append uses create/append/flush. A crash mid-write can tear the last JSONL line (readers already skip torn lines). Make append crash-safer so prior entries are never corrupted (issue #125). Independent of peer-merge history product decision (#124).

## What Changes

- Rewrite `append_history` to an atomic strategy: read existing file (if any) + new lines into a temp file in the same directory, `fsync`, then rename over the target
- Keep torn-line skip on read as defense in depth
- Unit test covering append durability shape (temp+rename path; no partial last line left as the only survivor of a simulated failure where possible)

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `archive-and-history`: append SHALL be crash-safe (at worst lose the in-flight entry)

## Impact

- `src-tauri/src/history.rs` only
- No product change to what History records
