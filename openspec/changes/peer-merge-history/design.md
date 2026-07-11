## Context

`AppState::write` diffs before/after and appends to `history_<device>.jsonl`.
`AppState::reload_replicas_if_changed` re-merges peer replicas into the local DB when
`peers_hash` changes, but does not append history. History is federated at read time
across all `history_*.jsonl` sidecars. There is no user-editable device display name in
Settings (only a read-only `device_id`); AGENTS.md forbids new Settings controls without
explicit approval.

Issue #124 chose option B: append merge-derived history with dedup. Issue #126 asked
whether history should move into SQLite; product decision is to keep the JSONL sidecar.

## Goals / Non-Goals

**Goals:**
- Append history when a peer merge changes the live Document.
- Prevent duplicate lines from repeated polls/reloads of the same peer state.
- Stamp device id + readable name on history entries (local writes and merge appends).
- Show device name in the History UI when present; load legacy lines without those fields.
- Keep history as per-device JSONL sidecars.

**Non-Goals:**
- Moving history into SQLite (#126).
- New Settings UI for a custom device display name.
- Cross-device semantic dedup of federated history (peer’s own write + this device’s
  merge observation may both appear; that is acceptable for a per-device audit log).
- Changing merge/LWW semantics or inventing new event types for synced changes.

## Decisions

### D1: Diff on merge reload, append only when Document content changes
In `reload_replicas_if_changed`, clone `before`, merge, and if `content_hash(before) !=
content_hash(merged)`, call `entries_for_change` and append. The existing `peers_hash`
fast path already skips work when peers are unchanged; the content-hash gate covers the
case where peer bytes/files changed but the merged Document did not.

*Alternative:* always append on any reload — rejected (spam / empty noise).

### D2: Stable dedup keys for merge appends
Before appending merge-derived entries, filter out any whose dedup key already exists in
this device’s history sidecar. Key = `(event, entity, entity_id, source_updated_at)` where
`source_updated_at` is the winning entity’s `updated_at` (or tombstone stamp for deletes)
serialized into an optional `dedup_key` field (or derived at append time and stored).

Storing an optional `dedup_key: Option<String>` on `HistoryEntry` (serde default `None`)
keeps the filter cheap and stable across polls even if timestamps of the history line
differ. Local `write()` entries may omit `dedup_key` or use the same scheme for
consistency.

*Alternative:* rely only on `peers_hash` — mostly sufficient, but a belt-and-suspenders
key prevents duplicates if reload paths expand (e.g. `adopt_synced`) or hash bookkeeping
regresses.

### D3: Device identity without new Settings
- `device_id`: from `Config.device_id` (already exists).
- `device_name`: OS hostname via `hostname` crate or equivalent; if empty/unavailable,
  fall back to a short sanitized form of `device_id`.
- Both fields optional on `HistoryEntry` with `#[serde(default, skip_serializing_if =
  "Option::is_none")]` (or empty-string defaults) for backward compatibility.
- Pass device identity into `append_history` / `entries_for_change` (or stamp after
  diff) from `write` and merge reload. `AppState` needs access to device id/name —
  either store them on `AppState` at open, or accept them as arguments on write/reload
  call sites. Prefer stamping in `store` when appending so `history::entries_for_change`
  stays pure.

*Alternative:* add Settings “device name” — rejected without user approval for new
Settings controls.

### D4: History stays JSONL sidecar (#126)
Do not embed history in the Document DB. Rationale: append-only federated audit vs
LWW+tombstone state are different consistency models; local DB is fully rewritten on
merge; per-device JSONL already attributes writers; `sqlite-data-store` already deferred
this. Document on #126 and close as not planned.

### D5: Frontend surfaces `device_name`
Extend TS `HistoryEntry` with optional `device_id` / `device_name`. History row shows
the name (or id fallback) when present; search includes device fields. No layout
overhaul.

## Risks / Trade-offs

- [Federated duplicate] Peer’s local history line + this device’s merge observation for
  the same edit → Mitigation: accept as dual audit; do not cross-dedup in this change.
- [Hostname quality] Hostname may be opaque on some devices → Mitigation: fall back to
  sanitized device_id; Settings rename deferred.
- [adopt_synced / open merge] Startup `open` also merges peers without history today →
  Mitigation: scope this change to `reload_replicas_if_changed` (poll path); startup
  cold-merge history is a follow-up if needed.
- [AppState device context] Store currently has no config handle → Mitigation: thread
  device id/name into reload/write from callers, or cache on `AppState` at construction
  in `lib.rs` / commands.

## Migration Plan

- Old JSONL lines without device fields continue to deserialize.
- New fields are additive; no data migration.
- Rollback: revert code; existing new lines remain readable by older builds if unknown
  fields are ignored by serde (confirm `deny_unknown_fields` is not set on
  `HistoryEntry`).

## Open Questions

- None blocking. Startup `open` merge history left as optional follow-up.
