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
/// Floor so mobile bottom tabs (Today / Inbox / Upcoming) stay fully visible.
#[cfg(desktop)]
const MAIN_MIN_WIDTH: f64 = 400.0;
#[cfg(desktop)]
const MAIN_MIN_HEIGHT: f64 = 500.0;

/// Restore and focus the existing main window when a second launch is blocked.
/// `unminimize` + `show` are required: `set_focus` alone does not restore a
/// minimized window, and the window starts hidden until `show_main_window`.
#[cfg(desktop)]
fn focus_existing_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("warning: main window missing when focusing existing instance");
        return;
    };
    fn warn(op: &str, result: tauri::Result<()>) {
        if let Err(e) = result {
            eprintln!("warning: {op} existing instance failed: {e}");
        }
    }
    warn("unminimize", window.unminimize());
    warn("show", window.show());
    warn("set_focus", window.set_focus());
    // Existing process is usually not foreground, so Windows may deny
    // SetForegroundWindow. A brief always-on-top flip raises z-order;
    // the app is never left always-on-top.
    #[cfg(target_os = "windows")]
    {
        warn("set_always_on_top(true)", window.set_always_on_top(true));
        warn("set_focus", window.set_focus());
        warn("set_always_on_top(false)", window.set_always_on_top(false));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // First plugin so a second launch exits before other plugins start work.
    #[cfg(desktop)]
    let builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_existing_main_window(app);
        }));
    #[cfg(not(desktop))]
    let builder = tauri::Builder::default();

    let builder = builder
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

    // Persist size/position/maximized — but never decorations or visibility.
    // Restoring a previously decorated state would override `decorations: false`
    // and bring back the OS titlebar (tauri-apps/plugins-workspace#1970 / #2203).
    // The window stays hidden until the frontend's first rendered frame, so saved
    // geometry can settle without a visible move/resize flash.
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_filename(STATE_FILENAME)
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::SIZE
                    | tauri_plugin_window_state::StateFlags::POSITION
                    | tauri_plugin_window_state::StateFlags::MAXIMIZED
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
            // When a custom folder is configured but not available (e.g. Google
            // Drive not yet mounted at boot), use a temporary in-memory store so
            // the app can show a loading screen and retry. The frontend calls
            // `try_open_data` to switch to the real store once the folder appears.
            //
            // This check MUST happen before `resolve_data_path`, which silently
            // falls back to the default directory when the configured folder
            // doesn't exist — without it, the app would open the default path and
            // never show the loading screen.
            let folder_unavailable = config.folder.as_ref()
                .is_some_and(|f| !std::path::Path::new(f).is_dir());
            let (state, path) = if folder_unavailable {
                eprintln!("warning: configured data folder not available; using temp store");
                // The intended path is inside the configured folder (which doesn't
                // exist yet). Store it so `retry_open` knows where to look once the
                // folder mounts.
                let intended = std::path::Path::new(config.folder.as_ref().unwrap())
                    .join(crate::config::data_file_name(&config.device_id));
                let state = AppState::open_in_memory(&config.device_id, intended.clone())
                    .expect("in-memory store");
                (state, intended)
            } else {
                let path =
                    crate::config::resolve_data_path(&default_dir, &config.folder, &config.device_id);
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let state = AppState::open(path.clone()).expect("open store");
                (state, path)
            };
            // Relocate any pre-subdir flat attachment blobs into this device's
            // attachments_<device>/ folder before the UI can reference them.
            commands::migrate_attachments_to_subdir(&state, &config.device_id);
            app.manage(state);
            // Attachment blobs live in attachments_<device>/ beside the data file
            // and are served to the webview as raw bytes via the `read_attachment`
            // command (rendered as blob: URLs), so there is no asset-protocol path
            // scope to maintain here.
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
            // Min size comes from OS constraints (config + set_size_constraints) so
            // drag-resize stops cleanly; only clamp once after window-state restore
            // (never on every Resized — that fights the drag and shakes the window).
            #[cfg(desktop)]
            {
                use tauri::{LogicalSize, Manager, PixelUnit, Size, WindowSizeConstraints};
                fn clamp_main(win: &tauri::WebviewWindow) {
                    if let (Ok(size), Ok(scale)) = (win.inner_size(), win.scale_factor()) {
                        let logical_w = size.width as f64 / scale;
                        let logical_h = size.height as f64 / scale;
                        if logical_w + 0.5 < MAIN_MIN_WIDTH || logical_h + 0.5 < MAIN_MIN_HEIGHT {
                            if let Err(e) = win.set_size(Size::Logical(LogicalSize::new(
                                logical_w.max(MAIN_MIN_WIDTH),
                                logical_h.max(MAIN_MIN_HEIGHT),
                            ))) {
                                eprintln!("warning: clamp window size failed: {e}");
                            }
                        }
                    }
                }
                fn enforce_desktop_chrome(app: &tauri::AppHandle) {
                    if let Some(win) = app.get_webview_window("main") {
                        if let Err(e) = win.set_decorations(false) {
                            eprintln!("warning: set_decorations(false) failed: {e}");
                        }
                        let constraints = WindowSizeConstraints {
                            min_width: Some(PixelUnit::Logical(MAIN_MIN_WIDTH.into())),
                            min_height: Some(PixelUnit::Logical(MAIN_MIN_HEIGHT.into())),
                            max_width: None,
                            max_height: None,
                        };
                        if let Err(e) = win.set_size_constraints(constraints) {
                            eprintln!("warning: set_size_constraints failed: {e}");
                        }
                        clamp_main(&win);
                    } else {
                        eprintln!("warning: main window missing when enforcing desktop chrome");
                    }
                }
                enforce_desktop_chrome(app.handle());
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    enforce_desktop_chrome(&handle);
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    enforce_desktop_chrome(&handle);
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
            commands::try_open_data,
            commands::open_default_store,
            commands::show_main_window,
            commands::list_history,
            commands::attach_task_files,
            commands::attach_template_files,
            commands::attach_task_bytes,
            commands::attach_template_bytes,
            commands::remove_task_attachment,
            commands::remove_template_attachment,
            commands::read_attachment,
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
