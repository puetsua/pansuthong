/**
 * Regenerate Tauri icon assets after editing icon.svg or icon-android.svg.
 *
 * Desktop/iOS/Windows use icon.svg (full-size glyph) via icon-manifest.json.
 * Android adaptive foreground uses icon-android.svg (0.78× glyph). Tauri still
 * builds legacy ic_launcher / ic_launcher_round from the default source, so we
 * run the Android SVG once and restore the desktop icon tree from a snapshot.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tauriDir = join("src-tauri");
const manifest = "icons/icon-manifest.json";
const androidSvg = "icons/icon-android.svg";

function runTauriIcon(input) {
  const result = spawnSync("npx", ["tauri", "icon", input], {
    cwd: tauriDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const snapshotDir = mkdtempSync(join(tmpdir(), "pansuthong-icons-"));
try {
  runTauriIcon(manifest);
  cpSync(join(tauriDir, "icons"), join(snapshotDir, "icons"), { recursive: true });
  cpSync("public/app-icon.png", join(snapshotDir, "app-icon.png"));

  runTauriIcon(androidSvg);

  cpSync(join(snapshotDir, "icons"), join(tauriDir, "icons"), { recursive: true });
  cpSync(join(snapshotDir, "app-icon.png"), "public/app-icon.png");
  cpSync(join(tauriDir, "icons", "32x32.png"), "public/app-icon.png");
} finally {
  rmSync(snapshotDir, { recursive: true, force: true });
}
