//! Durable store over SQLite.
//!
//! The synced `Document` is persisted in a per-device SQLite database at the
//! replica path (`<folder>/tasks_<device>.db`), opened in rollback-journal mode so
//! exactly one file exists at rest (no `-wal`/`-shm` sidecars for a cloud-sync
//! client to sync out of step). Peers write their own `tasks_<device>.db`; this
//! device reads them read-only and merges with the existing entity-level
//! last-write-wins + tombstone merge — the `.db` is just another serialization of a
//! `Document`.
//!
//! Cross-device change detection uses a **content hash** of the decoded document
//! (not the file bytes), because two databases with identical content are not
//! byte-identical. The Android SAF path (`safsync`) exchanges `.db` replicas the
//! same way and uses the same content-hash bookkeeping via
//! `adopt_synced`/`load_replacing_local`.

use crate::error::{AppError, Result};
use crate::model::{merge_documents, Document, CURRENT_VERSION};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use parking_lot::FairMutex;
use std::sync::{Arc, RwLock};

/// What to do when relocating the data folder. `Copy` / `Move` apply to a target
/// without task data (seed); `Merge` / `Adopt` to a target that already has some.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferMode {
    /// Seed the new location; leave own files in the old folder intact.
    Copy,
    /// Seed, then (after a successful transfer) remove only this device's files
    /// from the old folder.
    Move,
    /// Merge the current document with the target's data; old folder untouched.
    Merge,
    /// Use the target's data as-is, dropping the current document; old folder untouched.
    Adopt,
}

/// Every non-empty task document already present in the folder of `path`: peer
/// replicas, a legacy `tasks.json`, and the own replica. Empty replicas (a peer
/// that linked and was wiped) are skipped, so "Use folder's data" can never swap
/// the current tasks for nothing. Empty = nothing to adopt.
fn target_docs(path: &Path) -> Result<Vec<Document>> {
    let holds_data = |d: &Document| doc_has_data(d) || !d.template_tasks.is_empty();
    let mut docs: Vec<Document> = collect_peer_docs(path).into_iter().filter(holds_data).collect();
    if let Some(legacy) = legacy_doc(path).filter(holds_data) {
        docs.push(legacy);
    }
    if let Some(existing) = read_db_if_present(path)? {
        docs.push(existing);
    }
    Ok(docs)
}

/// True when the folder of `path` (this device's data file there) already holds
/// Pansuthong task data — the same test `repoint` uses to pick seed vs. existing.
pub fn folder_has_data(path: &Path) -> Result<bool> {
    Ok(!target_docs(path)?.is_empty())
}

pub struct AppState {
    /// Fair so writers are served in arrival order: with `std::sync::Mutex` a UI
    /// command could be overtaken again and again by queued MCP writers (#249 N5).
    inner: FairMutex<Inner>,
    /// Serializes rewrites of this device's history sidecar. `write` takes it before
    /// releasing `inner` and appends after, so the next writer can persist while
    /// this one rewrites the sidecar, and lines still land in commit order. Always
    /// taken after `inner`, never before.
    history: FairMutex<()>,
    /// Last committed state, republished (under `inner`) by every mutation. Reads
    /// take this lock only to copy the `Arc`, so the UI never queues behind a writer
    /// that holds `inner` while it persists the document (#249 N5).
    snapshot: RwLock<Arc<Snapshot>>,
}

/// What readers see: the committed document plus the bits of store state that UI
/// commands poll on the main thread.
struct Snapshot {
    doc: Arc<Document>,
    path: PathBuf,
    pending: bool,
}

impl Snapshot {
    fn of(inner: &Inner) -> Arc<Self> {
        Arc::new(Self {
            doc: inner.doc.clone(),
            path: inner.path.clone(),
            pending: inner.pending,
        })
    }
}

