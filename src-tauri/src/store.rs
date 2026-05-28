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
    pub fn write<F, T>(&self, f: F) -> Result<T>
    where F: FnOnce(&mut Document) -> Result<T> {
        let mut g = self.inner.lock().unwrap();
        let value = f(&mut g.doc)?;
        let bytes = serde_json::to_vec_pretty(&g.doc)?;
        atomic_write(&g.path, &bytes)?;
        g.last_written_hash = sha256(&bytes);
        Ok(value)
    }

    pub fn path(&self) -> PathBuf {
        self.inner.lock().unwrap().path.clone()
    }

    #[allow(dead_code)] // used by Phase 2 sync
    pub fn last_written_hash(&self) -> [u8; 32] {
        self.inner.lock().unwrap().last_written_hash
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
