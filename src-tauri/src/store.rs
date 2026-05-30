use crate::error::{AppError, Result};
use crate::model::{Document, CURRENT_VERSION};
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
}

impl AppState {
    /// Load `Document` from `path` (or write a default if absent).
    pub fn open(path: PathBuf) -> Result<Self> {
        let (doc, bytes) = if path.exists() {
            let s = fs::read_to_string(&path)?;
            let d = parse_checked(s.as_bytes())?;
            (d, s.into_bytes())
        } else {
            let d = Document::default();
            let bytes = serde_json::to_vec_pretty(&d)?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            atomic_write(&path, &bytes)?;
            (d, bytes)
        };
        let hash = sha256(&bytes);
        Ok(Self {
            inner: Mutex::new(Inner { doc, path, last_written_hash: hash }),
        })
    }

    pub fn read<F, T>(&self, f: F) -> T
    where F: FnOnce(&Document) -> T {
        let g = self.inner.lock().unwrap();
        f(&g.doc)
    }

    /// Mutate then persist. Returns the result of `f` after the file is on disk.
    /// Bumps `last_modified` so every edit stamps the document with its edit time.
    pub fn write<F, T>(&self, f: F) -> Result<T>
    where F: FnOnce(&mut Document) -> Result<T> {
        let mut g = self.inner.lock().unwrap();
        let value = f(&mut g.doc)?;
        g.doc.last_modified = crate::model::now_ms();
        let bytes = serde_json::to_vec_pretty(&g.doc)?;
        atomic_write(&g.path, &bytes)?;
        g.last_written_hash = sha256(&bytes);
        Ok(value)
    }

    /// Replace the in-memory document with a freshly parsed one and update the
    /// hash to match what's now on disk. Called by sync.rs after detecting an
    /// external write.
    pub fn reload_from_bytes(&self, bytes: Vec<u8>) -> Result<()> {
        let doc = parse_checked(&bytes)?;
        let mut g = self.inner.lock().unwrap();
        g.doc = doc;
        g.last_written_hash = sha256(&bytes);
        Ok(())
    }

    pub fn path(&self) -> PathBuf {
        self.inner.lock().unwrap().path.clone()
    }

    #[allow(dead_code)] // used by Phase 2 sync
    pub fn last_written_hash(&self) -> [u8; 32] {
        self.inner.lock().unwrap().last_written_hash
    }

    /// Relocate the master data file to `new_path`. If `new_path` already exists,
    /// adopt its contents; otherwise seed it from the current in-memory document.
    /// Adopting no longer silently discards local data: if the current document
    /// holds tasks/tags, it is first written to a conflict file in the target
    /// directory so the conflict UI can reconcile it (#34). Updates the stored
    /// path and the loop-suppression hash.
    pub fn repoint(&self, new_path: std::path::PathBuf) -> Result<()> {
        let mut g = self.inner.lock().unwrap();
        if new_path.exists() {
            let bytes = std::fs::read(&new_path)?;
            let target_doc = parse_checked(&bytes)?;
            // Preserve local-only data instead of dropping it (#34).
            if doc_has_data(&g.doc) {
                let local_bytes = serde_json::to_vec_pretty(&g.doc)?;
                if local_bytes != bytes {
                    write_local_conflict(&new_path, &local_bytes)?;
                }
            }
            g.doc = target_doc;
            g.last_written_hash = sha256(&bytes);
            g.path = new_path;
        } else {
            let bytes = serde_json::to_vec_pretty(&g.doc)?;
            atomic_write(&new_path, &bytes)?;
            g.last_written_hash = sha256(&bytes);
            g.path = new_path;
        }
        Ok(())
    }
}

