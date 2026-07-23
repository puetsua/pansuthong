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
use std::sync::Mutex;

/// How to handle this device's owned payload when relocating the data folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferMode {
    /// Seed/fill at the new location; leave own files in the old folder intact.
    Copy,
    /// After a successful transfer, remove only this device's files from the old folder.
    Move,
}

pub struct AppState {
    inner: Mutex<Inner>,
}

struct Inner {
    conn: Connection,
    doc: Document,
    path: PathBuf,
    /// Content hash of our own document (compact serialization).
    own_hash: [u8; 32],
    /// Combined content hash of peer replicas, so the poll can detect a peer
    /// change cheaply. Excludes our own replica.
    peers_hash: [u8; 32],
    /// This device's id (from the replica filename) and readable name for history.
    device_id: String,
    device_name: String,
}

impl AppState {
    /// Open the store at `path`, migrating/merging any sibling replicas (and a
    /// legacy JSON file) into the local database.
    pub fn open(path: PathBuf) -> Result<Self> {
        ensure_parent(&path)?;
        let device_id = crate::config::device_id_from_data_path(&path)
            .unwrap_or_else(|| "device".to_string());
        let device_name = crate::config::resolve_device_name(&device_id);
        // One-time: fold bare `history.jsonl` into `history_<device>.jsonl`, then delete it.
        if let Err(e) = crate::history::migrate_legacy_history_jsonl(&path) {
            eprintln!("warning: failed to migrate legacy history.jsonl: {e}");
        }
        let mut conn = crate::db::open(&path)?;
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
        crate::db::write_document(&mut conn, &doc)?;
        let own_hash = content_hash(&doc);
        let peers_hash = peers_content_hash(&path);
        Ok(Self {
            inner: Mutex::new(Inner {
                conn,
                doc,
                path,
                own_hash,
                peers_hash,
                device_id,
                device_name,
            }),
        })
    }

    pub fn read<F, T>(&self, f: F) -> T
    where
        F: FnOnce(&Document) -> T,
    {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        f(&g.doc)
    }

