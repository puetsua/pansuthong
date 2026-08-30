//! Milliseconds since the last OS keyboard/mouse input.
//!
//! Used to detect AFK while a timer is running. Android (and any platform
//! without a last-input API) returns `None` so the frontend never prompts.

/// Time since last keyboard/mouse input, or `None` when it cannot be read.
pub fn session_idle_ms() -> Option<u64> {
    #[cfg(windows)]
    {
        windows::session_idle_ms()
    }
    #[cfg(target_os = "linux")]
    {
        linux::session_idle_ms()
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        None
    }
}

#[cfg(windows)]
mod windows {
    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
    }

    pub fn session_idle_ms() -> Option<u64> {
        let mut info = LastInputInfo {
            cb_size: std::mem::size_of::<LastInputInfo>() as u32,
            dw_time: 0,
        };
        // wrapping_sub: GetTickCount is 32-bit and wraps ~49 days.
        // SAFETY: `cb_size` is set to sizeof(LASTINPUTINFO); both FFI functions
        // are the Win32 APIs and `info` is a valid stack value for the out-param.
        unsafe {
            if GetLastInputInfo(&mut info) == 0 {
                return None;
            }
            Some(GetTickCount().wrapping_sub(info.dw_time) as u64)
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::os::raw::{c_char, c_int, c_void};
    use std::ptr;
    use std::sync::Mutex;
    use x11_dl::xlib::{self, Display};
    use x11_dl::xss;

    struct X11 {
        xlib: xlib::Xlib,
        xss: xss::Xss,
        display: *mut Display,
    }

    // Queries are serialized through `CONN`; Xlib is not used off this mutex.
    unsafe impl Send for X11 {}

    static CONN: Mutex<Option<X11>> = Mutex::new(None);
    static OPENED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    pub fn session_idle_ms() -> Option<u64> {
        use std::sync::atomic::Ordering::Relaxed;
        let mut g = CONN.lock().ok()?;
        if !OPENED.load(Relaxed) {
            *g = open();
            OPENED.store(true, Relaxed);
        }
        let x11 = g.as_ref()?;
        // SAFETY: `display` was opened with this `xlib` and is only used under `CONN`.
        unsafe { query_idle(&x11.xlib, &x11.xss, x11.display) }
    }

    fn open() -> Option<X11> {
        let xlib = xlib::Xlib::open().ok()?;
        let xss = xss::Xss::open().ok()?;
        // SAFETY: null display name is the default display; we keep the handle
        // for process lifetime and only use it under `CONN`.
        let display = unsafe { (xlib.XOpenDisplay)(ptr::null::<c_char>()) };
        if display.is_null() {
            return None;
        }
        Some(X11 { xlib, xss, display })
    }

    /// # Safety
    /// `display` must be a live `XOpenDisplay` handle from `xlib`.
    unsafe fn query_idle(
        xlib: &xlib::Xlib,
        xss: &xss::Xss,
        display: *mut Display,
    ) -> Option<u64> {
        let mut event_base: c_int = 0;
        let mut error_base: c_int = 0;
        if (xss.XScreenSaverQueryExtension)(display, &mut event_base, &mut error_base) == 0 {
            return None;
        }
        let info = (xss.XScreenSaverAllocInfo)();
        if info.is_null() {
            return None;
        }
        let root = (xlib.XDefaultRootWindow)(display);
        let status = (xss.XScreenSaverQueryInfo)(display, root as xlib::Drawable, info);
        let idle = if status != 0 {
            u64::try_from((*info).idle).ok()
        } else {
            None
        };
        (xlib.XFree)(info as *mut c_void);
        idle
    }
}
