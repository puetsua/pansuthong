mod check;
mod commands;
mod download;
mod error;
mod models;
mod version;

pub use error::Error;
pub use models::UpdateInfo;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Initializes the Android updater plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-updater")
        .invoke_handler(tauri::generate_handler![
            commands::check,
            commands::download_and_install
        ])
        .build()
}
