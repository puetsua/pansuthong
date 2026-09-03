use crate::error::{Error, Result};
use crate::models::{DevManifest, UpdateInfo};
use crate::version::{is_universal_apk_asset, is_version_newer};
use serde::Deserialize;
use ureq::Agent;

const GITHUB_REPO: &str = "puetsua/pansuthong";
const PROD_ID: &str = "net.puetsua.pansuthong";

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

pub fn check_for_update(
    agent: &Agent,
    current_version: &str,
    app_identifier: &str,
    dev_endpoint: Option<&str>,
) -> Result<Option<UpdateInfo>> {
    let info = if app_identifier == PROD_ID {
        check_github(agent)?
    } else if let Some(url) = dev_endpoint {
        check_dev_manifest(agent, url)?
    } else {
        return Ok(None);
    };

    if is_version_newer(current_version, &info.version) {
        Ok(Some(info))
    } else {
        Ok(None)
    }
}

fn check_github(agent: &Agent) -> Result<UpdateInfo> {
    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    let release: GhRelease = agent
        .get(&url)
        .set("User-Agent", "Pansuthong-Android-Updater")
        .call()?
        .into_json()?;

    let asset = release
        .assets
        .iter()
        .find(|a| is_universal_apk_asset(&a.name))
        .ok_or_else(|| Error::Msg("no universal APK on latest release".into()))?;

    Ok(UpdateInfo {
        version: release.tag_name.trim_start_matches('v').to_string(),
        body: release.body,
        download_url: asset.browser_download_url.clone(),
    })
}

fn check_dev_manifest(agent: &Agent, manifest_url: &str) -> Result<UpdateInfo> {
    let manifest: DevManifest = agent.get(manifest_url).call()?.into_json()?;

    if !manifest.url.to_ascii_lowercase().ends_with(".apk")
        || manifest.url.to_ascii_lowercase().ends_with(".apk.sig")
    {
        return Err(Error::Msg("dev manifest url is not an APK".into()));
    }

    Ok(UpdateInfo {
        version: manifest.version,
        body: manifest.notes,
        download_url: manifest.url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prod_uses_github_not_dev() {
        assert_eq!(PROD_ID, "net.puetsua.pansuthong");
    }
}
