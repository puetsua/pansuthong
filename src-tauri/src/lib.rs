pub mod commands;
pub mod config;
pub mod conflict;
pub mod db;
pub mod error;
pub mod history;
pub mod model;
pub mod parse;
pub mod safsync;
pub mod store;
pub mod sync;

use crate::store::AppState;
use tauri::Manager;

#[cfg(desktop)]
const STATE_FILENAME: &str = ".state.json";
#[cfg(desktop)]
const LEGACY_WINDOW_STATE_FILENAME: &str = ".window-state.json";

/// Allow the asset protocol to serve only managed attachment blobs under `parent`:
/// flat legacy `attachment_*` and per-device `attachments_*/attachment_*`. Mirrors
/// the static scope in tauri.conf.json for a folder whose path is only known at
/// runtime (the default app-data dir, or a user-chosen sync folder), without
/// exposing unrelated files that sit beside the blobs (e.g. tasks_*.json).
fn allow_attachment_scope(scope: &tauri::scope::fs::Scope, parent: &std::path::Path) {
    let _ = scope.allow_file(parent.join("attachment_*"));
    let _ = scope.allow_file(parent.join("attachments_*").join("attachment_*"));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_dialog::init());

    // In-app updater (desktop only; Android updates via the Play Store / APK).
    // tauri-plugin-process supplies the relaunch() the frontend calls after an
    // update installs.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Remember the main window's size, position, and maximized state across
    // launches (desktop only — mobile has no movable window).
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri::plugin::Builder::<_, ()>::new("state-file-migration")
            .setup(|app, _api| {
                let app_config_dir = app.path().app_config_dir()?;
                let old_path = app_config_dir.join(LEGACY_WINDOW_STATE_FILENAME);
                let new_path = app_config_dir.join(STATE_FILENAME);
                if old_path.exists() && !new_path.exists() {
                    std::fs::create_dir_all(&app_config_dir)?;
                    std::fs::rename(old_path, new_path)?;
                }
                Ok(())
            })
            .build(),
    );

    // Persist size/position/maximized — but never decorations. Restoring a
    // previously decorated state would override `decorations: false` and bring
    // back the OS titlebar (tauri-apps/plugins-workspace#1970 / #2203).
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_filename(STATE_FILENAME)
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::SIZE
                    | tauri_plugin_window_state::StateFlags::POSITION
                    | tauri_plugin_window_state::StateFlags::MAXIMIZED
                    | tauri_plugin_window_state::StateFlags::VISIBLE
                    | tauri_plugin_window_state::StateFlags::FULLSCREEN,
            )
            .build(),
    );

    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_android_fs::init());

    // MCP Bridge: WebSocket on :9223 for @hypothesi/tauri-mcp-server (screenshots,
    // DOM, IPC). Debug builds only — not shipped in release.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .setup(|app| {
            let default_dir = app.path().app_data_dir().expect("app_data_dir resolvable");
            std::fs::create_dir_all(&default_dir).expect("create app data dir");
            // Device-local config: chosen folder + settings. Migrates legacy
            // data_location.json / tasks.json settings on first launch.
            let config = crate::config::load_or_migrate(&default_dir);
            // Effective path honours a device-local custom folder, if set.
            let path =
                crate::config::resolve_data_path(&default_dir, &config.folder, &config.device_id);
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let state = AppState::open(path.clone()).expect("open store");
            // Relocate any pre-subdir flat attachment blobs into this device's
            // attachments_<device>/ folder before the UI can reference them.
            commands::migrate_attachments_to_subdir(&state, &config.device_id);
            app.manage(state);
            // Attachments live in attachments_<device>/ beside the data file and
            // are served to the webview via the asset protocol (convertFileSrc).
            // The default app-data dir is covered by the config scope ($APPDATA),
            // but a user-chosen folder is only known at runtime, so allow it here
            // too. Scope to the managed-attachment globs (flat legacy + per-device
            // subdirs, including other devices' synced ones) rather than the whole
            // folder recursively, so the webview can't fetch unrelated files that
            // happen to sit beside the blobs (e.g. tasks_*.json). Mirrors the
            // static asset scope in tauri.conf.json.
            if let Some(parent) = path.parent() {
                allow_attachment_scope(&app.asset_protocol_scope(), parent);
            }
            app.manage(crate::config::ConfigState::new(&default_dir, config));

            let handle = app.handle().clone();
            let sync_handle = crate::sync::start(handle, path.clone()).ok();
            if sync_handle.is_none() {
                eprintln!("warning: filesystem watcher failed to start");
            }
            app.manage(crate::sync::WatcherHandle(std::sync::Mutex::new(
                sync_handle,
            )));

            // Force frameless main chrome on desktop. Config sets decorations:false,
            // but window-state / DWM can still leave a captioned frame — re-assert
            // now and once more on the next event-loop tick after plugins settle.
            #[cfg(desktop)]
            {
                use tauri::Manager;
                let force_frameless = |app: &tauri::AppHandle| {
                    if let Some(win) = app.get_webview_window("main") {
                        if let Err(e) = win.set_decorations(false) {
                            eprintln!("warning: set_decorations(false) failed: {e}");
                        }
                    } else {
                        eprintln!("warning: main window missing when forcing frameless");
                    }
                };
                force_frameless(app.handle());
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    force_frameless(&handle);
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    force_frameless(&handle);
                });
            }

            // Android folder-sync: restore the previously linked SAF folder (if any)
            // and manage the sync runtime state. The sidecar (sync.json) lives beside
            // the app-private tasks.json and is never itself synced (#Phase 4B).
            #[cfg(target_os = "android")]
            {
                use crate::safsync::{load_config, SafSync};
                let cfg = load_config(&path);
                let saf = SafSync::default();
                if let Some(json) = cfg.folder_uri_json.clone() {
                    let ok = crate::safsync::android::permission_ok(app.handle(), &json);
                    let mut g = saf.inner.lock().unwrap();
                    g.folder_uri_json = Some(json);
                    g.folder_label = cfg.folder_label.clone();
                    g.permission_ok = ok;
                    // Restore the last-synced hash so the launch sync doesn't treat
                    // the unchanged local doc as "never synced" and clobber a remote
                    // updated by another device while this app was closed (#Phase 4B).
                    g.last_synced_hash = cfg.last_synced_hash;
                }
                app.manage(saf);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_document,
            commands::list_history,
            commands::sync_now,
            commands::attach_task_files,
            commands::attach_template_files,
            commands::attach_task_bytes,
            commands::attach_template_bytes,
            commands::remove_task_attachment,
            commands::remove_template_attachment,
            commands::resolve_attachment_path,
            commands::reveal_attachment,
            commands::open_attachment,
            commands::pick_task_attachments,
            commands::pick_template_attachments,
            commands::add_task,
            commands::update_task,
            commands::set_task_done,
            commands::duplicate_task,
            commands::delete_task,
            commands::start_timer,
            commands::stop_timer,
            commands::add_time_entry,
            commands::update_time_entry,
            commands::delete_time_entry,
            commands::add_template,
            commands::update_template,
            commands::duplicate_template,
            commands::delete_template,
            commands::spawn_recurring_task,
            commands::add_tag,
            commands::delete_tag,
            commands::update_tag,
            commands::update_settings,
            commands::list_conflicts,
            commands::read_conflict,
            commands::resolve_conflict,
            commands::dismiss_conflict,
            commands::get_data_location,
            commands::set_data_folder,
            commands::clear_data_folder,
            commands::saf_pick_folder,
            commands::saf_clear_folder,
            commands::saf_push,
            commands::saf_sync_now,
            commands::saf_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
