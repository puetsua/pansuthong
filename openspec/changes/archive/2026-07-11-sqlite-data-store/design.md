## Context

Today the synced `Document` (tasks + tags + templates + tombstones) is persisted as a
per-device `tasks_<device>.json` file. Sync over a shared cloud folder (Google Drive)
is conflict-free precisely because **each device writes only its own replica** and reads
peers read-only; a merge (`merge_documents`, entity-level last-write-wins + tombstones,
with time entries and attachments unioned) reconstructs the visible document. A file
watcher plus a 2s poll picks up peer changes. On Android the app-private `tasks.json` is
the crash-safe master and a SAF mirror copies it to/from a user-picked folder.

This design moves the durable store to SQLite for transactional integrity and
incremental writes, **without** disturbing the per-device-file property that keeps Drive
conflict-free, and **without** touching the merge algorithm, the Tauri command surface,
or any frontend query. See `proposal.md` for motivation; the requirement-level contract
lives in the `local-data-store`, `multi-device-sync`, and `android-folder-sync` specs.

## Goals / Non-Goals

**Goals:**
- Persist the `Document` in a per-device SQLite database with transactional, incremental
  writes and crash safety stronger than temp+rename.
- Preserve conflict-free Drive sync: one replica per device (`tasks_<device>.db`),
  written only by its owner, read-only for peers.
- Never expose a live/WAL database or its `-wal`/`-shm` sidecars to the cloud folder.
- Reuse `merge_documents` unchanged: a `.db` replica is just another serialization of a
  `Document`.
- Migrate existing JSON stores losslessly, preserving every backward-compatible legacy
  key fold, and keep JSON as a downgrade fallback.
- Keep the Rust model as the single source of truth for entity shape (no second schema
  to keep in sync).

**Non-Goals:**
- No relational query engine behind the views — views stay computed in the frontend from
  the in-memory `Document`.
- Settings/data-folder (`config.json`) and the history sidecar (`history_<device>.jsonl`)
  do not move into SQLite.
- Attachment blobs stay as files under `attachments_<device>/`.
- No change to merge semantics, conflict UX, IPC types, or active-view behavior.

## Decisions

### D1: `rusqlite` with bundled SQLite
Use `rusqlite` with the `bundled` feature so SQLite is compiled into the binary — no
system library dependency, and it builds for the `aarch64-linux-android` target the same
way it does for desktop. *Alternatives:* `sqlx` (async runtime + compile-time query
checking is overkill for a single-file embedded store); `libsql`/`turso` (remote-first,
heavier than needed). Per project memory, CI only builds desktop, so the Android link of
the bundled C build must be verified locally with `cargo check --target aarch64-linux-android`.

### D2: Blob-per-entity schema, not full normalization
Each entity type gets a table shaped `(<id> PRIMARY KEY, edit_stamp INTEGER, deleted_at
INTEGER NULL, data TEXT)` where `data` is the serde-JSON of the exact Rust model entity,
and `edit_stamp`/`deleted_at` are promoted to columns for indexed merge queries. A `meta`
table holds document-level fields (`last_modified`); the schema version lives in
`PRAGMA user_version`.

*Rationale:* the non-negotiable "model changes stay backward-compatible via serde
defaults/aliases" carries straight over — storing the entity as its serialized model
means a new optional field never requires a SQL migration, and there is no second schema
that can drift from `model.rs`. We still get transactions, per-entity incremental writes,
and indexed LWW/tombstone lookups. *Alternative:* fully normalized columns per field —
rejected: doubles maintenance (every model field → a migration), and risks the
backward-compat invariant. Nested lists (`tag_ids`, `time_entries`, `attachments`) would
need child tables purely to be re-flattened for the in-memory `Document` anyway.

### D3a: First implementation is a single-file rollback-journal store (revises D3)
Mapping the integration surface showed the fully-isolated working-DB + snapshot split
(D3) adds large churn — `state.path()` feeds ~40 call sites and the byte/JSON APIs drive
the Android `safsync` layer — for a small safety gain. The **first implementation**
therefore uses a single SQLite database living at the replica path
(`<folder>/tasks_<device>.db`) opened in **rollback-journal mode (`DELETE`)**, which
leaves exactly one file at rest (no persistent `-wal`/`-shm` sidecars), directly
addressing the original cloud-sync-corruption concern. The only residual exposure is the
sub-millisecond `-journal` window during a commit; peers guard against reading a torn file
with `PRAGMA quick_check` and skip-then-retry. This is delivered **desktop-first** (two PC
instances against a shared folder are fully verifiable here); the Android `safsync` layer
keeps its JSON wire format until a follow-up converts it with on-device testing. The
`VACUUM INTO` snapshot split (D3, below) remains the fallback if the two-device test ever
shows mid-write corruption.

### D3: Local WAL working DB + checkpointed snapshot for sync (deferred fallback)
The **working** database lives in app-private local storage (never synced) in WAL mode
for fast transactional writes. On each debounced change, publish a **snapshot** to the
synced data folder via `VACUUM INTO '<folder>/tasks_<device>.db'`, which produces a
single, self-contained, transactionally-consistent file with no `-wal`/`-shm` sidecars.

