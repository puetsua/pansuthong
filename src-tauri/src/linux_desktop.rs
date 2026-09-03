//! Linux desktop window integration.
//!
//! # Titlebar drag (#191)
//!
//! Tauri's injected `drag.js` calls `start_dragging` over IPC on `mousedown`. On
//! Linux that round-trip often completes after a quick grab ends, so
//! `begin_move_drag` never runs for short/fast drags. Hook the WebKitGTK widget
//! directly and call `begin_move_drag` synchronously on native button-press.
//!
//! Manual regression:
//! 1. Open Pansuthong Dev with a custom titlebar.
//! 2. Press the drag region and move ~60 px quickly — the window should follow.
//! 3. Double-click the drag region — maximize/restore toggles; control buttons still work.
//!
//! # Taskbar identity (#192)
//!
//! Distinct dev/production taskbar entries rely on `enableGTKAppId: true` in
//! `tauri.conf.json` (see `install` below). Manual regression:
//! 1. Run dev (`target/debug/pansuthong` + `tauri.dev.conf.json`) and production
//!    (`target/release/pansuthong`) together.
//! 2. The taskbar/pager shows separate entries (not one shared "Pansuthong" button).

use gtk::glib::Propagation;
use gtk::prelude::*;
use tauri::WebviewWindow;

/// Matches `.desktop-titlebar` height in `src/styles/global.css`.
pub const TITLEBAR_HEIGHT_PX: f64 = 32.0;
/// Three `.desktop-titlebar-btn` controls at 46px each.
pub const CONTROLS_WIDTH_PX: f64 = 138.0;

/// Returns true when `(x, y)` is in the draggable titlebar strip, excluding controls.
pub fn is_titlebar_drag_zone(x: f64, y: f64, window_width: f64) -> bool {
    (0.0..TITLEBAR_HEIGHT_PX).contains(&y)
        && (0.0..window_width - CONTROLS_WIDTH_PX).contains(&x)
}

/// Install synchronous GTK titlebar drag on the main webview (Linux only).
pub fn install_titlebar_drag(window: &WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|platform_webview| {
        let webview = platform_webview.inner();
        webview.connect_button_press_event(|webview, event| {
            if event.button() != 1 {
                return Propagation::Proceed;
            }

            let Some(gtk_window) = webview
                .toplevel()
                .and_then(|top| top.downcast::<gtk::ApplicationWindow>().ok())
            else {
                return Propagation::Proceed;
            };

            let (x, y) = event.position();
            let width = gtk_window.allocation().width() as f64;
            if !is_titlebar_drag_zone(x, y, width) {
                return Propagation::Proceed;
            }

            if event.click_count().unwrap_or(1) >= 2 {
                if gtk_window.is_maximized() {
                    gtk_window.unmaximize();
                } else {
                    gtk_window.maximize();
                }
                return Propagation::Proceed;
            }

            gtk_window.begin_move_drag(1, x as i32, y as i32, event.time());
            Propagation::Proceed
        });
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    #[test]
    fn titlebar_drag_zone_excludes_controls_and_below_bar() {
        let width = 900.0;
        assert!(is_titlebar_drag_zone(10.0, 10.0, width));
        assert!(is_titlebar_drag_zone(width - CONTROLS_WIDTH_PX - 1.0, 0.0, width));
        assert!(!is_titlebar_drag_zone(width - CONTROLS_WIDTH_PX, 0.0, width));
        assert!(!is_titlebar_drag_zone(0.0, TITLEBAR_HEIGHT_PX, width));
    }

    #[test]
    fn tauri_config_enables_gtk_app_id() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let text = fs::read_to_string(path).expect("read tauri.conf.json");
        let json: serde_json::Value = serde_json::from_str(&text).expect("parse tauri.conf.json");
        assert_eq!(
            json.get("app")
                .and_then(|app| app.get("enableGTKAppId"))
                .and_then(serde_json::Value::as_bool),
            Some(true),
            "enableGTKAppId must be true for distinct dev/production Linux taskbar entries (#192)"
        );
    }
}
