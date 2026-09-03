use tauri::{command, AppHandle, Runtime};

use crate::check::check_for_update;
use crate::download::{download_apk, install_apk};
use crate::error::PluginConfig;
use crate::models::UpdateInfo;

fn plugin_config<R: Runtime>(app: &AppHandle<R>) -> PluginConfig {
    app.config()
        .plugins
        .0
        .get("androidUpdater")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

fn http_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .user_agent("Pansuthong-Android-Updater")
        .build()
        .new_agent()
}

#[command]
pub async fn check(app: AppHandle<impl Runtime>) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();
    let identifier = app.config().identifier.clone();
    let cfg = plugin_config(&app);
    let agent = http_agent();

    check_for_update(&agent, &current, &identifier, cfg.dev_endpoint())
        .map_err(|e| e.to_string())
}

#[command]
pub async fn download_and_install(
    app: AppHandle<impl Runtime>,
    download_url: String,
) -> Result<(), String> {
    let agent = http_agent();
    let cache = app.path().cache_dir().map_err(|e| e.to_string())?;
    let dest = cache.join("pansuthong-update.apk");
    let app2 = app.clone();

    tokio::task::spawn_blocking(move || {
        download_apk(&agent, &download_url, &dest, &app2).map_err(|e| e.to_string())?;
        install_apk(&app2, dest).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