struct Inner {
    /// Live connection only for the in-memory pending store. File-backed stores
    /// leave this `None` between writes so a cloud-sync client can exclusive-open
    /// the replica (Windows `CreateFile` with `share_mode` 0). Holding the handle
    /// across idle is what made a 15s+ OneDrive lock unrecoverable without restart
    /// (#179).
    conn: Option<Connection>,
    /// Shared with the published [`Snapshot`]; a write builds the next document
    /// beside it and swaps the `Arc` only once the change is durable.
    doc: Arc<Document>,
    path: PathBuf,
    /// Content hash of our own document (compact serialization), computed lazily:
    /// only the replica poll and folder-sync bookkeeping need it, so a write just
    /// invalidates it instead of serializing the whole document under the lock.
    own_hash: Option<[u8; 32]>,
    /// Combined content hash of peer replicas, so the poll can detect a peer
    /// change cheaply. Excludes our own replica.
    peers_hash: [u8; 32],
    /// This device's id (from the replica filename) and readable name for history.
    device_id: String,
    device_name: String,
    /// True when the store is a temporary stand-in because the real data folder
    /// isn't available yet (e.g. Google Drive not mounted at boot).
    pending: bool,
}

impl Inner {
    fn own_hash(&mut self) -> [u8; 32] {
        *self.own_hash.get_or_insert_with(|| content_hash(&self.doc))
    }

    /// Persist `self.doc`. File-backed stores open, write, and drop the replica so
    /// a sync client can exclusive-open it; the in-memory pending store keeps its
    /// connection because there is no file.
    fn persist(&mut self) -> Result<()> {
        if self.pending {
            let conn = self.conn.as_mut().ok_or_else(|| {
                AppError::Invalid("pending store is missing its in-memory connection".into())
            })?;
            crate::db::write_document(conn, &self.doc)
        } else {
            self.conn = None;
            crate::db::persist_document(&self.path, &self.doc)
        }
    }

    /// Persist `next` over the committed `self.doc`, which the backing already holds,
    /// writing only the rows that differ.
    fn persist_next(&mut self, next: &Document) -> Result<()> {
        if self.pending {
            let conn = self.conn.as_mut().ok_or_else(|| {
                AppError::Invalid("pending store is missing its in-memory connection".into())
            })?;
            crate::db::write_document_since(conn, &self.doc, next)
        } else {
            self.conn = None;
            crate::db::persist_document_since(&self.path, &self.doc, next)
        }
    }
}

impl AppState {
    /// Open the store at `path`, migrating/merging any sibling replicas (and a
    /// legacy JSON file) into the local database.
    pub fn open(path: PathBuf) -> Result<Self> {
        ensure_parent(&path)?;
        let device_id =
            crate::config::device_id_from_data_path(&path).unwrap_or_else(|| "device".to_string());
        let device_name = crate::config::resolve_device_name(&device_id);
        // One-time: fold bare `history.jsonl` into `history_<device>.jsonl`, then delete it.
        if let Err(e) = crate::history::migrate_legacy_history_jsonl(&path) {
            eprintln!("warning: failed to migrate legacy history.jsonl: {e}");
        }
        let conn = crate::db::open(&path)?;
        // Our own database (empty on a fresh install).
        let working = crate::db::read_document(&conn)?;
        // Merge in peers + a legacy JSON file (migration), preferring newer edits.
        let mut docs = collect_peer_docs(&path);
        if let Some(legacy) = legacy_doc(&path) {
            docs.push(legacy);
        }
        if doc_has_data(&working) || docs.is_empty() {
            docs.push(working);
        }
        let doc = merge_documents(docs);
        // Drop before persist so we never hold two handles on a cloud-synced path.
        drop(conn);
        crate::db::persist_document(&path, &doc)?;
        let own_hash = content_hash(&doc);
        let peers_hash = peers_content_hash(&path);
        Ok(Self::from_inner(Inner {
            conn: None,
            doc: Arc::new(doc),
            path,
            own_hash: Some(own_hash),
            peers_hash,
            device_id,
            device_name,
            pending: false,
        }))
    }

    fn from_inner(inner: Inner) -> Self {
        let snapshot = RwLock::new(Snapshot::of(&inner));
        Self {
            inner: FairMutex::new(inner),
            history: FairMutex::new(()),
            snapshot,
        }
    }

    /// Republish after a mutation. Called with `inner` held so snapshots appear in
    /// commit order.
    fn publish(&self, inner: &Inner) {
        *self.snapshot.write().unwrap_or_else(|e| e.into_inner()) = Snapshot::of(inner);
    }

