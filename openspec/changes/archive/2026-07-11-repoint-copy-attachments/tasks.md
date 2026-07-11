## 1. P0 — Copy own attachments on seed

- [x] 1.1 Add `copy_own_attachments(from_data_path, to_data_path)` (or equivalent): no-op when parents match; copy only `attachments_<device>/` recursively; leave source intact; skip peer `attachments_*` dirs
- [x] 1.2 Call the helper from `AppState::repoint` when `seeding` is true (beside `copy_own_history`); warn-and-continue on failure
- [x] 1.3 Unit tests: seed copies own attachment tree; source remains; peer `attachments_other/` not copied; same-parent no-op; adopt path does not overwrite/copy own tree over target (baseline for P0)

## 2. Specs

- [x] 2.1 Keep change deltas in sync with implementation; on archive/apply completion, sync main `openspec/specs/multi-device-sync` and `openspec/specs/attachments` (or rely on archive skill)

## 3. P1 — Adopt fill-missing (optional / deferred)

- [x] 3.1 (Optional) After adopt, copy only document-referenced managed attachment paths that are missing at the new folder and present at the old folder; never overwrite existing destination files
- [x] 3.2 (Optional) Tests: missing referenced blob is filled from old folder; existing destination blob is not replaced; unreferenced old blobs are not copied

## 4. Verify

- [x] 4.1 Run focused Rust tests for store/attachment/repoint coverage (`cargo test` for the new modules/tests)
- [ ] 4.2 Smoke on Pansutong Dev only: set data folder to empty dir with attachments present; confirm opens still work and old folder still has blobs
