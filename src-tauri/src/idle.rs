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
    use x11_dl::xlib::{self, Display};
    use x11_dl::xss;

    pub fn session_idle_ms() -> Option<u64> {
        let xlib = xlib::Xlib::open().ok()?;
        let xss = xss::Xss::open().ok()?;
        // SAFETY: `xlib`/`xss` were opened; we close any display we open.
        unsafe {
            let display = (xlib.XOpenDisplay)(ptr::null::<c_char>());
            if display.is_null() {
                return None;
            }
            let idle = query_idle(&xlib, &xss, display);
            (xlib.XCloseDisplay)(display);
            idle
        }
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
        let status = (xss.XScreenSaverQueryInfo)(display, root, info);
        let idle = if status != 0 {
            Some((*info).idle as u64)
        } else {
            None
        };
        (xlib.XFree)(info as *mut c_void);
        idle
    }
}