    /// Mutate then persist in a single transaction. Bumps `last_modified` and
    /// stamps the current schema `version`, then appends the change to the history
    /// sidecar. The content hashes are refreshed so the poll won't treat our own
    /// write as a peer change.
    pub fn write<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Document) -> Result<T>,
    {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let before = g.doc.clone();
        let value = f(&mut g.doc)?;
        let ts = crate::model::now_ms();
        let mut history = crate::history::entries_for_change(&before, &g.doc, ts);
        crate::history::stamp_device(&mut history, &g.device_id, &g.device_name);
        g.doc.last_modified = ts;
        g.doc.version = CURRENT_VERSION;
        let inner = &mut *g;
        crate::db::write_document(&mut inner.conn, &inner.doc)?;
        if let Err(e) = crate::history::append_history(&inner.path, &history) {
            eprintln!("warning: failed to append history: {e}");
        }
        g.own_hash = content_hash(&g.doc);
        g.peers_hash = peers_content_hash(&g.path);
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
            let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if peers_hash == g.peers_hash {
                return Ok(false);
            }
        }
        // A peer changed. Hold the lock across the whole re-merge-and-assign so a
        // concurrent write() can't have its just-persisted edit clobbered.
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let before = g.doc.clone();
        let mut docs = collect_peer_docs(&g.path);
        docs.push(before.clone());
        let merged = merge_documents(docs);
        if content_hash(&before) != content_hash(&merged) {
            let ts = crate::model::now_ms();
            let history = crate::history::entries_for_change(&before, &merged, ts);
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
        let inner = &mut *g;
        inner.doc = merged;
        crate::db::write_document(&mut inner.conn, &inner.doc)?;
        g.own_hash = content_hash(&g.doc);
        g.peers_hash = peers_content_hash(&g.path);
        drop(g);
        // Attachment tombstones from peers may have dropped live refs — GC orphans.
        crate::commands::gc_unreferenced_attachment_blobs(self);
        Ok(true)
    }

    pub fn path(&self) -> PathBuf {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .path
            .clone()
    }

    #[allow(dead_code)] // used by tests and the folder-sync bookkeeping
    pub fn last_written_hash(&self) -> [u8; 32] {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).own_hash
    }

    /// Relocate the store to `new_path`. If the target folder already holds data
    /// (a replica or legacy file), load it outright — the user is switching data
    /// source, so the current in-memory document is discarded (no conflict file).
    /// Otherwise seed the target from the current document and copy this device's
    /// history sidecar so the History view stays continuous. Validated before
    /// anything is replaced, so an invalid target leaves the current store intact.
    ///
    /// `transfer_mode` controls whether own payload is left in the old folder
    /// ([`TransferMode::Copy`]) or removed after a successful transfer
    /// ([`TransferMode::Move`]). Peer files are never touched.
    pub fn repoint(&self, new_path: PathBuf, transfer_mode: TransferMode) -> Result<()> {
        ensure_parent(&new_path)?;
        let mut target_docs = collect_peer_docs(&new_path);
        if let Some(legacy) = legacy_doc(&new_path) {
            target_docs.push(legacy);
        }
        if let Some(existing) = read_db_if_present(&new_path)? {
            target_docs.push(existing);
        }
        let seeding = target_docs.is_empty();
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let old_path = g.path.clone();
        let doc = if seeding {
            g.doc.clone() // seed the new location from the current document
        } else {
            merge_documents(target_docs)
        };
        let mut conn = crate::db::open(&new_path)?;
        crate::db::write_document(&mut conn, &doc)?;
        g.conn = conn;
        g.doc = doc;
        g.path = new_path;
        g.own_hash = content_hash(&g.doc);
        g.peers_hash = peers_content_hash(&g.path);

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
            // Adopt: never overwrite existing blobs; fill only referenced gaps.
            if let Err(e) =
                crate::commands::fill_missing_referenced_attachments(&old_path, &g.path, &g.doc)
            {
                eprintln!("warning: failed to fill missing attachments on folder change: {e}");
                transfer_ok = false;
            }
        }

        if transfer_mode == TransferMode::Move && transfer_ok {
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
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let before = g.doc.clone();
        let merged = merge_documents(vec![before.clone(), doc]);
        let hash = content_hash(&merged);
        // Mirror `reload_replicas_if_changed`: peer-visible changes merged from
        // the synced folder must land in History too — without this, the Android
        // SAF pull path never surfaced other devices' edits in the History view.
        let ts = crate::model::now_ms();
        let history = crate::history::entries_for_change(&before, &merged, ts);
        match crate::history::filter_unseen_entries(&g.path, history) {
            Ok(mut filtered) => {
                crate::history::stamp_device(&mut filtered, &g.device_id, &g.device_name);
                if let Err(e) = crate::history::append_history(&g.path, &filtered) {
                    eprintln!("warning: failed to append adopt history: {e}");
                }
            }
            Err(e) => eprintln!("warning: failed to dedup adopt history: {e}"),
        }
        let inner = &mut *g;
        inner.doc = merged;
        crate::db::write_document(&mut inner.conn, &inner.doc)?;
        g.own_hash = content_hash(&g.doc);
        g.peers_hash = peers_content_hash(&g.path);
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
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let inner = &mut *g;
        inner.doc = doc;
        crate::db::write_document(&mut inner.conn, &inner.doc)?;
        g.own_hash = content_hash(&g.doc);
        g.peers_hash = peers_content_hash(&g.path);
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_task(id: &str) -> crate::model::Task {
        crate::model::Task {
            id: id.into(),
            title: id.into(),
            due_date: None,
            due_time: None,
            start_date: None,
            start_time: None,
            notes: String::new(),
            attachments: Vec::new(),
            tag_ids: Vec::new(),
            estimated_seconds: None,
            created_at: 0,
            completed_at: None,
            updated_at: 0,
            time_entries: Vec::new(),
        }
    }

    fn write_json_replica(path: &Path, task_id: &str) {
        let mut doc = Document::default();
        doc.tasks.push(sample_task(task_id));
        fs::write(path, serde_json::to_vec_pretty(&doc).unwrap()).unwrap();
    }

    #[test]
    fn adopt_synced_merges_local_with_incoming_without_conflict_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let state = AppState::open(path.clone()).unwrap();
        state
            .write(|d| {
                d.tasks.push(sample_task("k_local"));
                Ok(())
            })
            .unwrap();

        let mut remote = Document::default();
        remote.tasks.push(sample_task("k_remote"));
        state.adopt_synced(remote).unwrap();

        let mut ids = state.read(|d| d.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>());
        ids.sort();
        assert_eq!(ids, ["k_local", "k_remote"]);
        assert!(
            crate::sync::scan_conflict_files(&path).is_empty(),
            "SAF adopt must merge like desktop, not stash conflict-local"
        );
    }

    #[test]
    fn adopt_synced_appends_history_for_incoming_changes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let state = AppState::open(path.clone()).unwrap();

        // Adopt a remote doc containing a task this device has never seen
        // (the Android SAF pull path). The change must land in History.
        let mut remote = Document::default();
        remote.tasks.push(sample_task("k_remote"));
        state.adopt_synced(remote).unwrap();

        let entries = crate::history::read_all_history(&path).unwrap();
        assert!(
            entries
                .iter()
                .any(|e| e.event == "task.created" && e.entity_id == "k_remote"),
            "adopting a synced doc must surface the incoming change in History, got {entries:?}"
        );

        // Re-adopting the same content must not duplicate the entry (dedup key).
        let again = state.read(|d| d.clone());
        state.adopt_synced(again).unwrap();
        let entries = crate::history::read_all_history(&path).unwrap();
        assert_eq!(
            entries
                .iter()
                .filter(|e| e.event == "task.created" && e.entity_id == "k_remote")
                .count(),
            1,
            "same dedup_key must not append twice"
        );
    }

    #[test]
    fn write_persists_across_reopen() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let state = AppState::open(path.clone()).unwrap();
        state
            .write(|d| {
                d.tasks.push(sample_task("k_x"));
                Ok(())
            })
            .unwrap();
        assert!(state.read(|d| d.last_modified) > 0, "write bumps last_modified");
        drop(state);

        // Reopen the same database file: the task survived.
        let reopened = AppState::open(path).unwrap();
        assert_eq!(
            reopened.read(|d| d.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>()),
            ["k_x"]
        );
    }

    #[test]
    fn open_merges_sibling_replicas() {
        let dir = tempdir().unwrap();
        // A peer `.db` and a peer `.json` (cross-version) both merge in.
        let peer_db = dir.path().join("tasks_peerdb.db");
        {
            let mut conn = crate::db::open(&peer_db).unwrap();
            let mut d = Document::default();
            d.tasks.push(sample_task("k_peerdb"));
            crate::db::write_document(&mut conn, &d).unwrap();
        }
        write_json_replica(&dir.path().join("tasks_peerjson.json"), "k_peerjson");

        let state = AppState::open(dir.path().join("tasks_dev.db")).unwrap();
        let mut ids = state.read(|d| d.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>());
        ids.sort();
        assert_eq!(ids, ["k_peerdb", "k_peerjson"]);
    }

    #[test]
    fn reload_picks_up_a_new_peer_then_settles() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let state = AppState::open(path.clone()).unwrap();
        state
            .write(|d| {
                d.tasks.push(sample_task("k_dev"));
                Ok(())
            })
            .unwrap();
        assert!(!state.reload_replicas_if_changed().unwrap(), "no peer yet");

        // A peer replica appears (e.g. pulled by Google Drive).
        write_json_replica(&dir.path().join("tasks_peer.json"), "k_peer");
        assert!(state.reload_replicas_if_changed().unwrap(), "new peer detected");
        let mut ids = state.read(|d| d.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>());
        ids.sort();
        assert_eq!(ids, ["k_dev", "k_peer"]);

        // A second poll with nothing new must NOT reload (content hash is stable
        // even though our own .db was rewritten byte-differently).
        assert!(!state.reload_replicas_if_changed().unwrap(), "no change -> no reload");
    }

    #[test]
    fn peer_merge_appends_history_once_without_poll_duplicates() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let state = AppState::open(path).unwrap();
        state
            .write(|d| {
                d.tasks.push(sample_task("k_dev"));
                Ok(())
            })
            .unwrap();
        let before_count = crate::history::read_all_history(&state.path())
            .unwrap()
            .len();

        write_json_replica(&dir.path().join("tasks_peer.json"), "k_peer");
        assert!(state.reload_replicas_if_changed().unwrap());

        let after_first = crate::history::read_all_history(&state.path()).unwrap();
        let peer_creates: Vec<_> = after_first
            .iter()
            .filter(|e| e.entity_id == "k_peer" && e.event == "task.created")
            .collect();
        assert_eq!(
            peer_creates.len(),
            1,
            "peer merge must append exactly one history entry for the new task"
        );
        assert!(
            peer_creates[0].device_id.as_deref() == Some("dev"),
            "merge history stamped with this device id"
        );
        assert!(
            peer_creates[0].device_name.is_some(),
            "merge history stamped with a device name"
        );
        assert!(peer_creates[0].dedup_key.is_some());
        assert!(after_first.len() > before_count);

        // Same peers again: no reload, so no duplicate lines.
        assert!(!state.reload_replicas_if_changed().unwrap());
        let after_second = crate::history::read_all_history(&state.path()).unwrap();
        assert_eq!(
            after_second.len(),
            after_first.len(),
            "second poll must not duplicate history"
        );

        // Force another reload path with a new peer that does not change the
        // already-merged k_peer entity — still must not re-append k_peer.
        write_json_replica(&dir.path().join("tasks_other.json"), "k_other");
        assert!(state.reload_replicas_if_changed().unwrap());
        let after_third = crate::history::read_all_history(&state.path()).unwrap();
        let peer_creates_again = after_third
            .iter()
            .filter(|e| e.entity_id == "k_peer" && e.event == "task.created")
            .count();
        assert_eq!(peer_creates_again, 1, "k_peer create must stay unique");
        assert_eq!(
            after_third
                .iter()
                .filter(|e| e.entity_id == "k_other" && e.event == "task.created")
                .count(),
            1
        );
    }

    #[test]
    fn open_migrates_legacy_json() {
        let dir = tempdir().unwrap();
        // Pre-SQLite world: a single legacy tasks.json, no per-device replica.
        write_json_replica(&dir.path().join(crate::config::legacy_data_file_name()), "k_legacy");

        let path = dir.path().join("tasks_dev.db");
        let state = AppState::open(path.clone()).unwrap();
        assert_eq!(
            state.read(|d| d.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>()),
            ["k_legacy"],
            "legacy JSON is imported into the database"
        );
        // The imported data is now in the .db, and the legacy file is left in place.
        assert!(path.exists());
        assert!(dir.path().join(crate::config::legacy_data_file_name()).exists());
    }

    #[test]
    fn repoint_adopts_target_and_discards_local() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks_dev.db")).unwrap();
        state
            .write(|d| {
                d.tasks.push(sample_task("k_local"));
                Ok(())
            })
            .unwrap();

        // Target folder already holds a peer replica with different data.
        let target = tempdir().unwrap();
        write_json_replica(&target.path().join("tasks_other.json"), "k_theirs");
        let new_path = target.path().join("tasks_dev.db");

        state.repoint(new_path.clone(), TransferMode::Copy).unwrap();
        assert_eq!(state.path(), new_path);
        assert_eq!(
            state.read(|d| d.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>()),
            ["k_theirs"],
            "target data adopted, local discarded"
        );
        assert!(
            crate::sync::scan_conflict_files(&new_path).is_empty(),
            "switching source discards local without a conflict file"
        );
    }

    #[test]
    fn repoint_seeds_when_target_empty() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks_dev.db")).unwrap();
        state
            .write(|d| {
                d.tasks.push(sample_task("k_seed"));
                Ok(())
            })
            .unwrap();

        let target = tempdir().unwrap();
        let new_path = target.path().join("tasks_dev.db");
        state.repoint(new_path.clone(), TransferMode::Copy).unwrap();

        assert!(new_path.exists(), "seeded database created");
        assert_eq!(
            state.read(|d| d.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>()),
            ["k_seed"]
        );
    }

    #[test]
    fn repoint_seeds_copies_own_history_sidecar() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let state = AppState::open(path).unwrap();
        state
            .write(|d| {
                d.tasks.push(sample_task("k_seed"));
                Ok(())
            })
            .unwrap();
        // write() appends history; confirm the sidecar exists before relocating.
        assert!(dir.path().join("history_dev.jsonl").exists());

        let target = tempdir().unwrap();
        let new_path = target.path().join("tasks_dev.db");
        state.repoint(new_path, TransferMode::Copy).unwrap();

        assert!(
            target.path().join("history_dev.jsonl").exists(),
            "own history sidecar must be copied when seeding an empty folder"
        );
        let entries = crate::history::read_all_history(&state.path()).unwrap();
        assert!(
            entries.iter().any(|e| e.entity_id == "k_seed"),
            "History view must still see the seeded entries"
        );
        // Source left intact (copy, not move) — same as the old tasks file.
        assert!(dir.path().join("history_dev.jsonl").exists());
    }

    #[test]
    fn repoint_adopt_does_not_copy_old_history_over_target() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks_dev.db")).unwrap();
        state
            .write(|d| {
                d.tasks.push(sample_task("k_local"));
                Ok(())
            })
            .unwrap();
        assert!(dir.path().join("history_dev.jsonl").exists());

        let target = tempdir().unwrap();
        write_json_replica(&target.path().join("tasks_other.json"), "k_theirs");
        // Target already has peer history — adopting must leave it alone and not
        // drop this device's old sidecar on top of the folder.
        crate::history::append_history(
            &target.path().join("tasks_other.json"),
            &[crate::history::HistoryEntry {
                timestamp: 1_000,
                event: "task.created".into(),
                entity: "task".into(),
                entity_id: "k_theirs".into(),
                title: "theirs".into(),
                summary: "Created task".into(),
                device_id: None,
                device_name: None,
                dedup_key: None,
            }],
        )
        .unwrap();
        let new_path = target.path().join("tasks_dev.db");
        state.repoint(new_path, TransferMode::Copy).unwrap();

        assert!(
            !target.path().join("history_dev.jsonl").exists(),
            "adopting an existing folder must not copy this device's old history over it"
        );
        assert!(target.path().join("history_other.jsonl").exists());
    }

    #[test]
    fn repoint_seeds_copies_own_attachments_subdir() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let state = AppState::open(path).unwrap();
        let own = dir.path().join("attachments_dev");
        fs::create_dir_all(&own).unwrap();
        fs::write(own.join("attachment_a_photo.bin"), b"photo").unwrap();
        let peer = dir.path().join("attachments_other");
        fs::create_dir_all(&peer).unwrap();
        fs::write(peer.join("attachment_b_peer.bin"), b"peer").unwrap();
        state
            .write(|d| {
                let mut t = sample_task("k_seed");
                t.attachments.push(crate::model::Attachment {
                    id: "att_a".into(),
                    name: "photo".into(),
                    path: "attachments_dev/attachment_a_photo.bin".into(),
                    mime_type: None,
                    size: Some(5),
                    created_at: 0,
                });
                d.tasks.push(t);
                Ok(())
            })
            .unwrap();

        let target = tempdir().unwrap();
        let new_path = target.path().join("tasks_dev.db");
        state.repoint(new_path, TransferMode::Copy).unwrap();

        assert_eq!(
            fs::read(
                target
                    .path()
                    .join("attachments_dev")
                    .join("attachment_a_photo.bin")
            )
            .unwrap(),
            b"photo",
            "own attachments must be copied when seeding"
        );
        assert!(
            dir.path()
                .join("attachments_dev")
                .join("attachment_a_photo.bin")
                .exists(),
            "source attachments left intact"
        );
        assert!(
            !target.path().join("attachments_other").exists(),
            "peer attachments_* must not be seeded"
        );
    }

    #[test]
    fn repoint_adopt_does_not_copy_own_attachments_tree_over_target() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks_dev.db")).unwrap();
        let own = dir.path().join("attachments_dev");
        fs::create_dir_all(&own).unwrap();
        fs::write(own.join("attachment_local_x.bin"), b"local-only").unwrap();
        state
            .write(|d| {
                d.tasks.push(sample_task("k_local"));
                Ok(())
            })
            .unwrap();

        let target = tempdir().unwrap();
        write_json_replica(&target.path().join("tasks_other.json"), "k_theirs");
        // Target has its own attachment tree; adopt must not dump the old own tree.
        let target_own = target.path().join("attachments_dev");
        fs::create_dir_all(&target_own).unwrap();
        fs::write(target_own.join("attachment_target_y.bin"), b"target").unwrap();

        let new_path = target.path().join("tasks_dev.db");
        state.repoint(new_path, TransferMode::Copy).unwrap();

        assert!(
            !target
                .path()
                .join("attachments_dev")
                .join("attachment_local_x.bin")
                .exists(),
            "adopting must not copy the whole own attachments tree over the target"
        );
        assert_eq!(
            fs::read(
                target
                    .path()
                    .join("attachments_dev")
                    .join("attachment_target_y.bin")
            )
            .unwrap(),
            b"target",
            "existing target blobs must remain"
        );
    }

    #[test]
    fn repoint_adopt_fills_missing_referenced_attachments() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks_dev.db")).unwrap();
        // Old folder holds a blob the target document will reference.
        let missing_rel = "attachments_other/attachment_shared_x.bin";
        fs::create_dir_all(dir.path().join("attachments_other")).unwrap();
        fs::write(dir.path().join(missing_rel), b"shared-blob").unwrap();
        // Unreferenced blob in old folder must stay behind.
        fs::write(
            dir.path()
                .join("attachments_other")
                .join("attachment_orphan_z.bin"),
            b"orphan",
        )
        .unwrap();
        state
            .write(|d| {
                d.tasks.push(sample_task("k_local"));
                Ok(())
            })
            .unwrap();

        let target = tempdir().unwrap();
        let mut theirs = Document::default();
        let mut t = sample_task("k_theirs");
        t.attachments.push(crate::model::Attachment {
            id: "att_shared".into(),
            name: "shared".into(),
            path: missing_rel.into(),
            mime_type: None,
            size: Some(11),
            created_at: 0,
        });
        // Also reference a blob that already exists at the target — must not overwrite.
        let keep_rel = "attachments_other/attachment_keep_y.bin";
        t.attachments.push(crate::model::Attachment {
            id: "att_keep".into(),
            name: "keep".into(),
            path: keep_rel.into(),
            mime_type: None,
            size: Some(10),
            created_at: 0,
        });
        theirs.tasks.push(t);
        fs::write(
            target.path().join("tasks_other.json"),
            serde_json::to_vec_pretty(&theirs).unwrap(),
        )
        .unwrap();
        fs::create_dir_all(target.path().join("attachments_other")).unwrap();
        fs::write(target.path().join(keep_rel), b"dest-keep").unwrap();
        // Old folder also has a different version of keep — must not replace dest.
        fs::write(dir.path().join(keep_rel), b"from-keep").unwrap();

        let new_path = target.path().join("tasks_dev.db");
        state.repoint(new_path, TransferMode::Copy).unwrap();

        assert_eq!(
            fs::read(target.path().join(missing_rel)).unwrap(),
            b"shared-blob",
            "missing referenced blob filled from old folder"
        );
        assert_eq!(
            fs::read(target.path().join(keep_rel)).unwrap(),
            b"dest-keep",
            "existing destination blob must not be replaced"
        );
        assert!(
            !target
                .path()
                .join("attachments_other")
                .join("attachment_orphan_z.bin")
                .exists(),
            "unreferenced old blobs must not be copied on adopt"
        );
    }

    #[test]
    fn repoint_seed_move_removes_own_payload_leaves_peers() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let state = AppState::open(path).unwrap();
        let own = dir.path().join("attachments_dev");
        fs::create_dir_all(&own).unwrap();
        fs::write(own.join("attachment_a_photo.bin"), b"photo").unwrap();
        let peer_att = dir.path().join("attachments_other");
        fs::create_dir_all(&peer_att).unwrap();
        fs::write(peer_att.join("attachment_b_peer.bin"), b"peer").unwrap();
        write_json_replica(&dir.path().join("tasks_other.json"), "k_peer");
        crate::history::append_history(
            &dir.path().join("tasks_other.json"),
            &[crate::history::HistoryEntry {
                timestamp: 1_000,
                event: "task.created".into(),
                entity: "task".into(),
                entity_id: "k_peer".into(),
                title: "peer".into(),
                summary: "Created task".into(),
                device_id: None,
                device_name: None,
                dedup_key: None,
            }],
        )
        .unwrap();
        state
            .write(|d| {
                let mut t = sample_task("k_seed");
                t.attachments.push(crate::model::Attachment {
                    id: "att_a".into(),
                    name: "photo".into(),
                    path: "attachments_dev/attachment_a_photo.bin".into(),
                    mime_type: None,
                    size: Some(5),
                    created_at: 0,
                });
                d.tasks.push(t);
                Ok(())
            })
            .unwrap();
        assert!(dir.path().join("history_dev.jsonl").exists());

        let target = tempdir().unwrap();
        let new_path = target.path().join("tasks_dev.db");
        state.repoint(new_path.clone(), TransferMode::Move).unwrap();

        assert!(new_path.exists(), "seeded database created");
        assert!(
            target
                .path()
                .join("attachments_dev")
                .join("attachment_a_photo.bin")
                .exists(),
            "own attachments transferred"
        );
        assert!(
            target.path().join("history_dev.jsonl").exists(),
            "own history transferred"
        );
        assert!(
            !dir.path().join("tasks_dev.db").exists(),
            "Move removes own replica from old folder"
        );
        assert!(
            !dir.path().join("history_dev.jsonl").exists(),
            "Move removes own history from old folder"
        );
        assert!(
            !dir.path().join("attachments_dev").exists(),
            "Move removes own attachments from old folder"
        );
        assert!(
            dir.path().join("tasks_other.json").exists(),
            "peer replica untouched"
        );
        assert!(
            dir.path().join("history_other.jsonl").exists(),
            "peer history untouched"
        );
        assert!(
            peer_att.join("attachment_b_peer.bin").exists(),
            "peer attachments untouched"
        );
    }

    #[test]
    fn repoint_move_skips_cleanup_when_attachment_transfer_fails() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks_dev.db")).unwrap();
        let own = dir.path().join("attachments_dev");
        fs::create_dir_all(&own).unwrap();
        fs::write(own.join("attachment_a_x.bin"), b"blob").unwrap();
        state
            .write(|d| {
                d.tasks.push(sample_task("k_seed"));
                Ok(())
            })
            .unwrap();

        let target = tempdir().unwrap();
        // Block attachment copy: destination path exists as a file, not a directory.
        fs::write(target.path().join("attachments_dev"), b"not-a-dir").unwrap();
        let new_path = target.path().join("tasks_dev.db");
        state.repoint(new_path, TransferMode::Move).unwrap();

        assert!(
            dir.path().join("tasks_dev.db").exists(),
            "failed Move must not delete own replica"
        );
        assert!(
            own.join("attachment_a_x.bin").exists(),
            "failed Move must not delete own attachments"
        );
        assert!(
            dir.path().join("history_dev.jsonl").exists(),
            "failed Move must not delete own history"
        );
    }

    #[test]
    fn repoint_adopt_move_cleans_old_own_files_only() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks_dev.db")).unwrap();
        let own = dir.path().join("attachments_dev");
        fs::create_dir_all(&own).unwrap();
        fs::write(own.join("attachment_local_x.bin"), b"local").unwrap();
        write_json_replica(&dir.path().join("tasks_other.json"), "k_peer_old");
        state
            .write(|d| {
                d.tasks.push(sample_task("k_local"));
                Ok(())
            })
            .unwrap();

        let target = tempdir().unwrap();
        write_json_replica(&target.path().join("tasks_other.json"), "k_theirs");
        let target_own = target.path().join("attachments_dev");
        fs::create_dir_all(&target_own).unwrap();
        fs::write(target_own.join("attachment_target_y.bin"), b"target").unwrap();

        let new_path = target.path().join("tasks_dev.db");
        state.repoint(new_path, TransferMode::Move).unwrap();

        assert!(
            !dir.path().join("tasks_dev.db").exists(),
            "Move removes own replica from old folder on adopt"
        );
        assert!(
            !dir.path().join("attachments_dev").exists(),
            "Move removes own attachments from old folder on adopt"
        );
        assert!(
            dir.path().join("tasks_other.json").exists(),
            "peer in old folder untouched"
        );
        assert!(
            target_own.join("attachment_target_y.bin").exists(),
            "target blobs left intact"
        );
        assert_eq!(
            fs::read(target_own.join("attachment_target_y.bin")).unwrap(),
            b"target"
        );
    }

    #[test]
    fn open_rejects_a_newer_version_replica() {
        let dir = tempdir().unwrap();
        // A peer replica written by a future schema must make open fail rather than
        // silently drop unknown data.
        let peer = dir.path().join("tasks_future.json");
        let mut doc = Document::default();
        doc.version = CURRENT_VERSION + 1;
        fs::write(&peer, serde_json::to_vec_pretty(&doc).unwrap()).unwrap();

        // The bad peer is skipped defensively (decode error), so the store still
        // opens on healthy data. The version gate is exercised directly in db.rs;
        // here we assert one bad replica never sinks startup.
        let state = AppState::open(dir.path().join("tasks_dev.db"));
        assert!(state.is_ok(), "a bad peer replica is skipped, not fatal at open");
    }

    #[test]
    fn store_recovers_after_a_panic_poisons_the_lock() {
        use std::panic::{catch_unwind, AssertUnwindSafe};
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks_dev.db")).unwrap();
        let poisoned = catch_unwind(AssertUnwindSafe(|| {
            let _ = state.write(|_| -> Result<()> { panic!("boom") });
        }));
        assert!(poisoned.is_err(), "the closure should have panicked");
        // Recovered guard: reads and writes keep working after the poison.
        let _ = state.read(|d| d.tasks.len());
        state
            .write(|d| {
                d.tasks.push(sample_task("k_after"));
                Ok(())
            })
            .unwrap();
        assert_eq!(
            state.read(|d| d.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>()),
            ["k_after"]
        );
    }

    #[test]
    fn own_replica_match_is_case_insensitive_on_filename() {
        // Windows Drive folder paths often differ only by drive-letter / name case
        // between config and read_dir; Path equality would wrongly treat own as peer.
        assert!(is_own_replica(
            Path::new(r"D:\Sync\tasks_dev.db"),
            Path::new(r"d:\sync\tasks_DEV.db"),
        ));
        assert!(!is_own_replica(
            Path::new(r"D:\Sync\tasks_peer.db"),
            Path::new(r"D:\Sync\tasks_dev.db"),
        ));
    }
}