    fn snapshot(&self) -> Arc<Snapshot> {
        self.snapshot.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Run `f` on the last committed document. Never waits for an in-progress
    /// write: it sees the document as of the most recent successful commit.
    pub fn read<F, T>(&self, f: F) -> T
    where
        F: FnOnce(&Document) -> T,
    {
        f(&self.snapshot().doc)
    }

    /// True when the store is a temporary stand-in because the real data folder
    /// isn't available yet (e.g. Google Drive not mounted at boot). The frontend
    /// should show a loading screen and call `retry_open`.
    pub fn is_pending(&self) -> bool {
        self.snapshot().pending
    }

    /// Create a temporary in-memory store used when the real data folder isn't
    /// available yet (e.g. Google Drive not mounted at boot). The frontend shows a
    /// loading screen and calls `retry_open` to switch to the real store once the
    /// folder becomes available.
    pub fn open_in_memory(device_id: &str, intended_path: PathBuf) -> Result<Self> {
        let device_name = crate::config::resolve_device_name(device_id);
        let conn = crate::db::open_in_memory()?;
        let doc = Document::default();
        let own_hash = content_hash(&doc);
        let peers_hash = [0; 32];
        Ok(Self::from_inner(Inner {
            conn: Some(conn),
            doc: Arc::new(doc),
            path: intended_path,
            own_hash: Some(own_hash),
            peers_hash,
            device_id: device_id.to_string(),
            device_name,
            pending: true,
        }))
    }

    /// Try to open the real data store at the path stored when this pending store
    /// was created. If successful, replaces the in-memory stand-in with the real
    /// store (merging peers, migrating legacy data, etc.). Returns `true` when the
    /// store was opened successfully.
    ///
    /// Only attempts the open when the configured folder already exists (is
    /// mounted/available). `AppState::open` calls `ensure_parent` →
    /// `create_dir_all`, which would *create* a missing folder and open an empty
    /// database there — masking the "folder not available" state and silently
    /// showing empty data instead of the loading screen. Checking `is_dir` first
    /// ensures we only open when the cloud-sync client has actually mounted the
    /// folder.
    pub fn retry_open(&self) -> Result<bool> {
        let mut g = self.inner.lock();
        if !g.pending {
            return Ok(true); // already open
        }
        let intended = g.path.clone();
        // The parent directory is the configured data folder. It only exists when
        // the cloud-sync client (e.g. Google Drive) has mounted/synced it. Don't
        // create it — that would mask the "folder not available" state.
        let parent_ready = intended.parent().is_none_or(|p| p.is_dir());
        if !parent_ready {
            return Ok(false);
        }
        // The folder is available — open the real store (merging peers, etc.).
        let real = match Self::open(intended) {
            Ok(s) => s,
            Err(_) => return Ok(false),
        };
        let real_inner = real.inner.into_inner();
        g.conn = real_inner.conn;
        g.doc = real_inner.doc;
        g.path = real_inner.path;
        g.own_hash = real_inner.own_hash;
        g.peers_hash = real_inner.peers_hash;
        g.device_id = real_inner.device_id;
        g.device_name = real_inner.device_name;
        g.pending = false;
        self.publish(&g);
        Ok(true)
    }

    /// Abandon the pending in-memory store and open a real one at `path` (e.g.
    /// the default app-data directory). Used when the user gives up waiting for
    /// the configured cloud folder and chooses to use the default location instead.
    pub fn open_at(&self, path: PathBuf) -> Result<()> {
        let real = Self::open(path)?;
        let real_inner = real.inner.into_inner();
        let mut g = self.inner.lock();
        g.conn = real_inner.conn;
        g.doc = real_inner.doc;
        g.path = real_inner.path;
        g.own_hash = real_inner.own_hash;
        g.peers_hash = real_inner.peers_hash;
        g.device_id = real_inner.device_id;
        g.device_name = real_inner.device_name;
        g.pending = false;
        self.publish(&g);
        Ok(())
    }

    /// Mutate then persist in a single transaction. Bumps `last_modified` and
    /// stamps the current schema `version`, then appends the change to the history
    /// sidecar. The content hashes are refreshed so the poll won't treat our own
    /// write as a peer change.
    pub fn write<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Document) -> Result<T>,
    {
        let mut g = self.inner.lock();
        // Mutate a copy so readers keep the committed document until this one is
        // durable; a rejected or failed write just drops `next`.
        let mut next = Document::clone(&g.doc);
        let value = f(&mut next)?;
        // Structural equality instead of hashing: a write never hashes the document.
        if next == *g.doc {
            return Ok(value);
        }
        let ts = crate::model::now_ms();
        let mut history = crate::history::entries_for_change(&g.doc, &next, ts);
        crate::history::stamp_device(&mut history, &g.device_id, &g.device_name);
        next.last_modified = ts;
        next.version = CURRENT_VERSION;
        // A failed persist leaves the committed document in place, so the app never
        // reports a change that never reached disk.
        g.persist_next(&next)?;
        // The cached hash is recomputed on demand. `peers_hash` is left alone: our
        // own replica is not part of it, and refreshing it here (decoding every peer
        // replica under the lock on each write) could also mark a peer change as
        // seen before the poll merged it.
        g.own_hash = None;
        g.doc = Arc::new(next);
        self.publish(&g);
        let path = g.path.clone();
        let _history = self.history.lock();
        drop(g);
        if let Err(e) = crate::history::append_history(&path, &history) {
            eprintln!("warning: failed to append history: {e}");
        }
        Ok(value)
    }

