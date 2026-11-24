//! Desktop background mode (#252): tray icon, close-to-tray, launch at login,
//! and a Rust-driven tick that keeps reminders firing while the window is hidden.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Wry};

/// Passed by the login entry so the app can start hidden in the tray.
pub const AUTOSTART_ARG: &str = "--autostart";
/// Emitted to the main window when a close hid it to the tray.
pub const HIDDEN_TO_TRAY_EVENT: &str = "main-hidden-to-tray";
/// Emitted while the main window is hidden or minimized. Webviews throttle
/// hidden timers (WebView2 down to about once a minute), so this drives the
/// scheduled-task poll from Rust instead.
pub const BACKGROUND_TICK_EVENT: &str = "background-tick";

const TRAY_ID: &str = "main";
const MENU_SHOW: &str = "tray-show";
const MENU_QUIT: &str = "tray-quit";
const TICK_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct BackgroundState {
    tray_available: AtomicBool,
    /// Started by the login entry with a working tray: keep the window hidden
    /// until the user opens it from the tray or launches the app again.
    start_hidden: AtomicBool,
    /// The frontend has reported its first painted frame (`show_main_window`).
    first_frame_seen: AtomicBool,
    menu_items: Mutex<Option<(MenuItem<Wry>, MenuItem<Wry>)>>,
}

impl BackgroundState {
    pub fn tray_available(&self) -> bool {
        self.tray_available.load(Ordering::SeqCst)
    }

    pub fn first_frame_seen(&self) -> bool {
        self.first_frame_seen.load(Ordering::SeqCst)
    }
}

/// Create the tray, decide whether this launch starts hidden, re-register the
/// login entry, and start the background tick. Call once from `setup`.
pub fn setup(app: &AppHandle, launch_at_login: bool) {
    let state = app.state::<BackgroundState>();
    match build_tray(app) {
        Ok(items) => {
            *state.menu_items.lock().unwrap() = Some(items);
            state.tray_available.store(true, Ordering::SeqCst);
        }
        Err(e) => eprintln!("warning: tray icon unavailable; closing the window quits: {e}"),
    }
    let autostarted = std::env::args().any(|a| a == AUTOSTART_ARG);
    state
        .start_hidden
        .store(autostarted && state.tray_available(), Ordering::SeqCst);

    // Rewrite the entry so it follows the current executable (an AppImage that
    // moved, or a reinstall to a new folder). Only while the OS still has it
    // enabled: a user who turned it off in Task Manager / their desktop's
    // startup settings keeps it off.
    if launch_at_login {
        if let Err(e) = refresh_launch_at_login(app) {
            eprintln!("warning: refreshing the launch-at-login entry failed: {e}");
        }
    }

    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(TICK_INTERVAL);
        if let Some(win) = handle.get_webview_window("main") {
            let hidden = !win.is_visible().unwrap_or(true) || win.is_minimized().unwrap_or(false);
            if hidden {
                let _ = win.emit(BACKGROUND_TICK_EVENT, ());
            }
        }
    });
}

