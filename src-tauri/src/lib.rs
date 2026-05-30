pub mod commands;
pub mod conflict;
pub mod error;
pub mod location;
pub mod model;
pub mod parse;
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
            let sync_handle = crate::sync::start(handle, path).ok();
            if sync_handle.is_none() {
                eprintln!("warning: filesystem watcher failed to start");
            }
            app.manage(crate::sync::WatcherHandle(std::sync::Mutex::new(sync_handle)));

            // Desktop quick-capture: a hidden, always-on-top window the global
            // shortcut shows. Created here (not in tauri.conf.json) so it never
            // exists on Android.
            #[cfg(desktop)]
            {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

                WebviewWindowBuilder::new(
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
                .build()?;

                let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN);
                app.global_shortcut().register(hotkey)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_document,
            commands::add_task,
            commands::update_task,
            commands::set_task_done,
            commands::delete_task,
            commands::add_project,
            commands::delete_project,
            commands::add_tag,
            commands::delete_tag,
            commands::clear_tag_project,
            commands::parse_composer,
            commands::search_tasks,
            commands::update_project,
            commands::update_tag,
            commands::update_settings,
            commands::list_conflicts,
            commands::read_conflict,
            commands::resolve_conflict,
            commands::dismiss_conflict,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
