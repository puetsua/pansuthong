## Context

The `SyncStatus` component renders a manual "Sync now" button plus a "Last synced" label in
both the desktop sidebar and the mobile shell. The button calls the `sync_now` Tauri
command, which just runs `crate::sync::reload_if_changed` immediately instead of waiting for
the next automatic tick. The automatic freshness path — an FS watcher plus a 2s polling
fallback set up in `sync.rs` — already calls the same `reload_if_changed` and is the real
guarantee. This is a pure removal; no data-model or on-disk change.

## Goals / Non-Goals

**Goals:**
- Remove the manual "Sync now" button and the mislabeled "Last synced" indicator from both
  shells, along with their supporting backend command, API wrapper, i18n keys, CSS, and tests.
- Keep the multi-device-sync spec accurate: freshness comes solely from watcher + poll.

**Non-Goals:**
- No change to the automatic watcher/polling behavior (`sync.rs`, `reload_if_changed`).
- No change to the Android SAF folder-sync UI in Settings (`saf_sync_now`,
  `settings.syncNow` / `settings.lastSynced`) — a distinct mechanism.

## Decisions

**Remove the `sync_now` backend command entirely** rather than leaving it as dead but
callable IPC. Rationale: after the UI is gone nothing invokes it; a registered command that
no frontend calls is latent surface area and drifts out of test coverage. `reload_if_changed`
(the reusable core) stays — only the thin command wrapper and its `invoke_handler`
registration go. Alternative considered: keep `sync_now` for possible future/manual use —
rejected as speculative; it can be re-added trivially if ever needed.

**Delete the whole `SyncStatus` component** rather than gutting it to only the label.
Rationale: the label is factually wrong (shows last-edit, not last-sync); a corrected passive
indicator would be new work outside this change's intent and wasn't requested.

## Risks / Trade-offs

- [Users lose a visible "sync is working" affordance] → Acceptable: the button gave false
  reassurance (local-disk re-read only). If a passive indicator is later wanted, it is a
  separate, better-scoped change.
- [A lingering caller of `api.syncNow` or `sync_now` breaks the build] → Mitigation: grep for
  `syncNow` / `sync_now` across `src/` and `src-tauri/` and confirm the SAF `saf_sync_now`
  variants are the only remaining matches; run `tsc`, `cargo check`, and the test suites.

## Migration Plan

Single PR. No migration or rollback data concerns — no persisted state touched. Rollback is a
plain revert. Verify with `npm run build`/`tsc`, `vitest`, and `cargo test` (desktop target).
