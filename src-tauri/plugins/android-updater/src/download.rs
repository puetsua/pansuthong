use crate::error::{Error, Result};
use crate::models::DownloadProgress;
use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};
use ureq::Agent;

const INSTALL_PERMISSION_HINT: &str =
    "Allow Pansuthong to install unknown apps in Settings, then tap Update again";

pub fn download_apk<R: Runtime>(
    agent: &Agent,
    url: &str,
    dest: &PathBuf,
    app: &AppHandle<R>,
) -> Result<()> {
    let response = agent.get(url).call()?;
    let total = response.header("Content-Length").and_then(|h| h.parse().ok());
    let mut reader = response.into_reader();
    let mut file = File::create(dest)?;
    let mut buf = [0u8; 8192];
    let mut downloaded: u64 = 0;

    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        downloaded += n as u64;
        let _ = app.emit(
            "android-updater://progress",
            DownloadProgress {
                downloaded,
                total,
            },
        );
    }

    Ok(())
}

#[cfg(target_os = "android")]
fn ensure_can_install<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    use tauri_plugin_android_installer::AndroidInstallerExt;

    let installer = app.android_installer();
    if installer.can_install()? {
        return Ok(());
    }

    // Opens Settings; the plugin resolves when the user returns, but the OS may
    // not have updated can_install yet — poll briefly before giving up.
    installer.request_install_permission()?;
    for _ in 0..40 {
        if installer.can_install()? {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }

    if installer.can_install()? {
        Ok(())
    } else {
        Err(Error::Msg(INSTALL_PERMISSION_HINT.into()))
    }
}

#[cfg(target_os = "android")]
pub fn install_apk<R: Runtime>(app: &AppHandle<R>, path: PathBuf) -> Result<()> {
    use tauri_plugin_android_installer::{AndroidInstallerExt, InstallRequest};

    ensure_can_install(app)?;

    app.android_installer().install(InstallRequest {
        path: path.to_string_lossy().into_owned(),
    })?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn install_apk<R: Runtime>(_app: &AppHandle<R>, _path: PathBuf) -> Result<()> {
    Err(Error::Msg("only supported on Android".into()))
}
