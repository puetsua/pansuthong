/// Compare `remote` against `current`. Returns true when `remote` is strictly newer.
pub fn is_version_newer(current: &str, remote: &str) -> bool {
    compare_versions(current, remote) == std::cmp::Ordering::Less
}

fn compare_versions(current: &str, remote: &str) -> std::cmp::Ordering {
    let parse = |v: &str| -> (Vec<u64>, Option<String>) {
        let trimmed = v.trim_start_matches('v');
        let (core, pre) = trimmed.split_once('-').unwrap_or((trimmed, ""));
        let nums: Vec<u64> = core
            .split('.')
            .map(|p| p.parse().unwrap_or(0))
            .collect();
        let pre = if pre.is_empty() {
            None
        } else {
            Some(pre.to_string())
        };
        (nums, pre)
    };

    let (cur_nums, cur_pre) = parse(current);
    let (rem_nums, rem_pre) = parse(remote);

    let len = cur_nums.len().max(rem_nums.len());
    for i in 0..len {
        let c = cur_nums.get(i).copied().unwrap_or(0);
        let r = rem_nums.get(i).copied().unwrap_or(0);
        match c.cmp(&r) {
            std::cmp::Ordering::Equal => {}
            other => return other,
        }
    }

    match (cur_pre, rem_pre) {
        (None, None) => std::cmp::Ordering::Equal,
        (Some(_), None) => std::cmp::Ordering::Less, // release > prerelease
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (Some(c), Some(r)) => c.as_str().cmp(r.as_str()),
    }
}

/// True when `url` points at an APK, not a minisign sidecar or other artifact.
pub fn is_apk_download_url(url: &str) -> bool {
    let path = url
        .split('?')
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .unwrap_or(url)
        .to_ascii_lowercase();
    path.ends_with(".apk") && !path.ends_with(".apk.sig")
}

/// True when `name` looks like the production universal APK (not a signature sidecar).
pub fn is_universal_apk_asset(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".apk")
        && !lower.ends_with(".apk.sig")
        && lower.contains("_universal.apk")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_patch() {
        assert!(is_version_newer("0.1.0", "0.1.1"));
        assert!(!is_version_newer("0.1.1", "0.1.0"));
    }

    #[test]
    fn equal_versions() {
        assert!(!is_version_newer("0.2.0", "0.2.0"));
    }

    #[test]
    fn prerelease_ordering() {
        assert!(is_version_newer("0.2.0-beta.1", "0.2.0"));
        assert!(!is_version_newer("0.2.0", "0.2.0-beta.1"));
    }

    #[test]
    fn rejects_sig_as_apk() {
        assert!(!is_universal_apk_asset(
            "Pansuthong_0.2.0_universal.apk.sig"
        ));
        assert!(is_universal_apk_asset("Pansuthong_0.2.0_universal.apk"));
        assert!(!is_universal_apk_asset("latest.json"));
    }

    #[test]
    fn rejects_sig_download_url() {
        assert!(!is_apk_download_url(
            "https://github.com/x/releases/download/0.2.0/Pansuthong_0.2.0_universal.apk.sig"
        ));
        assert!(is_apk_download_url(
            "https://github.com/x/releases/download/0.2.0/Pansuthong_0.2.0_universal.apk"
        ));
    }
}
