pub mod commands;
pub mod conflict;
pub mod error;
pub mod location;
pub mod model;
pub mod parse;
pub mod safsync;
pub mod search;
pub mod store;
pub mod sync;

use crate::store::AppState;
#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
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

    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_android_fs::init());

    builder
        .setup(|app| {
            let default_dir = app
                .path()
                .app_data_dir()
                .expect("app_data_dir resolvable");
            std::fs::create_dir_all(&default_dir).expect("create app data dir");
            // Effective path honours a device-local custom folder, if set.
            let path = crate::location::resolve_data_path(&default_dir);
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let state = AppState::open(path.clone()).expect("open store");
            app.manage(state);

            let handle = app.handle().clone();
            let sync_handle = crate::sync::start(handle, path.clone()).ok();
            if sync_handle.is_none() {
                eprintln!("warning: filesystem watcher failed to start");
            }
            app.manage(crate::sync::WatcherHandle(std::sync::Mutex::new(sync_handle)));

            // Android folder-sync: restore the previously linked SAF folder (if any)
            // and manage the sync runtime state. The sidecar (sync.json) lives beside
            // the app-private tasks.json and is never itself synced (#Phase 4B).
            #[cfg(target_os = "android")]
            {
                use crate::safsync::{load_config, SafSync};
                let cfg = load_config(&path);
                let saf = SafSync::default();
                if let Some(json) = cfg.folder_uri_json.clone() {
                    let ok = crate::safsync::android::permission_ok(&app.handle(), &json);
                    let mut g = saf.inner.lock().unwrap();
                    g.folder_uri_json = Some(json);
                    g.folder_label = cfg.folder_label.clone();
                    g.permission_ok = ok;
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
            commands::sync_now,
            commands::add_task,
            commands::update_task,
            commands::set_task_done,
            commands::archive_completed,
            commands::delete_task,
            commands::add_tag,
            commands::delete_tag,
            commands::parse_composer,
            commands::search_tasks,
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
