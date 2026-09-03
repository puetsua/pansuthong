use tauri::{command, AppHandle, Manager, Runtime};

use crate::check::check_for_update;
use crate::download::{download_apk, install_apk};
use crate::error::PluginConfig;
use crate::models::{UpdateInfo, UpdateResponse};
use crate::state::PendingUpdate;
use crate::version::is_apk_download_url;

fn plugin_config<R: Runtime>(app: &AppHandle<R>) -> PluginConfig {
    app.config()
        .plugins
        .0
        .get("androidUpdater")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .user_agent("Pansuthong-Android-Updater")
        .build()
}

fn store_pending<R: Runtime>(app: &AppHandle<R>, info: Option<UpdateInfo>) {
    *app.state::<PendingUpdate>().0.lock().unwrap() = info;
}

#[command]
pub async fn check(app: AppHandle<impl Runtime>) -> Result<Option<UpdateResponse>, String> {
    let current = app.package_info().version.to_string();
    let identifier = app.config().identifier.clone();
    let cfg = plugin_config(&app);
    let agent = http_agent();
    let app2 = app.clone();

    let pending = tokio::task::spawn_blocking(move || {
        check_for_update(&agent, &current, &identifier, cfg.dev_endpoint())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    store_pending(&app2, pending.clone());
    Ok(pending.map(UpdateResponse::from))
}

#[command]
pub async fn download_and_install(app: AppHandle<impl Runtime>) -> Result<(), String> {
    let info = app
        .state::<PendingUpdate>()
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no pending update".to_string())?;

    if !is_apk_download_url(&info.download_url) {
        return Err("pending update url is not an APK".into());
    }

    let agent = http_agent();
    let cache = app.path().cache_dir().map_err(|e| e.to_string())?;
    let dest = cache.join("pansuthong-update.apk");
    let download_url = info.download_url;
    let app2 = app.clone();

    tokio::task::spawn_blocking(move || {
        download_apk(&agent, &download_url, &dest, &app2)?;
        install_apk(&app2, dest)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
