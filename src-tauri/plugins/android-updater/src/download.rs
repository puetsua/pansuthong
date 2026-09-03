use crate::error::{Error, Result};
use crate::models::DownloadProgress;
use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Runtime};
use ureq::Agent;

pub fn download_apk(
    agent: &Agent,
    url: &str,
    dest: &PathBuf,
    app: &AppHandle<impl Runtime>,
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
pub fn install_apk(app: &AppHandle<impl Runtime>, path: PathBuf) -> Result<()> {
    use tauri_plugin_android_installer::{AndroidInstallerExt, InstallRequest};

    let installer = app.android_installer();
    if !installer.can_install()? {
        installer.request_install_permission()?;
        if !installer.can_install()? {
            return Err(Error::Msg(
                "install unknown apps permission not granted".into(),
            ));
        }
    }

    installer.install(InstallRequest {
        path: path.to_string_lossy().into_owned(),
    })?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn install_apk(_app: &AppHandle<impl Runtime>, _path: PathBuf) -> Result<()> {
    Err(Error::Msg("only supported on Android".into()))
}
