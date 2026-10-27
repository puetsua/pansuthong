//! UI refresh notifications after the synced document changes.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Event name the frontend listens for in `src/state/store.ts`.
pub const STORE_CHANGED: &str = "store-changed";

/// At most one `store-changed` per window. Each event makes the window reload the
/// whole document, so a burst of MCP writes used to queue one full reload per
/// write and freeze the UI (#249 N5).
pub(crate) const STORE_CHANGED_WINDOW: Duration = Duration::from_millis(200);

/// Throttle state, managed on the app the first time it is needed.
#[derive(Default)]
struct StoreChangedThrottle(Mutex<ThrottleState>);

#[derive(Default)]
struct ThrottleState {
    last_emit: Option<Instant>,
    /// A trailing emit is scheduled; it covers every change made before it fires.
    trailing: bool,
}

/// Notify all webview listeners that the synced document changed.
///
/// Leading + trailing throttle: an isolated change notifies at once, while a burst
/// produces one event now and one at the end of each [`STORE_CHANGED_WINDOW`], so
/// the last change is always followed by an event.
pub(crate) fn emit_store_changed<R: Runtime>(app: &AppHandle<R>) {
    if app.try_state::<StoreChangedThrottle>().is_none() {
        app.manage(StoreChangedThrottle::default());
    }
    let throttle = app.state::<StoreChangedThrottle>();
    let mut st = throttle.0.lock().unwrap_or_else(|e| e.into_inner());
    if st.trailing {
        return;
    }
    let now = Instant::now();
    let since = st.last_emit.map(|t| now.duration_since(t));
    match since {
        Some(elapsed) if elapsed < STORE_CHANGED_WINDOW => {
            st.trailing = true;
            let delay = STORE_CHANGED_WINDOW - elapsed;
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(delay);
                let throttle = app.state::<StoreChangedThrottle>();
                {
                    let mut st = throttle.0.lock().unwrap_or_else(|e| e.into_inner());
                    st.trailing = false;
                    st.last_emit = Some(Instant::now());
                }
                dispatch(&app);
            });
        }
        _ => {
            st.last_emit = Some(now);
            drop(st);
            dispatch(app);
        }
    }
}

/// MCP HTTP handlers run on the Tokio runtime; on Linux/WebKitGTK, delivering the
/// JS event must be scheduled on the GTK main thread or the open window may not
/// reload even though persistence succeeded.
fn dispatch<R: Runtime>(app: &AppHandle<R>) {
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
        atomic::{AtomicBool, AtomicUsize, Ordering},
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

    /// A burst of writes (e.g. 4 concurrent MCP writers) must not turn into one
    /// full-document reload per write: one event at once, then one trailing event
    /// that covers the rest of the burst.
    #[test]
    fn burst_of_changes_is_coalesced_with_trailing_event() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        let heard = Arc::new(AtomicUsize::new(0));
        let heard2 = heard.clone();
        app.listen(STORE_CHANGED, move |_| {
            heard2.fetch_add(1, Ordering::SeqCst);
        });
        let handle = app.handle().clone();
        let writers: Vec<_> = (0..4)
            .map(|_| {
                let handle = handle.clone();
                std::thread::spawn(move || {
                    for _ in 0..50 {
                        emit_store_changed(&handle);
                    }
                })
            })
            .collect();
        for w in writers {
            w.join().unwrap();
        }
        assert_eq!(heard.load(Ordering::SeqCst), 1, "leading event only, so far");
        std::thread::sleep(STORE_CHANGED_WINDOW * 3);
        assert_eq!(
            heard.load(Ordering::SeqCst),
            2,
            "one trailing event must follow the burst"
        );
        // Once the window has passed, the next isolated change notifies at once.
        emit_store_changed(&handle);
        assert_eq!(heard.load(Ordering::SeqCst), 3);
    }
}
