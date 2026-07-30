use serde::{Serialize, Serializer};
use std::io;

#[derive(Debug)]
pub enum AppError {
    Io(io::Error),
    Serde(serde_json::Error),
    NotFound(String),
    Invalid(String),
    Db(rusqlite::Error),
    /// The data file is locked by another process (typically the cloud-sync client
    /// uploading it) and stayed locked past our retry budget. Distinct from `Db` so
    /// the retry loop can match on it and the user sees a written explanation rather
    /// than rusqlite's `database is locked`.
    Busy(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Io(e) => write!(f, "io: {e}"),
            AppError::Serde(e) => write!(f, "serde: {e}"),
            AppError::NotFound(s) => write!(f, "not found: {s}"),
            AppError::Invalid(s) => write!(f, "invalid: {s}"),
            AppError::Db(e) => write!(f, "db: {e}"),
            AppError::Busy(s) => write!(f, "{s}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<io::Error> for AppError {
    fn from(e: io::Error) -> Self {
        AppError::Io(e)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Serde(e)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e)
    }
}

// Tauri commands need errors that serialize.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
