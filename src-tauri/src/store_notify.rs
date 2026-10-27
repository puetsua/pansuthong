//! UI refresh notifications after the synced document changes.

use tauri::{AppHandle, Emitter, Runtime};

/// Event name the frontend listens for in `src/state/store.ts`.
pub const STORE_CHANGED: &str = "store-changed";

/// Notify all webview listeners that the synced document changed.
///
/// MCP HTTP handlers run on the Tokio runtime; on Linux/WebKitGTK, delivering the
/// JS event must be scheduled on the GTK main thread or the open window may not
/// reload even though persistence succeeded.
pub(crate) fn emit_store_changed<R: Runtime>(app: &AppHandle<R>) {
    let for_main = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        let _ = for_main.emit(STORE_CHANGED, ());
    }) {
        eprintln!("warning: failed to schedule store-changed: {e}");
        let _ = app.emit(STORE_CHANGED, ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::Listener;

    #[test]
    fn store_changed_event_matches_frontend_listener() {
        assert_eq!(STORE_CHANGED, "store-changed");
    }

    /// MCP HTTP handlers call `emit_store_changed` from a worker thread; the UI
    /// listens for the same event name as Tauri commands.
    #[test]
    fn emit_store_changed_from_background_thread_notifies_listener() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        let heard = Arc::new(AtomicBool::new(false));
        let heard2 = heard.clone();
        app.listen(STORE_CHANGED, move |_| {
            heard2.store(true, Ordering::SeqCst);
        });
        let handle = app.handle().clone();
        std::thread::spawn(move || emit_store_changed(&handle))
            .join()
            .expect("join");
        assert!(
            heard.load(Ordering::SeqCst),
            "store-changed listener should run when emit is scheduled from a worker thread"
        );
    }
}