/// Parse a document and reject one written by a newer schema version, so an
/// older binary never silently misinterprets a future file (#44).
fn parse_checked(bytes: &[u8]) -> Result<Document> {
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

/// Save `local_bytes` beside `target_path` as a conflict file the conflict UI
/// will surface, so adopting a folder that already has data never silently
/// discards the local document (#34).
fn write_local_conflict(target_path: &Path, local_bytes: &[u8]) -> Result<()> {
    let parent = target_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = target_path.file_stem().and_then(|s| s.to_str()).unwrap_or("tasks");
    let name = format!("{stem}.conflict-local-{}.json", crate::model::now_ms());
    atomic_write(&parent.join(name), local_bytes)
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().into()
}

fn atomic_write(target: &Path, bytes: &[u8]) -> Result<()> {
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

        state.write(|d| { d.settings.theme = "dark".into(); Ok(()) }).unwrap();

        let after = state.read(|d| d.last_modified);
        assert!(after > before, "write should bump last_modified ({after} !> {before})");

        // The bump is persisted to disk, not just held in memory.
        let bytes = std::fs::read(dir.path().join("tasks.json")).unwrap();
        let on_disk: crate::model::Document = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(on_disk.last_modified, after);
    }

    #[test]
    fn repoint_seeds_when_target_absent() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks.json")).unwrap();
        // mutate so the seeded copy is observable
        state.write(|d| { d.settings.theme = "dark".into(); Ok(()) }).unwrap();

        let target_dir = tempdir().unwrap();
        let new_path = target_dir.path().join("tasks.json");
        assert!(!new_path.exists());
        state.repoint(new_path.clone()).unwrap();

        assert!(new_path.exists(), "seeded file should be created");
        assert_eq!(state.path(), new_path);
        let bytes = std::fs::read(&new_path).unwrap();
        let doc: crate::model::Document = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(doc.settings.theme, "dark");
    }

    #[test]
    fn repoint_adopts_existing_target() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks.json")).unwrap();

        // Build a different doc and write it to the target.
        let target_dir = tempdir().unwrap();
        let new_path = target_dir.path().join("tasks.json");
        let mut other = state.read(|d| d.clone());
        other.settings.theme = "light".into();
        std::fs::write(&new_path, serde_json::to_vec_pretty(&other).unwrap()).unwrap();

        state.repoint(new_path.clone()).unwrap();

        assert_eq!(state.path(), new_path);
        // In-memory doc adopted the target's content.
        assert_eq!(state.read(|d| d.settings.theme.clone()), "light");
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
            id: id.into(), title: id.into(), done: false,
            due_date: None, scheduled_date: None, notes: String::new(),
            tag_ids: Vec::new(), created_at: 0, completed_at: None, updated_at: 0,
        }
    }

    #[test]
    fn open_rejects_newer_version() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks.json");
        let mut doc = Document::default();
        doc.version = CURRENT_VERSION + 1;
        std::fs::write(&path, serde_json::to_vec_pretty(&doc).unwrap()).unwrap();

        assert!(AppState::open(path).is_err(), "a newer-version file must be refused");
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
    fn repoint_preserves_local_data_as_conflict_file() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks.json")).unwrap();
        // Local-only data that a naive adopt would discard.
        state.write(|d| { d.tasks.push(sample_task("k_local")); Ok(()) }).unwrap();

        // Target folder already holds a different tasks.json (from another device).
        let target_dir = tempdir().unwrap();
        let new_path = target_dir.path().join("tasks.json");
        let mut other = Document::default();
        other.settings.theme = "light".into();
        std::fs::write(&new_path, serde_json::to_vec_pretty(&other).unwrap()).unwrap();

        state.repoint(new_path.clone()).unwrap();

        // The target was adopted...
        assert_eq!(state.read(|d| d.settings.theme.clone()), "light");
        // ...and the local doc was preserved as a conflict file, not discarded.
        let conflicts = crate::sync::scan_conflict_files(&new_path);
        assert_eq!(conflicts.len(), 1, "local data should be saved to a conflict file");
        let bytes = std::fs::read(&conflicts[0]).unwrap();
        let preserved: Document = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(preserved.tasks.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["k_local"]);
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

        assert!(crate::sync::scan_conflict_files(&new_path).is_empty(),
                "no conflict file when there is no local data to lose");
    }
}
