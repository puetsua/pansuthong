## Context

`AppState::repoint` (`src-tauri/src/store.rs`) already distinguishes two paths:
**seed** when the target holds no task replicas, and **adopt** otherwise. Adopt
loads `merge_documents(target_docs)` and discards the current document. The UI
(`DataFolderSection.tsx`) does not know which path will run, so it always shows the
same Copy / Move dialog. On the adopt path, Move then runs `remove_own_payload`,
deleting the old folder's own replica, history, and attachments even though the
current document was never carried over (#253).

## Goals / Non-Goals

**Goals:**
- Let the UI know, before asking, whether the target holds Pansuthong data.
- Offer Merge vs Adopt when it does; Copy vs Move only when it does not.
- Make data loss on the existing-data path impossible at the backend, not only in the UI.
- Shorter, outcome-first dialog copy.

**Non-Goals:**
- Android SAF folder linking (its own adopt/seed flow is unchanged).
- Any change to peer-sync merge semantics or the on-disk format.

## Decisions

**Extend `TransferMode` with `Merge` and `Adopt`** rather than adding a second
parameter. One enum keeps `set_data_folder(folder, transfer_mode)` /
`clear_data_folder(transfer_mode)` signatures and the TS `TransferMode` union
(`"copy" | "move" | "merge" | "adopt"`), so call sites only widen. A separate
`existing_data_choice` param was considered but would allow nonsensical
combinations (Move + Merge).

**Backend enforces the pairing.** `repoint` computes `seeding` from the target
itself. If the target has data and the mode is Copy/Move, it returns
`AppError::Invalid` before touching anything — this closes the Move data-loss bug
even if the UI is stale (e.g. a cloud sync drops a replica into the folder between
inspection and confirmation). If the target is empty and the mode is Merge/Adopt,
it seeds with Copy semantics: merging into or adopting nothing equals a seed, and
Copy never deletes.

**Merge = `merge_documents(target_docs + [current])`.** Reuses the peer-sync
LWW + tombstone merge, so behavior matches what would happen if the old replica
had simply been synced into the folder. The merged doc is persisted as this
device's replica in the target.

**Existing-data history: line union on Merge, nothing on Adopt.** A target may
hold a stale `history_<device>.jsonl` from an earlier stint in that folder;
"copy only if missing" would then hide everything recorded since. Merge appends
old-sidecar lines absent from the target sidecar (exact-line set, new
`merge_own_history`); `read_history` sorts by timestamp, so append order is
irrelevant. Adopt copies no history (today's behavior: the adopted document is
not this device's old one). Attachments keep using
`fill_missing_referenced_attachments` against the resulting document. Neither path
calls `remove_own_payload`.

**Current document is cloned under the `inner` lock**, after target docs are
collected; the Copy/Move rejection runs before `persist_document`.

**Inspection command `inspect_data_folder(folder: Option<String>) -> { hasData, isCurrent }`.**
`isCurrent` compares the candidate with the current data file's parent the same
way `remove_own_payload` does; the UI does nothing when it is true.
Factor the target-detection block of `repoint` into `target_docs(path)` /
`folder_has_data(path)` in `store.rs` so inspection and repoint cannot disagree.
`None` resolves to the default app-data dir, mirroring `clear_data_folder`.
A non-directory folder returns the same invalid-input error as `set_data_folder`.

**UI: one dialog component, two variants.** `DataFolderTransferDialog` takes
`hasData` and maps buttons to modes. Inspection runs right after the folder picker
(or on Use default location); errors surface in the section's existing error line.

## Risks / Trade-offs

- [Target changes between inspect and confirm] → backend recomputes and rejects
  Copy/Move on data; UI shows the error and the user retries.
- [Merge resurrects tasks the user deleted on another device] → no: tombstones in
  target replicas win under LWW, same as normal peer sync.
- [Adopt still drops the current document from memory] → intended; the old folder
  is left untouched, so switching back restores it.
- [Inspection decodes every replica in a large folder] → same cost as repoint
  already pays; runs once per folder pick.
