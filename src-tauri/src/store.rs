use crate::error::{AppError, Result};
use crate::model::Document;
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
            let d: Document = serde_json::from_str(&s)?;
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
        let doc: Document = serde_json::from_slice(&bytes)?;
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
    /// adopt its contents (last-write-wins); otherwise seed it from the current
    /// in-memory document. Updates the stored path and the loop-suppression hash.
    pub fn repoint(&self, new_path: std::path::PathBuf) -> Result<()> {
        let mut g = self.inner.lock().unwrap();
        if new_path.exists() {
            let bytes = std::fs::read(&new_path)?;
            let doc: Document = serde_json::from_slice(&bytes)?;
            g.doc = doc;
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
}
