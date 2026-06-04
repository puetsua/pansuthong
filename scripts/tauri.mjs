import { spawnSync } from "node:child_process";

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
