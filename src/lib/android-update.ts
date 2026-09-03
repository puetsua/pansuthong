/**
 * Pure helpers for Android update manifest resolution and version compare.
 * Mirrored in `src-tauri/plugins/android-updater/src/version.rs` for Rust checks.
 */

export const PRODUCTION_APP_ID = "net.puetsua.pansuthong";
export const GITHUB_RELEASES_API =
  "https://api.github.com/repos/puetsua/pansuthong/releases/latest";

export type GhReleaseAsset = { name: string; browser_download_url: string };
export type GhRelease = {
  tag_name: string;
  body?: string | null;
  assets: GhReleaseAsset[];
};

export type DevManifest = {
  version: string;
  notes?: string | null;
  url: string;
};

/** True when `name` is the production universal APK, not a minisign sidecar. */
export function isUniversalApkAsset(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".apk") &&
    !lower.endsWith(".apk.sig") &&
    lower.includes("_universal.apk")
  );
}

export function pickUniversalApkAsset(
  assets: GhReleaseAsset[],
): GhReleaseAsset | null {
  return assets.find(a => isUniversalApkAsset(a.name)) ?? null;
}

export function compareVersions(
  current: string,
  remote: string,
): -1 | 0 | 1 {
  const parse = (v: string): [number[], string | null] => {
    const trimmed = v.replace(/^v/, "");
    const [core, pre = ""] = trimmed.split("-");
    const nums = core.split(".").map(p => Number.parseInt(p, 10) || 0);
    return [nums, pre || null];
  };

  const [curNums, curPre] = parse(current);
  const [remNums, remPre] = parse(remote);
  const len = Math.max(curNums.length, remNums.length);

  for (let i = 0; i < len; i++) {
    const c = curNums[i] ?? 0;
    const r = remNums[i] ?? 0;
    if (c < r) return -1;
    if (c > r) return 1;
  }

  if (curPre === null && remPre === null) return 0;
  if (curPre !== null && remPre === null) return -1;
  if (curPre === null && remPre !== null) return 1;
  return curPre! < remPre! ? -1 : curPre! > remPre! ? 1 : 0;
}

export function isVersionNewer(current: string, remote: string): boolean {
  return compareVersions(current, remote) < 0;
}

export function resolveUpdateSource(
  appId: string,
  devEndpoint: string | null,
): "github" | "dev" | "none" {
  if (appId === PRODUCTION_APP_ID) return "github";
  if (devEndpoint) return "dev";
  return "none";
}

export function updateInfoFromGithubRelease(
  release: GhRelease,
  currentVersion: string,
): { version: string; body: string | null; downloadUrl: string } | null {
  const asset = pickUniversalApkAsset(release.assets);
  if (!asset) return null;
  const version = release.tag_name.replace(/^v/, "");
  if (!isVersionNewer(currentVersion, version)) return null;
  return {
    version,
    body: release.body ?? null,
    downloadUrl: asset.browser_download_url,
  };
}

export function updateInfoFromDevManifest(
  manifest: DevManifest,
  currentVersion: string,
): { version: string; body: string | null; downloadUrl: string } | null {
  const lower = manifest.url.toLowerCase();
  if (!lower.endsWith(".apk") || lower.endsWith(".apk.sig")) return null;
  if (!isVersionNewer(currentVersion, manifest.version)) return null;
  return {
    version: manifest.version,
    body: manifest.notes ?? null,
    downloadUrl: manifest.url,
  };
}
