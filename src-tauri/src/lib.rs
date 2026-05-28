pub mod error;
pub mod model;

// `run()` and the rest will be rebuilt in later tasks.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Placeholder — wired up in Task 8.
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
