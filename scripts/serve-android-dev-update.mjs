#!/usr/bin/env node
/**
 * Serve android-latest.json + Dev APKs for local Android in-app update testing.
 *
 * Usage:
 *   1. Build two Dev APKs at different versions (older + newer).
 *   2. Copy the newer APK into ./tmp/android-dev-update/ (not committed).
 *   3. node scripts/serve-android-dev-update.mjs ./tmp/android-dev-update
 *   4. adb install older APK, launch Pansuthong Dev, tap Update.
 *
 * Emulator: use 10.0.2.2:8765 (configured in tauri.android-dev.conf.json).
 * Physical device: pass --host 0.0.0.0 and point tauri.android-dev.conf.json at
 * your LAN IP, e.g. http://192.168.1.10:8765/android-latest.json
 */

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";

const PORT = Number(process.env.ANDROID_UPDATE_PORT ?? 8765);
const HOST = process.argv.includes("--host")
  ? process.argv[process.argv.indexOf("--host") + 1]
  : "127.0.0.1";
const dirArg = process.argv.find(a => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]);
const SERVE_DIR = dirArg ?? "tmp/android-dev-update";

function contentType(file) {
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".apk")) return "application/vnd.android.package-archive";
  return "application/octet-stream";
}

async function findApk() {
  const names = await readdir(SERVE_DIR);
  const apk = names.find(
    n => n.toLowerCase().endsWith(".apk") && !n.toLowerCase().endsWith(".apk.sig"),
  );
  if (!apk) throw new Error(`no APK in ${SERVE_DIR}`);
  return apk;
}

function versionFromApkName(name) {
  const m = name.match(/_(\d+\.\d+\.\d+(?:-[^_]+)?)_universal\.apk$/i);
  if (!m) throw new Error(`cannot parse version from APK name: ${name}`);
  return m[1];
}

async function buildManifest() {
  const apk = await findApk();
  const version = versionFromApkName(apk);
  const hostForUrl = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  return {
    version,
    notes: `Dev update to ${version}`,
    url: `http://${hostForUrl}:${PORT}/${encodeURIComponent(apk)}`,
  };
}

const server = createServer(async (req, res) => {
  try {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/android-latest.json") {
      const manifest = await buildManifest();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(manifest, null, 2));
      return;
    }
    const file = basename(path);
    if (extname(file).toLowerCase() === ".apk") {
      const bytes = await readFile(join(SERVE_DIR, file));
      res.writeHead(200, { "Content-Type": contentType(file) });
      res.end(bytes);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Android dev update server at http://${HOST}:${PORT}/`);
  console.log(`Serving folder: ${SERVE_DIR}`);
  console.log(`Manifest: http://${HOST}:${PORT}/android-latest.json`);
});
