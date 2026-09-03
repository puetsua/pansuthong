import { describe, it, expect } from "vitest";
import {
  compareVersions,
  isUniversalApkAsset,
  isVersionNewer,
  pickUniversalApkAsset,
  resolveUpdateSource,
  updateInfoFromDevManifest,
  updateInfoFromGithubRelease,
  PRODUCTION_APP_ID,
} from "./android-update";

describe("isUniversalApkAsset", () => {
  it("accepts the production universal APK", () => {
    expect(isUniversalApkAsset("Pansuthong_0.2.0_universal.apk")).toBe(true);
  });

  it("does not treat .sig as an APK", () => {
    expect(isUniversalApkAsset("Pansuthong_0.2.0_universal.apk.sig")).toBe(false);
    expect(isUniversalApkAsset("Pansuthong_0.2.0_amd64.AppImage.sig")).toBe(false);
  });
});

describe("pickUniversalApkAsset", () => {
  it("picks the universal APK and ignores sig sidecars", () => {
    const assets = [
      { name: "latest.json", browser_download_url: "https://x/latest.json" },
      { name: "Pansuthong_0.2.0_universal.apk.sig", browser_download_url: "https://x/sig" },
      { name: "Pansuthong_0.2.0_universal.apk", browser_download_url: "https://x/apk" },
    ];
    expect(pickUniversalApkAsset(assets)?.browser_download_url).toBe("https://x/apk");
  });
});

describe("isVersionNewer", () => {
  it("returns true when remote is newer", () => {
    expect(isVersionNewer("0.1.0", "0.1.1")).toBe(true);
  });

  it("returns false when already on latest", () => {
    expect(isVersionNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isVersionNewer("0.3.0", "0.2.9")).toBe(false);
  });

  it("orders prereleases below release", () => {
    expect(compareVersions("0.2.0-beta.1", "0.2.0")).toBe(-1);
    expect(isVersionNewer("0.2.0", "0.2.0-beta.1")).toBe(false);
  });
});

describe("resolveUpdateSource", () => {
  it("uses GitHub for production id", () => {
    expect(resolveUpdateSource(PRODUCTION_APP_ID, null)).toBe("github");
    expect(resolveUpdateSource(PRODUCTION_APP_ID, "http://localhost/x.json")).toBe("github");
  });

  it("uses dev manifest URL for dev id", () => {
    expect(
      resolveUpdateSource("net.puetsua.pansuthong.dev", "http://127.0.0.1:8765/android-latest.json"),
    ).toBe("dev");
  });
});

describe("updateInfoFromGithubRelease", () => {
  const release = {
    tag_name: "0.2.0",
    body: "notes",
    assets: [
      { name: "Pansuthong_0.2.0_universal.apk", browser_download_url: "https://gh/apk" },
    ],
  };

  it("returns info when newer", () => {
    expect(updateInfoFromGithubRelease(release, "0.1.0")).toEqual({
      version: "0.2.0",
      body: "notes",
      downloadUrl: "https://gh/apk",
    });
  });

  it("returns null when already latest", () => {
    expect(updateInfoFromGithubRelease(release, "0.2.0")).toBeNull();
  });
});

describe("updateInfoFromDevManifest", () => {
  const manifest = {
    version: "0.2.0",
    notes: "dev",
    url: "http://127.0.0.1:8765/Pansuthong_Dev_0.2.0_universal.apk",
  };

  it("returns info when newer", () => {
    expect(updateInfoFromDevManifest(manifest, "0.1.0")?.downloadUrl).toContain(".apk");
  });

  it("rejects sig url", () => {
    expect(
      updateInfoFromDevManifest(
        { ...manifest, url: "http://x/Pansuthong_Dev_0.2.0_universal.apk.sig" },
        "0.1.0",
      ),
    ).toBeNull();
  });

  it("returns null when already latest", () => {
    expect(updateInfoFromDevManifest(manifest, "0.2.0")).toBeNull();
  });
});
