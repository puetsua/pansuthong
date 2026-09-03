mod check;
mod commands;
mod download;
mod error;
mod models;
mod state;
mod version;

pub use error::Error;
pub use models::{UpdateInfo, UpdateResponse};

use std::sync::Mutex;

use state::PendingUpdate;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Initializes the Android updater plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-updater")
        .setup(|app, _api| {
            app.manage(PendingUpdate(Mutex::new(None)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::check,
            commands::download_and_install
        ])
        .build()
}
