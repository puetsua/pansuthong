pub mod commands;
pub mod config;
pub mod conflict;
pub mod error;
pub mod history;
pub mod model;
pub mod parse;
pub mod safsync;
pub mod store;
pub mod sync;

use crate::store::AppState;
#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;

#[cfg(desktop)]
const STATE_FILENAME: &str = ".state.json";
#[cfg(desktop)]
const LEGACY_WINDOW_STATE_FILENAME: &str = ".window-state.json";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init());

    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                use tauri_plugin_global_shortcut::ShortcutState;
                if event.state() == ShortcutState::Pressed {
                    if let Some(win) = app.get_webview_window("quick-capture") {
                        let _ = win.show();
                        let _ = win.set_focus();
                        let _ = win.emit("capture-focus", ());
                    }
                }
            })
            .build(),
    );

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
    // launches (desktop only — mobile has no movable window). The quick-capture
    // window is fixed-size and centered, so it's excluded from persistence.
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

    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_filename(STATE_FILENAME)
            .with_denylist(&["quick-capture"])
            .build(),
    );

    // Closing the main window quits the app. Otherwise the hidden, always-on-top
    // quick-capture window keeps the process alive (there's no tray and no way to
    // reopen the main window), and tauri-plugin-window-state only flushes geometry
    // to disk on RunEvent::Exit — which would then never fire. The plugin refreshes
    // its cache on the preceding CloseRequested/move/resize, so the saved geometry
    // is current.
    #[cfg(desktop)]
    let builder = builder.on_window_event(|window, event| {
        if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
            window.app_handle().exit(0);
        }
    });

    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_android_fs::init());

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
            app.manage(state);
            app.manage(crate::config::ConfigState::new(&default_dir, config));

            let handle = app.handle().clone();
            let sync_handle = crate::sync::start(handle, path.clone()).ok();
            if sync_handle.is_none() {
                eprintln!("warning: filesystem watcher failed to start");
            }
            app.manage(crate::sync::WatcherHandle(std::sync::Mutex::new(
                sync_handle,
            )));

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

            // Desktop quick-capture: a hidden, always-on-top window the global
            // shortcut shows. Created here (not in tauri.conf.json) so it never
            // exists on Android.
            #[cfg(desktop)]
            {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

                // Quick capture is a convenience, not core. If its window can't be
                // built or the Ctrl+Shift+N hotkey can't be registered (e.g. another
                // app already owns it), log and carry on so the main app still
                // launches instead of aborting startup (#29).
                let quick_capture = WebviewWindowBuilder::new(
                    app,
                    "quick-capture",
                    WebviewUrl::App("quick-capture.html".into()),
                )
                .title("Quick Capture")
                .inner_size(480.0, 140.0)
                .decorations(false)
                .always_on_top(true)
                .visible(false)
                .skip_taskbar(true)
                .resizable(false)
                .center()
                .build();

                match quick_capture {
                    Ok(_) => {
                        let hotkey =
                            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN);
                        if let Err(e) = app.global_shortcut().register(hotkey) {
                            eprintln!("warning: quick-capture shortcut unavailable: {e}");
                        }
                    }
                    Err(e) => eprintln!("warning: quick-capture window unavailable: {e}"),
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_document,
            commands::list_history,
            commands::sync_now,
            commands::attach_task_files,
            commands::attach_template_files,
            commands::remove_task_attachment,
            commands::remove_template_attachment,
            commands::resolve_attachment_path,
            commands::pick_task_attachments,
            commands::pick_template_attachments,
            commands::add_task,
            commands::update_task,
            commands::set_task_done,
            commands::delete_task,
            commands::start_timer,
            commands::stop_timer,
            commands::add_time_entry,
            commands::update_time_entry,
            commands::delete_time_entry,
            commands::add_template,
            commands::update_template,
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