    /// Re-merge if any peer replica changed. Returns `true` when a reload happened.
    /// When the merged Document differs from the pre-merge Document, appends
    /// history entries (with stable dedup) so peer-visible changes appear in History.
    pub fn reload_replicas_if_changed(&self) -> Result<bool> {
        let path = self.path();
        // Cheap fast path: hash peers without holding the lock so the 2s poll
        // doesn't block command handlers on every (usually no-op) tick.
        let peers_hash = peers_content_hash(&path);
        {
            let g = self.inner.lock();
            if peers_hash == g.peers_hash {
                return Ok(false);
            }
        }
        // A peer changed. Hold the lock across the whole re-merge-and-assign so a
        // concurrent write() can't have its just-persisted edit clobbered.
        let mut g = self.inner.lock();
        let before = g.doc.clone();
        let mut docs = collect_peer_docs(&g.path);
        docs.push(Document::clone(&before));
        let merged = merge_documents(docs);
        let merged_hash = content_hash(&merged);
        let merge_changed_something = g.own_hash() != merged_hash;
        let inner = &mut *g;
        inner.doc = Arc::new(merged);
        // Same atomicity rule as `write`: if the merged document cannot be persisted,
        // keep the pre-merge one in memory. Leaving `peers_hash` un-refreshed means the
        // peer still reads as changed, so a later poll retries the merge on its own.
        if let Err(e) = inner.persist() {
            g.doc = before;
            return Err(e);
        }
        // History is appended only once the merge is durable, matching `write`: a
        // change that never reached disk must not show up in History. The retry on a
        // later poll re-derives the same entries, and `filter_unseen_entries` keeps
        // that from double-recording them.
        if merge_changed_something {
            let _history = self.history.lock();
            let ts = crate::model::now_ms();
            let history = crate::history::entries_for_change(&before, &g.doc, ts);
            match crate::history::filter_unseen_entries(&g.path, history) {
                Ok(mut filtered) => {
                    crate::history::stamp_device(&mut filtered, &g.device_id, &g.device_name);
                    if let Err(e) = crate::history::append_history(&g.path, &filtered) {
                        eprintln!("warning: failed to append merge history: {e}");
                    }
                }
                Err(e) => eprintln!("warning: failed to dedup merge history: {e}"),
            }
        }
        g.own_hash = Some(merged_hash);
        g.peers_hash = peers_content_hash(&g.path);
        self.publish(&g);
        drop(g);
        // Attachment tombstones from peers may have dropped live refs — GC orphans.
        crate::commands::gc_unreferenced_attachment_blobs(self);
        Ok(true)
    }

    pub fn path(&self) -> PathBuf {
        self.snapshot().path.clone()
    }

    #[allow(dead_code)] // used by tests and the folder-sync bookkeeping
    pub fn last_written_hash(&self) -> [u8; 32] {
        self.inner.lock().own_hash()
    }

