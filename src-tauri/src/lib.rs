pub mod commands;
pub mod conflict;
pub mod error;
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
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app_data_dir resolvable");
            std::fs::create_dir_all(&data_dir).expect("create app data dir");
            let path = data_dir.join("tasks.json");
            let state = AppState::open(path.clone()).expect("open store");
            app.manage(state);

            let handle = app.handle().clone();
            match crate::sync::start(handle, path) {
                Ok(sync_handle) => {
                    app.manage(sync_handle);
                }
                Err(e) => {
                    eprintln!("warning: filesystem watcher failed to start: {e}");
                }
            }

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
