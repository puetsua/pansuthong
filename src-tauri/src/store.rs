use crate::error::{AppError, Result};
use crate::model::{merge_documents, Document, CURRENT_VERSION};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct AppState {
    inner: Mutex<Inner>,
}

struct Inner {
    doc: Document,
    path: PathBuf,
    last_written_hash: [u8; 32],
    last_seen_replicas_hash: [u8; 32],
}

impl AppState {
    /// Load `Document` from `path` (or write a default if absent).
    pub fn open(path: PathBuf) -> Result<Self> {
        ensure_parent(&path)?;
        seed_from_legacy_if_needed(&path)?;
        let doc = match read_merged_document(&path)? {
            Some(doc) => doc,
            None if path.exists() => parse_checked(&fs::read(&path)?)?,
            None => Document::default(),
        };
        let bytes = if path.exists() {
            fs::read(&path)?
        } else {
            let bytes = serde_json::to_vec_pretty(&doc)?;
            atomic_write(&path, &bytes)?;
            bytes
        };
        let hash = sha256(&bytes);
        let replicas_hash = replicas_hash(&path)?;
        Ok(Self {
            inner: Mutex::new(Inner {
                doc,
                path,
                last_written_hash: hash,
                last_seen_replicas_hash: replicas_hash,
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

    /// Mutate then persist. Returns the result of `f` after the file is on disk.
    /// Bumps `last_modified` so every edit stamps the document with its edit time,
    /// and stamps the current schema `version` so any save upgrades an
    /// older-format file (the new shape drops the legacy `done`/`archived` keys, so
    /// an older app build then correctly refuses the file via `parse_checked`).
    pub fn write<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Document) -> Result<T>,
    {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let before = g.doc.clone();
        let value = f(&mut g.doc)?;
        let ts = crate::model::now_ms();
        let history = crate::history::entries_for_change(&before, &g.doc, ts);
        g.doc.last_modified = ts;
        g.doc.version = CURRENT_VERSION;
        let bytes = serde_json::to_vec_pretty(&g.doc)?;
        atomic_write(&g.path, &bytes)?;
        if let Err(e) = crate::history::append_history(&g.path, &history) {
            eprintln!("warning: failed to append history: {e}");
        }
        g.last_written_hash = sha256(&bytes);
        g.last_seen_replicas_hash = replicas_hash(&g.path)?;
        Ok(value)
    }

    /// Replace the in-memory document with a freshly parsed one and update the
    /// hash to match what's now on disk. Called by sync.rs after detecting an
    /// external write.
    pub fn reload_from_bytes(&self, bytes: Vec<u8>) -> Result<()> {
        let doc = parse_checked(&bytes)?;
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.doc = doc;
        g.last_written_hash = sha256(&bytes);
        g.last_seen_replicas_hash = replicas_hash(&g.path)?;
        Ok(())
    }

    pub fn reload_replicas_if_changed(&self) -> Result<bool> {
        let path = self.path();
        let hash = replicas_hash(&path)?;
        {
            let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if hash == g.last_seen_replicas_hash {
                return Ok(false);
            }
        }
        let doc = match read_merged_document(&path)? {
            Some(doc) => doc,
            None if path.exists() => parse_checked(&fs::read(&path)?)?,
            None => Document::default(),
        };
        let own_hash = fs::read(&path)
            .map(|bytes| sha256(&bytes))
            .unwrap_or([0; 32]);
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.doc = doc;
        g.last_written_hash = own_hash;
        g.last_seen_replicas_hash = hash;
        Ok(true)
    }

    pub fn path(&self) -> PathBuf {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .path
            .clone()
    }

    #[allow(dead_code)] // used by Phase 2 sync
    pub fn last_written_hash(&self) -> [u8; 32] {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .last_written_hash
    }

    /// Relocate the master data file to `new_path`. If `new_path` already exists,
    /// load its contents outright — the user is switching data source, so the
    /// current in-memory document is discarded (no conflict file). If `new_path`
    /// is absent, seed it from the current document instead (nothing to load).
    /// The target is validated before anything is replaced, so an invalid file
    /// leaves the master intact. Updates the stored path and loop-suppression hash.
    pub fn repoint(&self, new_path: std::path::PathBuf) -> Result<()> {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        ensure_parent(&new_path)?;
        seed_from_legacy_if_needed(&new_path)?;
        if new_path.exists() || has_replicas(&new_path) {
            let target_doc = match read_merged_document(&new_path)? {
                Some(doc) => doc,
                None if new_path.exists() => parse_checked(&fs::read(&new_path)?)?,
                None => Document::default(),
            };
            // Changing the data source discards the current in-memory document and
            // loads the target folder's data outright (validated above, so an
            // invalid target leaves the master intact). The local doc is not
            // preserved as a conflict file — the user is deliberately switching
            // sources.
            g.doc = target_doc;
            let bytes = if new_path.exists() {
                std::fs::read(&new_path)?
            } else {
                let bytes = serde_json::to_vec_pretty(&g.doc)?;
                atomic_write(&new_path, &bytes)?;
                bytes
            };
            g.last_written_hash = sha256(&bytes);
            g.last_seen_replicas_hash = replicas_hash(&new_path)?;
            g.path = new_path;
        } else {
            let bytes = serde_json::to_vec_pretty(&g.doc)?;
            atomic_write(&new_path, &bytes)?;
            g.last_written_hash = sha256(&bytes);
            g.last_seen_replicas_hash = replicas_hash(&new_path)?;
            g.path = new_path;
        }
        Ok(())
    }

    /// Adopt externally-synced `bytes` as the master document. The bytes are
    /// persisted **verbatim** (so the on-disk file, the in-memory doc, and the
    /// returned hash all agree) and `last_modified` is NOT bumped — unlike
    /// `write`, whose re-stamp would change the bytes and defeat the folder-sync
    /// hash de-duplication (causing a cross-device re-push echo).
    ///
    /// Before overwriting, the current local document is preserved as a conflict
    /// file when it (a) holds data, (b) has un-synced changes — i.e. its hash
    /// differs from `last_synced_hash` — and (c) differs from the incoming bytes.
    /// This mirrors `repoint`'s #34 protection so folder-sync adoption never
    /// silently drops local edits, while a device that is merely behind (local ==
    /// last synced) adopts cleanly with no spurious conflict file. The document is
    /// validated before anything is touched, so torn/garbage or newer-version
    /// bytes leave the master intact. Returns the adopted bytes' hash.
    pub fn adopt_synced(
        &self,
        bytes: &[u8],
        last_synced_hash: Option<[u8; 32]>,
    ) -> Result<[u8; 32]> {
        let doc = parse_checked(bytes)?; // validate before mutating the master
        let hash = sha256(bytes);
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if doc_has_data(&g.doc) {
            let local_bytes = serde_json::to_vec_pretty(&g.doc)?;
            let local_diverged = Some(sha256(&local_bytes)) != last_synced_hash;
            if local_diverged && local_bytes != bytes {
                write_local_conflict(&g.path, &local_bytes)?;
            }
        }
        atomic_write(&g.path, bytes)?;
        g.doc = doc;
        g.last_written_hash = hash;
        g.last_seen_replicas_hash = replicas_hash(&g.path)?;
        Ok(hash)
    }

    /// Replace the master with externally-synced `bytes`, DISCARDING the current
    /// local document without preserving it as a conflict file. Used when the user
    /// switches data source (picks a new sync folder) and wants that folder's data
    /// loaded outright. Like `adopt_synced` but without the #34 conflict guard:
    /// validates before touching anything (so invalid/newer bytes leave the master
    /// intact) and writes the bytes verbatim so file, in-memory doc, and returned
    /// hash all agree. Returns the adopted bytes' hash.
    pub fn load_replacing_local(&self, bytes: &[u8]) -> Result<[u8; 32]> {
        let doc = parse_checked(bytes)?; // validate before mutating the master
        let hash = sha256(bytes);
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        atomic_write(&g.path, bytes)?;
        g.doc = doc;
        g.last_written_hash = hash;
        g.last_seen_replicas_hash = replicas_hash(&g.path)?;
        Ok(hash)
    }
}

/// Parse a document and reject one written by a newer schema version, so an
/// older binary never silently misinterprets a future file (#44).
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

fn is_replica_name(name: &str) -> bool {
    name.starts_with("tasks_")
        && name.ends_with(".json")
        && !name.to_lowercase().contains("conflict")
}

fn legacy_path(path: &Path) -> PathBuf {
    path.with_file_name(crate::config::legacy_data_file_name())
}

fn seed_from_legacy_if_needed(path: &Path) -> Result<()> {
    if path.exists() || has_replicas(path) {
        return Ok(());
    }
    let legacy = legacy_path(path);
    if legacy.exists() {
        let bytes = fs::read(&legacy)?;
        let _ = parse_checked(&bytes)?;
        atomic_write(path, &bytes)?;
    }
    Ok(())
}

fn replica_paths(path: &Path) -> Result<Vec<PathBuf>> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let mut paths = Vec::new();
    if !parent.exists() {
        return Ok(paths);
    }
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if is_replica_name(&name) {
            paths.push(entry.path());
        }
    }
    if paths.is_empty() && path.exists() {
        paths.push(path.to_path_buf());
    }
    paths.sort();
    Ok(paths)
}

fn has_replicas(path: &Path) -> bool {
    replica_paths(path).map_or(false, |paths| !paths.is_empty())
}

fn read_merged_document(path: &Path) -> Result<Option<Document>> {
    let mut docs = Vec::new();
    for replica in replica_paths(path)? {
        let bytes = fs::read(&replica)?;
        docs.push(parse_checked(&bytes)?);
    }
    if docs.is_empty() {
        return Ok(None);
    }
    Ok(Some(merge_documents(docs)))
}

fn replicas_hash(path: &Path) -> Result<[u8; 32]> {
    let mut h = Sha256::new();
    for replica in replica_paths(path)? {
        h.update(
            replica
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .as_bytes(),
        );
        h.update([0]);
        h.update(fs::read(replica)?);
        h.update([0]);
    }
    Ok(h.finalize().into())
}

/// Save `local_bytes` beside `target_path` as a conflict file the conflict UI
/// will surface, so adopting a folder that already has data never silently
/// discards the local document (#34).
fn write_local_conflict(target_path: &Path, local_bytes: &[u8]) -> Result<()> {
    let parent = target_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = target_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("tasks");
    let name = format!("{stem}.conflict-local-{}.json", crate::model::now_ms());
    atomic_write(&parent.join(name), local_bytes)
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().into()
}

pub(crate) fn atomic_write(target: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = target.with_extension("json.tmp");
    let result: std::io::Result<()> = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        // On Windows, std::fs::rename replaces atomically since Rust 1.50.
        fs::rename(&tmp, target)?;
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

#[cfg(test)]
mod repoint_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn write_bumps_last_modified() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks.json")).unwrap();
        let before = state.read(|d| d.last_modified);

        state
            .write(|d| {
                d.tasks.push(sample_task("k_x"));
                Ok(())
            })
            .unwrap();

        let after = state.read(|d| d.last_modified);
        assert!(
            after > before,
            "write should bump last_modified ({after} !> {before})"
        );

        // The bump is persisted to disk, not just held in memory. On disk the
        // stamp is ISO-8601 at second precision, so it equals the in-memory value
        // only after truncating sub-second millis.
        let bytes = std::fs::read(dir.path().join("tasks.json")).unwrap();
        let on_disk: crate::model::Document = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(on_disk.last_modified, after - after % 1000);
    }

    #[test]
    fn repoint_seeds_when_target_absent() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks.json")).unwrap();
        // mutate so the seeded copy is observable
        state
            .write(|d| {
                d.tasks.push(sample_task("k_seed"));
                Ok(())
            })
            .unwrap();

        let target_dir = tempdir().unwrap();
        let new_path = target_dir.path().join("tasks.json");
        assert!(!new_path.exists());
        state.repoint(new_path.clone()).unwrap();

        assert!(new_path.exists(), "seeded file should be created");
        assert_eq!(state.path(), new_path);
        let bytes = std::fs::read(&new_path).unwrap();
        let doc: crate::model::Document = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            doc.tasks.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            ["k_seed"]
        );
    }

    #[test]
    fn repoint_adopts_existing_target() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks.json")).unwrap();

        // Build a different doc and write it to the target.
        let target_dir = tempdir().unwrap();
        let new_path = target_dir.path().join("tasks.json");
        let mut other = state.read(|d| d.clone());
        other.tasks.push(sample_task("k_theirs"));
        std::fs::write(&new_path, serde_json::to_vec_pretty(&other).unwrap()).unwrap();

        state.repoint(new_path.clone()).unwrap();

        assert_eq!(state.path(), new_path);
        // In-memory doc adopted the target's content.
        assert_eq!(
            state.read(|d| d.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>()),
            ["k_theirs"]
        );
        // Hash now matches the adopted bytes, so the watcher won't re-import.
        let h = {
            use sha2::{Digest, Sha256};
            let mut hh = Sha256::new();
            hh.update(std::fs::read(&new_path).unwrap());
            let out: [u8; 32] = hh.finalize().into();
            out
        };
        assert_eq!(state.last_written_hash(), h);
    }

    fn sample_task(id: &str) -> crate::model::Task {
        crate::model::Task {
            id: id.into(),
            title: id.into(),
            due_date: None,
            due_time: None,
            start_date: None,
            start_time: None,
            notes: String::new(),
            tag_ids: Vec::new(),
            estimated_seconds: None,
            created_at: 0,
            completed_at: None,
            updated_at: 0,
            time_entries: Vec::new(),
        }
    }

    #[test]
    fn open_rejects_newer_version() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks.json");
        let mut doc = Document::default();
        doc.version = CURRENT_VERSION + 1;
        std::fs::write(&path, serde_json::to_vec_pretty(&doc).unwrap()).unwrap();

        assert!(
            AppState::open(path).is_err(),
            "a newer-version file must be refused"
        );
    }

    #[test]
    fn open_accepts_file_missing_version() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks.json");
        // Older format with no `version` key must still load (serde default).
        std::fs::write(&path, r#"{"tasks":[],"tags":[]}"#).unwrap();

        let state = AppState::open(path).unwrap();
        assert_eq!(state.read(|d| d.version), CURRENT_VERSION);
    }

    #[test]
    fn repoint_discards_local_and_loads_the_target() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks.json")).unwrap();
        // Local-only data. Changing the data source discards it in favor of the
        // target folder's data — no conflict file is written.
        state
            .write(|d| {
                d.tasks.push(sample_task("k_local"));
                Ok(())
            })
            .unwrap();

        // Target folder already holds a different tasks.json (the new source).
        let target_dir = tempdir().unwrap();
        let new_path = target_dir.path().join("tasks.json");
        let mut other = Document::default();
        other.tasks.push(sample_task("k_theirs"));
        std::fs::write(&new_path, serde_json::to_vec_pretty(&other).unwrap()).unwrap();

        state.repoint(new_path.clone()).unwrap();

        // The target's data was loaded outright...
        assert_eq!(
            state.read(|d| d.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>()),
            ["k_theirs"]
        );
        // ...and the local doc was discarded, NOT preserved as a conflict file.
        assert!(
            crate::sync::scan_conflict_files(&new_path).is_empty(),
            "changing the data source discards local data without a conflict file"
        );
    }

    #[test]
    fn store_recovers_after_a_panic_poisons_the_lock() {
        use std::panic::{catch_unwind, AssertUnwindSafe};

        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks.json")).unwrap();

        // A panic inside the write closure unwinds while the lock is held, which
        // poisons the std Mutex. catch_unwind keeps the test thread alive so we
        // can prove the store still works afterwards (the panic backtrace printed
        // to stderr during this test is expected, not a failure).
        let poisoned = catch_unwind(AssertUnwindSafe(|| {
            let _ = state.write(|_| -> Result<()> { panic!("boom") });
        }));
        assert!(poisoned.is_err(), "the closure should have panicked");

        // Before the fix, every later lock().unwrap() would re-panic on the poison.
        // With unwrap_or_else(|e| e.into_inner()) the guard is recovered, so reads
        // and writes keep working.
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
    fn repoint_adopts_without_conflict_when_local_is_empty() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks.json")).unwrap();
        // No local tasks/tags → nothing to preserve.

        let target_dir = tempdir().unwrap();
        let new_path = target_dir.path().join("tasks.json");
        let mut other = Document::default();
        other.tasks.push(sample_task("k_theirs"));
        std::fs::write(&new_path, serde_json::to_vec_pretty(&other).unwrap()).unwrap();

        state.repoint(new_path.clone()).unwrap();

        assert!(
            crate::sync::scan_conflict_files(&new_path).is_empty(),
            "no conflict file when there is no local data to lose"
        );
    }

    #[test]
    fn open_merges_sibling_device_replicas() {
        let dir = tempdir().unwrap();
        let desktop_path = dir.path().join("tasks_desktop.json");
        let mobile_path = dir.path().join("tasks_mobile.json");

        let mut desktop = Document::default();
        desktop.tasks.push(sample_task("k_desktop"));
        std::fs::write(&desktop_path, serde_json::to_vec_pretty(&desktop).unwrap()).unwrap();

        let mut mobile = Document::default();
        mobile.tasks.push(sample_task("k_mobile"));
        std::fs::write(&mobile_path, serde_json::to_vec_pretty(&mobile).unwrap()).unwrap();

        let state = AppState::open(desktop_path).unwrap();
        let ids = state.read(|d| {
            d.tasks
                .iter()
                .map(|task| task.id.clone())
                .collect::<Vec<_>>()
        });
        assert_eq!(ids, ["k_desktop", "k_mobile"]);
    }
}