    /// Relocate the store to `new_path`.
    ///
    /// Target without task data (seed): write the current document there and copy
    /// this device's history and attachments. [`TransferMode::Copy`] leaves the old
    /// folder intact; [`TransferMode::Move`] then removes this device's files from
    /// it. `Merge` / `Adopt` on an empty target seed like `Copy`.
    ///
    /// Target with task data: [`TransferMode::Merge`] merges the current document
    /// into it (entity-level LWW, as peer sync does) and unions own history;
    /// [`TransferMode::Adopt`] loads it and discards the current document (no
    /// conflict file). Missing referenced attachments are filled in; nothing in the
    /// old folder is ever deleted. `Copy` / `Move` are rejected here, since `Move`
    /// would delete the only copy of the current document.
    ///
    /// Validated before anything is written, so an invalid target or a rejected
    /// mode leaves the current store intact. Peer files are never touched.
    pub fn repoint(&self, new_path: PathBuf, transfer_mode: TransferMode) -> Result<()> {
        ensure_parent(&new_path)?;
        let mut target_docs = target_docs(&new_path)?;
        let seeding = target_docs.is_empty();
        if !seeding && matches!(transfer_mode, TransferMode::Copy | TransferMode::Move) {
            return Err(AppError::Invalid(
                "the chosen folder already has Pansuthong data; choose Merge or Use folder's data"
                    .into(),
            ));
        }
        let mut g = self.inner.lock();
        // The sidecar moves with the store; no append may land mid-transfer.
        let _history = self.history.lock();
        let old_path = g.path.clone();
        let doc = if seeding {
            Document::clone(&g.doc) // seed the new location from the current document
        } else {
            if transfer_mode == TransferMode::Merge {
                target_docs.push(Document::clone(&g.doc));
            }
            merge_documents(target_docs)
        };
        crate::db::persist_document(&new_path, &doc)?;
        g.conn = None;
        g.doc = Arc::new(doc);
        g.path = new_path;
        g.own_hash = Some(content_hash(&g.doc));
        g.peers_hash = peers_content_hash(&g.path);
        self.publish(&g);

        // Sidecar / attachment transfer. Under Copy, failures are non-fatal
        // (warn-and-continue, same class as history). Under Move, any failure
        // skips old-folder cleanup so the source remains a recovery copy.
        let mut transfer_ok = true;
        if seeding {
            // History is a sidecar beside the data file; without this, seeding an
            // empty folder leaves History empty until the next edit (#118).
            if let Err(e) = crate::history::copy_own_history(&old_path, &g.path) {
                eprintln!("warning: failed to copy history on folder change: {e}");
                transfer_ok = false;
            }
            // Own attachment blobs must follow the seeded document (#133 / #135).
            if let Err(e) = crate::commands::copy_own_attachments(&old_path, &g.path) {
                eprintln!("warning: failed to copy attachments on folder change: {e}");
                transfer_ok = false;
            }
        } else {
            // Merge brings the current document along, so its history comes too —
            // as a line union, since the target may hold an older own sidecar.
            if transfer_mode == TransferMode::Merge {
                if let Err(e) = crate::history::merge_own_history(&old_path, &g.path) {
                    eprintln!("warning: failed to merge history on folder change: {e}");
                }
            }
            // Never overwrite existing blobs; fill only referenced gaps.
            if let Err(e) =
                crate::commands::fill_missing_referenced_attachments(&old_path, &g.path, &g.doc)
            {
                eprintln!("warning: failed to fill missing attachments on folder change: {e}");
            }
        }

        // Only a seed may clean up: on the existing-data path the old folder is the
        // user's way back (and, under Adopt, the only copy of the dropped document).
        if seeding && transfer_mode == TransferMode::Move && transfer_ok {
            if let Err(e) = crate::commands::remove_own_payload(&old_path, &g.path) {
                eprintln!("warning: failed to clean old folder after move: {e}");
            }
        }
        Ok(())
    }

