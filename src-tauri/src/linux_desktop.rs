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
//! GTK3 maps X11 `WM_CLASS` and Wayland `xdg_toplevel` app_id from
//! `g_get_prgname()` / `gdk_get_program_class()`, not from `enableGTKAppId` alone.
//! Call [`install_desktop_identity`] at process start (before the first window is
//! realized) with the compiled Tauri `identifier`. For local dev, install
//! `linux/net.puetsua.pansuthong.dev.desktop` so the shell tooltip matches.
//!
//! Manual regression:
//! 1. Run dev (`target/debug/pansuthong` + `tauri.dev.conf.json`) and production
//!    (`target/release/pansuthong`) together.
//! 2. The taskbar/pager shows separate entries (not one shared "Pansuthong" button).

use gtk::gdk;
use gtk::glib;
use gtk::glib::Propagation;
use gtk::prelude::*;
use tauri::WebviewWindow;

/// Matches `.desktop-titlebar` height in `src/styles/global.css`.
pub const TITLEBAR_HEIGHT_PX: f64 = 32.0;
/// Three `.desktop-titlebar-btn` controls at 46px each.
pub const CONTROLS_WIDTH_PX: f64 = 138.0;

/// Production identifier from `tauri.conf.json` (emitted by `build.rs` for tests).
pub const PRODUCTION_IDENTIFIER: &str = env!("TAURI_APP_IDENTIFIER");
/// Development identifier from `tauri.dev.conf.json`.
pub const DEV_IDENTIFIER: &str = "net.puetsua.pansuthong.dev";

/// Set GLib/GDK program identity before GTK realizes any window.
///
/// Shells group windows by `WM_CLASS` (X11) and GTK3 Wayland app_id from prgname.
pub fn install_desktop_identity(identifier: &str) {
    glib::set_prgname(Some(identifier));
    gdk::set_program_class(identifier);
}

/// Assert runtime prgname/program_class match the expected identifier.
#[cfg(test)]
pub fn assert_desktop_identity(identifier: &str) {
    assert_eq!(
        glib::prgname().as_deref(),
        Some(identifier),
        "g_get_prgname() should match the compiled identifier"
    );
    assert_eq!(
        gdk::program_class().as_deref(),
        Some(identifier),
        "gdk_get_program_class() should match the compiled identifier"
    );
}

/// Button-press coordinates for titlebar drag: widget-local for hit testing,
/// root/screen for `gtk::WindowExt::begin_move_drag`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TitlebarPressCoords {
    pub local_x: f64,
    pub local_y: f64,
    pub root_x: f64,
    pub root_y: f64,
}

impl TitlebarPressCoords {
    pub fn from_event(local: (f64, f64), root: (f64, f64)) -> Self {
        Self {
            local_x: local.0,
            local_y: local.1,
            root_x: root.0,
            root_y: root.1,
        }
    }

    /// Hit test in webview-local space (matches titlebar CSS layout).
    pub fn in_drag_zone(&self, window_width: f64) -> bool {
        is_titlebar_drag_zone(self.local_x, self.local_y, window_width)
    }

    /// Root/screen coordinates required by `begin_move_drag` (not widget-local).
    pub fn begin_move_drag_roots(&self) -> (i32, i32) {
        (self.root_x.round() as i32, self.root_y.round() as i32)
    }
}

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

            let press = TitlebarPressCoords::from_event(event.position(), event.root());
            let width = gtk_window.allocation().width() as f64;
            if !press.in_drag_zone(width) {
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

            let (root_x, root_y) = press.begin_move_drag_roots();
            gtk_window.begin_move_drag(1, root_x, root_y, event.time());
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
    use std::sync::Once;

    static GTK_TEST_INIT: Once = Once::new();

    fn init_gtk_for_test() {
        GTK_TEST_INIT.call_once(|| {
            gtk::init().expect("gtk::init for linux_desktop identity tests");
        });
    }

    fn identifier_from_config(filename: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(filename);
        let text = fs::read_to_string(&path).expect("read tauri config");
        let json: serde_json::Value = serde_json::from_str(&text).expect("parse tauri config");
        json["identifier"]
            .as_str()
            .expect("identifier in tauri config")
            .to_string()
    }

    #[test]
    fn titlebar_drag_zone_excludes_controls_and_below_bar() {
        let width = 900.0;
        assert!(is_titlebar_drag_zone(10.0, 10.0, width));
        assert!(is_titlebar_drag_zone(width - CONTROLS_WIDTH_PX - 1.0, 0.0, width));
        assert!(!is_titlebar_drag_zone(width - CONTROLS_WIDTH_PX, 0.0, width));
        assert!(!is_titlebar_drag_zone(0.0, TITLEBAR_HEIGHT_PX, width));
    }

    #[test]
    fn begin_move_drag_uses_root_not_local_coords() {
        let press = TitlebarPressCoords {
            local_x: 10.0,
            local_y: 5.0,
            root_x: 250.0,
            root_y: 180.0,
        };
        assert!(press.in_drag_zone(900.0));
        let (drag_x, drag_y) = press.begin_move_drag_roots();
        assert_eq!((drag_x, drag_y), (250, 180));
        assert_ne!(
            (drag_x, drag_y),
            (press.local_x.round() as i32, press.local_y.round() as i32),
            "begin_move_drag must receive root/screen coords, not widget-local"
        );
    }

    #[test]
    fn desktop_identity_runtime_matches_production_and_dev_configs() {
        init_gtk_for_test();

        install_desktop_identity(PRODUCTION_IDENTIFIER);
        assert_desktop_identity(PRODUCTION_IDENTIFIER);

        let production = identifier_from_config("tauri.conf.json");
        let dev = identifier_from_config("tauri.dev.conf.json");
        assert_ne!(production, dev);
        assert_eq!(dev, DEV_IDENTIFIER);

        install_desktop_identity(&dev);
        assert_desktop_identity(&dev);
        assert_ne!(
            gdk::program_class().as_deref(),
            Some(production.as_str()),
            "dev program_class must not match production identifier"
        );
    }
}