fn build_tray(app: &AppHandle) -> Result<(MenuItem<Wry>, MenuItem<Wry>), String> {
    #[cfg(target_os = "linux")]
    if !linux_tray_library_present() {
        return Err("libayatana-appindicator3 / libappindicator3 not found".into());
    }
    let build = || -> tauri::Result<(MenuItem<Wry>, MenuItem<Wry>)> {
        // English defaults until the frontend sends translated labels.
        let show = MenuItem::with_id(app, MENU_SHOW, "Show", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &quit])?;
        let tooltip = app
            .config()
            .product_name
            .clone()
            .unwrap_or_else(|| app.package_info().name.clone());
        let mut builder = TrayIconBuilder::with_id(TRAY_ID)
            .menu(&menu)
            .show_menu_on_left_click(false)
            .tooltip(tooltip)
            .on_menu_event(|app, event| match event.id().as_ref() {
                MENU_SHOW => show_main_window(app),
                MENU_QUIT => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main_window(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        builder.build(app)?;
        Ok((show, quit))
    };
    // tray-icon panics instead of erroring when the appindicator library is
    // missing; keep that from taking the whole app down.
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(build)) {
        Ok(result) => result.map_err(|e| e.to_string()),
        Err(_) => Err("tray icon creation panicked".into()),
    }
}

/// tray-icon dlopens these names (libappindicator-sys) and panics if none load.
#[cfg(target_os = "linux")]
fn linux_tray_library_present() -> bool {
    [
        "libayatana-appindicator3.so.1",
        "libappindicator3.so.1",
        "libayatana-appindicator3.so",
        "libappindicator3.so",
    ]
    .iter()
    .any(|name| unsafe { libloading::Library::new(name) }.is_ok())
}

/// Restore, show, and focus the main window (tray, second launch).
pub fn show_main_window(app: &AppHandle) {
    if let Some(state) = app.try_state::<BackgroundState>() {
        state.start_hidden.store(false, Ordering::SeqCst);
    }
    crate::focus_existing_main_window(app);
}

/// Called when the frontend has painted its first frame. Returns true when the
/// window must stay hidden because this launch came from the login entry.
pub fn on_first_frame(window: &WebviewWindow) -> bool {
    let Some(state) = window.try_state::<BackgroundState>() else {
        return false;
    };
    state.first_frame_seen.store(true, Ordering::SeqCst);
    if !state.start_hidden.load(Ordering::SeqCst) {
        return false;
    }
    // Linux maps the window at startup so WebKitGTK runs the frontend (#167);
    // hide it again now that the page is live.
    if let Err(e) = window.hide() {
        eprintln!("warning: hiding autostarted window failed: {e}");
    }
    true
}

/// Close-button / Alt+F4 handling: hide to the tray when enabled and a tray
/// exists. Returns true when the close was turned into a hide.
pub fn hide_on_close(window: &tauri::Window) -> bool {
    if window.label() != "main" {
        return false;
    }
    let app = window.app_handle();
    let tray = app
        .try_state::<BackgroundState>()
        .is_some_and(|s| s.tray_available());
    let enabled = app
        .try_state::<crate::config::ConfigState>()
        .is_some_and(|c| c.settings().close_to_tray);
    if !(tray && enabled) {
        return false;
    }
    if let Err(e) = window.hide() {
        eprintln!("warning: hide to tray failed; closing instead: {e}");
        return false;
    }
    let _ = window.emit(HIDDEN_TO_TRAY_EVENT, ());
    true
}

/// Set the tray menu text in the UI language.
pub fn set_tray_labels(app: &AppHandle, show: &str, quit: &str) -> Result<(), String> {
    let state = app.state::<BackgroundState>();
    let items = state.menu_items.lock().unwrap();
    let Some((show_item, quit_item)) = items.as_ref() else {
        return Ok(());
    };
    show_item.set_text(show).map_err(|e| e.to_string())?;
    quit_item.set_text(quit).map_err(|e| e.to_string())
}

fn auto_launcher(app: &AppHandle) -> Result<auto_launch::AutoLaunch, String> {
    // Product name keeps dev ("Pansuthong Dev") and production entries apart.
    let name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| app.package_info().name.clone());
    #[cfg(target_os = "linux")]
    let exe = match app.env().appimage {
        Some(appimage) => appimage,
        None => std::env::current_exe().map_err(|e| e.to_string())?,
    };
    #[cfg(not(target_os = "linux"))]
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // auto-launch writes `{path} {args}` verbatim; quote the path so one with
    // spaces stays a single argument (Windows Run value, desktop-entry Exec).
    let path = format!("\"{}\"", exe.display());
    auto_launch::AutoLaunchBuilder::new()
        .set_app_name(&name)
        .set_app_path(&path)
        .set_args(&[AUTOSTART_ARG])
        .build()
        .map_err(|e| e.to_string())
}

/// Add or remove this app's login entry.
pub fn set_launch_at_login(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = auto_launcher(app)?;
    if enabled {
        return launcher.enable().map_err(|e| e.to_string());
    }
    // Delete unconditionally: `is_enabled` reports false when Task Manager
    // disabled the entry, which would otherwise leave the value behind.
    match launcher.disable() {
        Ok(()) => Ok(()),
        Err(auto_launch::Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn refresh_launch_at_login(app: &AppHandle) -> Result<(), String> {
    let launcher = auto_launcher(app)?;
    if launcher.is_enabled().map_err(|e| e.to_string())? {
        launcher.enable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct BackgroundStatus {
    pub tray_available: bool,
}

pub fn status(app: &AppHandle) -> BackgroundStatus {
    BackgroundStatus {
        tray_available: app
            .try_state::<BackgroundState>()
            .is_some_and(|s| s.tray_available()),
    }
}
