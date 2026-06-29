// Build the Tauri updater manifest (latest.json) from the signed NSIS installer.
//
// `tauri build` (with bundle.createUpdaterArtifacts) emits the installer and a
// detached minisign signature (`<installer>.sig`) but NOT the manifest the
// updater fetches — this assembles it. The app polls the stable URL
// .../releases/latest/download/latest.json (see tauri.conf.json), and each
// platform entry points at the per-tag installer download URL.
//
// Usage: node make-latest-json.mjs <version>
//   env NOTES — release notes to surface in the in-app prompt (optional)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const REPO = "puetsua/pansutong";

const version = process.argv[2];
if (!version) {
  console.error("usage: make-latest-json.mjs <version>");
  process.exit(1);
}

// The installer is built with `--target <triple>` (see release.yml), so its
// bundle lands under `target/<triple>/release`, NOT the default `target/release`.
// Reading the wrong dir would fail the release — or, worse, pick a stale installer
// from an earlier non-targeted build whose signature wouldn't match. Honor the
// same triple the build/publish steps use, defaulting to the Windows cross target.
const target = process.env.TAURI_TARGET ?? "x86_64-pc-windows-gnu";
const nsisDir = `src-tauri/target/${target}/release/bundle/nsis`;
const files = readdirSync(nsisDir);

// The updater package for NSIS is the -setup.exe; its signature sits beside it.
// Match the installer for THIS version so a stale artifact from an earlier build
// in the same directory can't be picked by mistake.
const installer = files.find(f => f.endsWith("-setup.exe") && f.includes(version));
if (!installer) {
  console.error(`no *-setup.exe for ${version} found in ${nsisDir}`);
  process.exit(1);
}
const sigFile = files.find(f => f === `${installer}.sig`);
if (!sigFile) {
  console.error(`no signature (${installer}.sig) found — is createUpdaterArtifacts on?`);
  process.exit(1);
}

const signature = readFileSync(`${nsisDir}/${sigFile}`, "utf8").trim();
const url = `https://github.com/${REPO}/releases/download/${version}/${encodeURIComponent(installer)}`;

const manifest = {
  version,
  notes: process.env.NOTES ?? "",
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": { signature, url },
  },
};

writeFileSync("latest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote latest.json for ${version} -> ${installer}`);
