use serde::{Serialize, Serializer};
use std::io;

#[derive(Debug)]
pub enum AppError {
    Io(io::Error),
    Serde(serde_json::Error),
    NotFound(String),
    Invalid(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Io(e) => write!(f, "io: {e}"),
            AppError::Serde(e) => write!(f, "serde: {e}"),
            AppError::NotFound(s) => write!(f, "not found: {s}"),
            AppError::Invalid(s) => write!(f, "invalid: {s}"),
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

// Tauri commands need errors that serialize.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