*Rationale:* Drive never observes a live database mid-transaction, and there are no
sidecar files to partially sync. This also **unifies desktop with Android** — both
become "local master + folder mirror", collapsing two code paths. *Alternatives:* keep a
single DB directly in the synced folder with `journal_mode=DELETE` — rejected: Drive can
still upload the file mid-transaction and sidecar/lock races remain; `.backup` API — a
fine equivalent to `VACUUM INTO`, chosen `VACUUM INTO` for its single-statement
atomicity.

### D4: Peer replicas read read-only and defensively
Peers' `tasks_<device>.db` are opened read-only/immutable, `PRAGMA quick_check`'d (or
version-read) before decode, and skipped on any failure — mirroring today's behavior
where an unparseable JSON replica is skipped rather than aborting the merge. Each decodes
to a `Document` and feeds the unchanged `merge_documents`.

### D5: Version gate via `user_version`
The running build stores `CURRENT_VERSION` in `PRAGMA user_version`. A replica (or
snapshot) whose `user_version` exceeds the build's supported version is refused, not
decoded — same "update the app" semantics as the JSON version gate, so a newer device
cannot get its fields silently stripped by an older one.

### D6: Content-hash change detection (replaces byte-hash loop suppression)
Loop suppression moves from hashing the snapshot file bytes to hashing the **decoded
document's canonical serialization**, because `VACUUM INTO` snapshots are not
byte-deterministic (D3). The content hash is computed one layer up (over task data, not
storage bytes), so two snapshots of identical data hash equal. It is stored as a row in
the snapshot's `meta` table so a peer's hash can be read cheaply — a **fast pre-filter**
to skip decoding a peer whose content is unchanged. The stored hash is never the
authority: when it differs or is absent, the app falls back to decoding and merging by
per-entity edit stamps (which travel with each entity and cannot drift), so a stale or
version-mismatched hash can at worst cause an unnecessary decode, never silent data loss.
`last_modified` may serve as an even cheaper first pre-filter. The `adopt_synced` path
changes from "write peer bytes verbatim" to "adopt the peer's decoded document and
re-materialize the local database from it." The in-memory `AppState` hash fields stay
in memory (no new persistence for the local side); only their input changes.
*Cost:* a full decode is milliseconds at task-tracker scale — no worse than today's JSON
store, which already re-parses the whole file each poll — and happens only when the
pre-filter signals a real change.

### D7: Migration by dual-read
On store open: if the local working DB is absent but a legacy `tasks_<device>.json` (or
`tasks.json`) exists, import it through the existing parse/merge (preserving all legacy
key folding) into a fresh DB, then emit the first snapshot. The JSON file is left in place
as a rollback fallback for a downgrade window.

## Risks / Trade-offs

- **A peer `.db` is read mid-Drive-sync (partially uploaded)** → snapshots are whole-file
  atomic writes on the writer side; on the reader side, open immutable + `quick_check` and
  skip a replica that fails integrity, retrying on the next watcher/poll tick (the file is
  eventually consistent once Drive finishes).
- **Bundled SQLite fails to link for Android** → verify early with
  `cargo check/clippy --target aarch64-linux-android`; treat as a gating task before UI work.
- **Two on-disk artifacts (local working DB + synced snapshot) drift** → the snapshot is
  always derived from the working DB by `VACUUM INTO`; the working DB is the sole writer,
  the snapshot is a pure projection, never edited in place.
- **Binary size / dependency surface grows** → bundled SQLite is a known, bounded cost;
  acceptable for the transactional-integrity gain.
- **Downgrade after migration** → JSON file retained as fallback; an older build keeps
  reading it. Document the retention window in `releases.md`.
- **Snapshot churn on rapid edits** → reuse the existing write debounce so `VACUUM INTO`
  runs at most once per debounce window, not per keystroke.
- **Byte-hash loop suppression breaks** (surfaced during implementation) → today `store.rs`
  suppresses cross-device sync echoes by `sha256`-ing the file *bytes*, and `adopt_synced`
  writes a peer's bytes **verbatim** so the on-disk file, in-memory doc, and stored hash all
  agree. A `VACUUM INTO` snapshot is **not** byte-deterministic (page layout/freelist can
  differ for identical logical content), so byte-hashing a snapshot would never de-dup and
  would loop. Group 3 must switch loop-suppression to a **content identity of the decoded
  `Document`** (e.g. hash of its canonical serialization, or reuse `last_modified`) rather
  than the snapshot file bytes, and replace the "adopt verbatim bytes" path with "adopt the
  decoded document and re-materialize locally." This is the central subtlety of the store
  rework and why it is sequenced after the tested DB foundation.

## Migration Plan

1. Ship dual-read: prefer the local `.db`; if absent, import the legacy JSON replica.
2. First run on each device imports JSON → DB and writes `tasks_<device>.db` into the sync
   folder; the old `tasks_<device>.json` is left untouched.
3. Peers that have upgraded read each other's `.db`; a not-yet-upgraded peer still reads
   its own JSON and is merged once it upgrades (cross-version overlap window).
4. Rollback: an older build ignores the unknown `.db` and continues from the retained JSON.
5. After a retention window (a few releases), a later change may stop writing JSON.

## Open Questions

- Retention window length before JSON writes are dropped — pick during rollout, record in
  `releases.md`.
- Snapshot cadence: is the current 250ms write debounce the right `VACUUM INTO` interval,
  or should snapshots coalesce on a longer timer to reduce Drive upload churn?
- Should the history sidecar and settings eventually move into SQLite too, or stay
  separate files? Out of scope here; revisit if this change proves out.
