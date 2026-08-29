// Build the Tauri updater manifest (latest.json) from signed desktop artifacts.
//
// `tauri build` (with bundle.createUpdaterArtifacts) emits the installer/AppImage
// and a detached minisign signature (`<file>.sig`) but NOT the manifest the
// updater fetches — this assembles it. The app polls the stable URL
// .../releases/latest/download/latest.json (see tauri.conf.json), and each
// platform entry points at the per-tag download URL.
//
// Linux: Tauri 2.11.x on CI emits `*.AppImage` + `*.AppImage.sig`. Older
// tooling may instead emit `*.AppImage.tar.gz` (+ `.sig`). Prefer the tarball
// when present so a future Tauri that ships it keeps working.
//
// Usage:
//   node make-latest-json.mjs <version>
//     One platform, write latest.json (legacy single-platform path).
//     env TAURI_TARGET  — rustc triple; omit for a native host build
//     env TAURI_BUNDLE  — nsis | appimage (default: nsis when TAURI_TARGET
//                         looks like Windows, otherwise appimage)
//   node make-latest-json.mjs <version> --fragment <file>
//     Write `{ "<platform>": { signature, url } }` so a later merge can combine
//     Windows + Linux jobs into one latest.json.
//   node make-latest-json.mjs <version> --merge <dir>
//     Read every *.json fragment in <dir> and write latest.json.
//     env NOTES — release notes to surface in the in-app prompt (optional)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "puetsua/pansuthong";

export function pickNsisArtifact(files, version) {
  return files.find(f => f.endsWith("-setup.exe") && f.includes(version));
}

// Prefer `*.AppImage.tar.gz` when Tauri emits it; otherwise the versioned
// `*.AppImage`. Never pick the detached `.sig` (or a `.deb` sitting nearby).
export function pickAppImageArtifact(files, version) {
  const tarGz = files.find(
    f => f.endsWith(".AppImage.tar.gz") && f.includes(version) && !f.endsWith(".sig"),
  );
  if (tarGz) return tarGz;
  return files.find(
    f => f.endsWith(".AppImage") && f.includes(version) && !f.endsWith(".sig"),
  );
}

const BUNDLES = {
  nsis: {
    dir: "nsis",
    platform: "windows-x86_64",
    pick: pickNsisArtifact,
  },
  appimage: {
    dir: "appimage",
    platform: "linux-x86_64",
    pick: pickAppImageArtifact,
  },
};

function defaultBundle() {
  const target = process.env.TAURI_TARGET ?? "";
  if (process.env.TAURI_BUNDLE) return process.env.TAURI_BUNDLE;
  if (target.includes("windows")) return "nsis";
  if (target) return "appimage";
  // Legacy default: Windows cross-target when neither env is set.
  return "nsis";
}

function mergeFragments(version, dir) {
  if (!dir) {
    console.error("--merge requires a directory of fragment JSON files");
    process.exit(1);
  }
  const platforms = {};
  const files = readdirSync(dir).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error(`no .json fragments in ${dir}`);
    process.exit(1);
  }
  for (const f of files) {
    const parsed = JSON.parse(readFileSync(join(dir, f), "utf8"));
    Object.assign(platforms, parsed);
  }
  const manifest = {
    version,
    notes: process.env.NOTES ?? "",
    pub_date: new Date().toISOString(),
    platforms,
  };
  writeFileSync("latest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `wrote latest.json for ${version} platforms: ${Object.keys(platforms).join(", ")}`,
  );
}

function writePlatformManifest(version, argv) {
  const fragmentIdx = argv.indexOf("--fragment");
  const bundleName = defaultBundle();
  const spec = BUNDLES[bundleName];
  if (!spec) {
    console.error(`unknown TAURI_BUNDLE=${bundleName} (expected nsis|appimage)`);
    process.exit(1);
  }

  const target =
    process.env.TAURI_TARGET ??
    (bundleName === "nsis" ? "x86_64-pc-windows-gnu" : "");
  const bundleRoot = target
    ? `src-tauri/target/${target}/release/bundle/${spec.dir}`
    : `src-tauri/target/release/bundle/${spec.dir}`;

  let files;
  try {
    files = readdirSync(bundleRoot);
  } catch (err) {
    console.error(`cannot read ${bundleRoot}: ${err.message}`);
    process.exit(1);
  }

  const artifact = spec.pick(files, version);
  if (!artifact) {
    console.error(`no ${spec.dir} artifact for ${version} found in ${bundleRoot}`);
    process.exit(1);
  }
  const sigFile = files.find(f => f === `${artifact}.sig`);
  if (!sigFile) {
    console.error(`no signature (${artifact}.sig) found — is createUpdaterArtifacts on?`);
    process.exit(1);
  }

  const signature = readFileSync(`${bundleRoot}/${sigFile}`, "utf8").trim();
  const url = `https://github.com/${REPO}/releases/download/${version}/${encodeURIComponent(artifact)}`;
  const entry = { [spec.platform]: { signature, url } };

  if (fragmentIdx !== -1) {
    const out = argv[fragmentIdx + 1];
    if (!out) {
      console.error("--fragment requires an output path");
      process.exit(1);
    }
    writeFileSync(out, JSON.stringify(entry, null, 2) + "\n");
    console.log(`wrote fragment ${out} for ${version} -> ${artifact}`);
    return;
  }

  const manifest = {
    version,
    notes: process.env.NOTES ?? "",
    pub_date: new Date().toISOString(),
    platforms: entry,
  };
  writeFileSync("latest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote latest.json for ${version} -> ${artifact}`);
}

export function main(argv = process.argv) {
  const version = argv[2];
  if (!version) {
    console.error(
      "usage: make-latest-json.mjs <version> [--fragment <file> | --merge <dir>]",
    );
    process.exit(1);
  }

  const mergeIdx = argv.indexOf("--merge");
  if (mergeIdx !== -1) {
    mergeFragments(version, argv[mergeIdx + 1]);
    return;
  }
  writePlatformManifest(version, argv);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main();
}
