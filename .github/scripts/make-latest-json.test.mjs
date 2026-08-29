import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pickAppImageArtifact } from "./make-latest-json.mjs";

const script = resolve(".github/scripts/make-latest-json.mjs");

const VERSION = "0.26.0";
const APPIMAGE = "Pansuthong_0.26.0_amd64.AppImage";
const SIG = "Pansuthong_0.26.0_amd64.AppImage.sig";
const DEB = "Pansuthong_0.26.0_amd64.deb";
const TAR_GZ = "Pansuthong_0.26.0_amd64.AppImage.tar.gz";
const TAR_GZ_SIG = "Pansuthong_0.26.0_amd64.AppImage.tar.gz.sig";

describe("pickAppImageArtifact", () => {
  it("picks the versioned AppImage and ignores .sig and .deb (Tauri 2.11 CI layout)", () => {
    expect(pickAppImageArtifact([APPIMAGE, SIG, DEB], VERSION)).toBe(APPIMAGE);
  });

  it("prefers AppImage.tar.gz when present", () => {
    expect(
      pickAppImageArtifact([APPIMAGE, SIG, TAR_GZ, TAR_GZ_SIG, DEB], VERSION),
    ).toBe(TAR_GZ);
  });

  it("does not pick a .sig file", () => {
    expect(pickAppImageArtifact([SIG, DEB], VERSION)).toBeUndefined();
  });

  it("requires the version in the filename", () => {
    expect(
      pickAppImageArtifact(["Pansuthong_0.25.0_amd64.AppImage"], VERSION),
    ).toBeUndefined();
  });
});

function withBundleRoot(entries, fn) {
  const root = mkdtempSync(join(tmpdir(), "pansuthong-latest-"));
  try {
    const bundle = join(root, "src-tauri/target/release/bundle/appimage");
    mkdirSync(bundle, { recursive: true });
    for (const [name, contents] of Object.entries(entries)) {
      writeFileSync(join(bundle, name), contents);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("make-latest-json.mjs --fragment (linux appimage)", () => {
  it("writes a fragment from a raw AppImage + .sig", () => {
    withBundleRoot(
      {
        [APPIMAGE]: "appimage-bytes",
        [SIG]: "minisign-signature\n",
        [DEB]: "deb-bytes",
      },
      root => {
        const out = join(root, "updater-linux-x86_64.json");
        const stdout = execFileSync(
          process.execPath,
          [script, VERSION, "--fragment", out],
          {
            cwd: root,
            env: { ...process.env, TAURI_BUNDLE: "appimage" },
            encoding: "utf8",
          },
        );
        expect(stdout).toContain(APPIMAGE);
        const parsed = JSON.parse(readFileSync(out, "utf8"));
        expect(parsed["linux-x86_64"]).toEqual({
          signature: "minisign-signature",
          url: `https://github.com/puetsua/pansuthong/releases/download/${VERSION}/${encodeURIComponent(APPIMAGE)}`,
        });
      },
    );
  });

  it("points the fragment at AppImage.tar.gz when that artifact exists", () => {
    withBundleRoot(
      {
        [APPIMAGE]: "appimage-bytes",
        [SIG]: "appimage-sig",
        [TAR_GZ]: "tarball-bytes",
        [TAR_GZ_SIG]: "tarball-signature\n",
      },
      root => {
        const out = join(root, "updater-linux-x86_64.json");
        execFileSync(process.execPath, [script, VERSION, "--fragment", out], {
          cwd: root,
          env: { ...process.env, TAURI_BUNDLE: "appimage" },
        });
        const parsed = JSON.parse(readFileSync(out, "utf8"));
        expect(parsed["linux-x86_64"].url).toContain(
          encodeURIComponent(TAR_GZ),
        );
        expect(parsed["linux-x86_64"].signature).toBe("tarball-signature");
      },
    );
  });
});
