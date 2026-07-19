import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const args = process.argv.slice(2);
const hasConfig = args.some((arg) => arg === "--config" || arg.startsWith("--config="));
const isDesktopDev = args[0] === "dev";
const isAndroidDev = args[0] === "android" && args[1] === "dev";
const config = isDesktopDev
  ? "src-tauri/tauri.dev.conf.json"
  : isAndroidDev
    ? "src-tauri/tauri.android-dev.conf.json"
    : null;

const finalArgs = config && !hasConfig ? [...args, "--config", config] : args;

// gen/android serves both identifiers (prod + .dev), but tauri's build script
// only re-emits the generated Kotlin (TauriActivity.kt) when its cargo
// fingerprint invalidates — it has no rerun-if-env-changed on
// WRY_ANDROID_KOTLIN_FILES_OUT_DIR. After building one identifier, the other's
// generated tree is missing while the fingerprinted files still exist, so the
// build script never reruns and Kotlin compilation fails. Deleting the INACTIVE
// identifier's generated tree invalidates the fingerprint, forcing regeneration
// into the active tree.
if (args[0] === "android" && (args[1] === "dev" || args[1] === "build")) {
  const devActive = finalArgs.some((a) => a.includes("tauri.android-dev.conf.json"));
  const base = "src-tauri/gen/android/app/src/main/java/net/puetsua/pansutong";
  rmSync(devActive ? `${base}/generated` : `${base}/dev/generated`, {
    recursive: true,
    force: true,
  });
}
const bin = process.platform === "win32" ? "tauri.cmd" : "tauri";
const result = spawnSync(bin, finalArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