    /// Merge an externally-synced document into the local master (Android SAF
    /// pull). Same policy as desktop `reload_replicas_if_changed`: entity-level
    /// LWW via `merge_documents([local, incoming])` — no conflict-local stash.
    /// Returns the merged document's content hash.
    pub fn adopt_synced(&self, doc: Document) -> Result<[u8; 32]> {
        if doc.version > CURRENT_VERSION {
            return Err(AppError::Invalid(format!(
                "data file version {} is newer than this app supports (max {}); update the app",
                doc.version, CURRENT_VERSION
            )));
        }
        let mut g = self.inner.lock();
        let before = g.doc.clone();
        let merged = merge_documents(vec![Document::clone(&before), doc]);
        let hash = content_hash(&merged);
        let inner = &mut *g;
        inner.doc = Arc::new(merged);
        // Same atomicity rule as `write`: a merge that cannot be persisted must not
        // stay adopted in memory, or the Android pull path reports data it never wrote.
        if let Err(e) = inner.persist() {
            g.doc = before;
            return Err(e);
        }
        // Mirror `reload_replicas_if_changed`: peer-visible changes merged from
        // the synced folder must land in History too — without this, the Android
        // SAF pull path never surfaced other devices' edits in the History view.
        // Appended only after the merge is durable, so a failed pull records nothing;
        // `filter_unseen_entries` keeps a later retry from double-recording it.
        let _history = self.history.lock();
        let ts = crate::model::now_ms();
        let history = crate::history::entries_for_change(&before, &g.doc, ts);
        match crate::history::filter_unseen_entries(&g.path, history) {
            Ok(mut filtered) => {
                crate::history::stamp_device(&mut filtered, &g.device_id, &g.device_name);
                if let Err(e) = crate::history::append_history(&g.path, &filtered) {
                    eprintln!("warning: failed to append adopt history: {e}");
                }
            }
            Err(e) => eprintln!("warning: failed to dedup adopt history: {e}"),
        }
        g.own_hash = Some(hash);
        g.peers_hash = peers_content_hash(&g.path);
        self.publish(&g);
        Ok(hash)
    }

    /// Replace the store with an externally-synced document, DISCARDING the
    /// current local document (no conflict file). Used when the user switches data
    /// source. Returns the incoming document's content hash.
    pub fn load_replacing_local(&self, doc: Document) -> Result<[u8; 32]> {
        if doc.version > CURRENT_VERSION {
            return Err(AppError::Invalid(format!(
                "data file version {} is newer than this app supports (max {}); update the app",
                doc.version, CURRENT_VERSION
            )));
        }
        let hash = content_hash(&doc);
        let mut g = self.inner.lock();
        let before = g.doc.clone();
        let inner = &mut *g;
        inner.doc = Arc::new(doc);
        // Same atomicity rule as `write`: if the incoming document cannot be persisted,
        // the old one must stay in memory rather than the app switching to a source it
        // failed to write.
        if let Err(e) = inner.persist() {
            g.doc = before;
            return Err(e);
        }
        g.own_hash = Some(hash);
        g.peers_hash = peers_content_hash(&g.path);
        self.publish(&g);
        Ok(hash)
    }
}

/// Content hash of a document: SHA-256 of its compact serialization. Stable across
/// re-serializations of identical content (the model has no maps in `Document`), so
/// it identifies content regardless of storage-byte differences.
pub(crate) fn content_hash(doc: &Document) -> [u8; 32] {
    // Serialization of the model is deterministic (fixed struct field order, Vec
    // collections). Fall back to an empty hash only if serialization somehow fails.
    match serde_json::to_vec(doc) {
        Ok(bytes) => sha256(&bytes),
        Err(_) => [0; 32],
    }
}

/// Parse a legacy JSON document and reject one written by a newer schema version.
pub(crate) fn parse_checked(bytes: &[u8]) -> Result<Document> {
    let doc: Document = serde_json::from_slice(bytes)?;
    if doc.version > CURRENT_VERSION {
        return Err(AppError::Invalid(format!(
            "data file version {} is newer than this app supports (max {}); update the app",
            doc.version, CURRENT_VERSION
        )));
    }
    Ok(doc)
}

fn doc_has_data(d: &Document) -> bool {
    !d.tasks.is_empty() || !d.tags.is_empty()
}

fn ensure_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

/// A per-device replica file this device may merge: `tasks_*.db` (current) or
/// `tasks_*.json` (a peer not yet upgraded), excluding conflict copies.
fn is_replica_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    name.starts_with("tasks_")
        && (lower.ends_with(".db") || lower.ends_with(".json"))
        && !lower.contains("conflict")
}

fn legacy_path(path: &Path) -> PathBuf {
    path.with_file_name(crate::config::legacy_data_file_name())
}

/// Decode the legacy single-file `tasks.json` (pre-per-device) if present, for
/// one-time migration into the database. Returns `None` when absent or unreadable.
fn legacy_doc(path: &Path) -> Option<Document> {
    let legacy = legacy_path(path);
    if legacy == *path || !legacy.exists() {
        return None;
    }
    fs::read(&legacy).ok().and_then(|b| parse_checked(&b).ok())
}

/// Decode a replica file by extension: `.db` read-only via SQLite, `.json` parsed.
fn decode_replica(path: &Path) -> Result<Document> {
    let is_db = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("db"))
        .unwrap_or(false);
    if is_db {
        crate::db::load_from_file(path)
    } else {
        parse_checked(&fs::read(path)?)
    }
}

/// Read our own database at `path` if it exists and holds data.
fn read_db_if_present(path: &Path) -> Result<Option<Document>> {
    if !path.exists() {
        return Ok(None);
    }
    match decode_replica(path) {
        Ok(doc) if doc_has_data(&doc) => Ok(Some(doc)),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

fn replica_paths(path: &Path) -> Vec<PathBuf> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir(parent) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_replica_name(&name) {
                paths.push(entry.path());
            }
        }
    }
    paths.sort();
    paths
}

/// Decode every peer replica (all replicas except our own `path`), skipping any
/// that can't be read/decoded (a not-yet-materialized cloud file, or a torn
/// mid-write) so one bad replica never sinks the merge.
fn collect_peer_docs(path: &Path) -> Vec<Document> {
    let mut docs = Vec::new();
    for replica in replica_paths(path) {
        if is_own_replica(&replica, path) {
            continue;
        }
        if let Ok(doc) = decode_replica(&replica) {
            docs.push(doc);
        }
    }
    docs
}

/// Combined content hash of peer replicas (excludes our own), used to detect when
/// a peer changed. Decodes each peer to its content hash so byte-level snapshot
/// churn never registers as a change.
fn peers_content_hash(path: &Path) -> [u8; 32] {
    let mut h = Sha256::new();
    for replica in replica_paths(path) {
        if is_own_replica(&replica, path) {
            continue;
        }
        let name = replica
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if let Ok(doc) = decode_replica(&replica) {
            h.update(name.as_bytes());
            h.update([0]);
            h.update(content_hash(&doc));
            h.update([0]);
        }
    }
    h.finalize().into()
}

/// True when `replica` is this device's owned file. Compare by case-insensitive
/// file name (not full `Path` equality): on Windows, `read_dir` vs a configured
/// path can differ in drive-letter case or separators, and a false mismatch used
/// to open our own DB as a "peer" while the writer connection still held it —
/// producing intermittent `database is locked` on update.
fn is_own_replica(replica: &Path, own: &Path) -> bool {
    match (replica.file_name(), own.file_name()) {
        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
        _ => replica == own,
    }
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().into()
}

/// Atomic write (temp + fsync + rename). Used for conflict copies, config, and
/// history sidecars. On Windows, replaces an existing target via a short
/// backup+rename dance because `rename` does not overwrite.
pub(crate) fn atomic_write(target: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = target.with_extension("json.tmp");
    let result: std::io::Result<()> = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        replace_file(&tmp, target)?;
        Ok(())
    })();
    match result {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(AppError::Io(e))
        }
    }
}

fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(_e) if to.exists() => {
            // Windows (and some network FS): rename refuses to overwrite.
            let bak = to.with_extension("bak");
            let _ = fs::remove_file(&bak);
            fs::rename(to, &bak)?;
            match fs::rename(from, to) {
                Ok(()) => {
                    let _ = fs::remove_file(&bak);
                    Ok(())
                }
                Err(err) => {
                    let _ = fs::rename(&bak, to);
                    Err(err)
                }
            }
        }
        Err(e) => Err(e),
    }
}
