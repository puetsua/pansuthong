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
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = Number(process.env.ANDROID_UPDATE_PORT ?? 8765);
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_SERVE_DIR = "tmp/android-dev-update";

/**
 * @param {string[]} argv process.argv
 * @returns {{ host: string; port: number; serveDir: string }}
 */
export function parseServeArgs(argv) {
  const args = argv.slice(2);
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--host") {
      const value = args[++i];
      if (!value || value.startsWith("-")) {
        throw new Error("--host requires an IP address or hostname");
      }
      host = value;
      continue;
    }
    if (arg === "--port") {
      const value = args[++i];
      if (!value || value.startsWith("-")) {
        throw new Error("--port requires a number");
      }
      port = Number(value);
      if (!Number.isFinite(port) || port <= 0) {
        throw new Error(`invalid --port value: ${value}`);
      }
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  if (positionals.length > 1) {
    throw new Error(
      `expected one serve directory, got: ${positionals.join(", ")}`,
    );
  }

  return {
    host,
    port,
    serveDir: positionals[0] ?? DEFAULT_SERVE_DIR,
  };
}

/**
 * Derive the base URL clients should use to download the APK.
 * Uses the request Host header so emulator (10.0.2.2) and LAN clients get
 * reachable URLs instead of the server's bind address (0.0.0.0 / 127.0.0.1).
 *
 * @param {{ headers?: { host?: string } }} req
 * @param {string} bindHost
 * @param {number} defaultPort
 */
export function manifestBaseUrl(req, bindHost, defaultPort) {
  const hostHeader = req.headers?.host?.trim();
  if (hostHeader) {
    const hostname = hostHeader.split(":")[0];
    if (hostname && hostname !== "0.0.0.0") {
      return hostHeader.includes(":")
        ? `http://${hostHeader}`
        : `http://${hostname}:${defaultPort}`;
    }
  }

  const fallbackHost =
    bindHost === "0.0.0.0" || bindHost === "::" ? "127.0.0.1" : bindHost;
  return `http://${fallbackHost}:${defaultPort}`;
}

export function versionFromApkName(name) {
  const m = name.match(/_(\d+\.\d+\.\d+(?:-[^_]+)?)_universal\.apk$/i);
  if (!m) throw new Error(`cannot parse version from APK name: ${name}`);
  return m[1];
}

function contentType(file) {
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".apk")) return "application/vnd.android.package-archive";
  return "application/octet-stream";
}

async function findApk(serveDir) {
  const names = await readdir(serveDir);
  const apk = names.find(
    n => n.toLowerCase().endsWith(".apk") && !n.toLowerCase().endsWith(".apk.sig"),
  );
  if (!apk) throw new Error(`no APK in ${serveDir}`);
  return apk;
}

export async function buildManifest(req, serveDir, bindHost, port) {
  const apk = await findApk(serveDir);
  const version = versionFromApkName(apk);
  const baseUrl = manifestBaseUrl(req, bindHost, port);
  return {
    version,
    notes: `Dev update to ${version}`,
    url: `${baseUrl}/${encodeURIComponent(apk)}`,
  };
}

function main() {
  const { host, port, serveDir } = parseServeArgs(process.argv);

  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];
      if (path === "/android-latest.json") {
        const manifest = await buildManifest(req, serveDir, host, port);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(manifest, null, 2));
        return;
      }
      const file = basename(path);
      if (extname(file).toLowerCase() === ".apk") {
        const bytes = await readFile(join(serveDir, file));
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

  server.listen(port, host, () => {
    console.log(`Android dev update server at http://${host}:${port}/`);
    console.log(`Serving folder: ${serveDir}`);
    console.log(`Manifest: http://${host}:${port}/android-latest.json`);
  });
}

const thisFile = fileURLToPath(import.meta.url);
const invokedAsMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === thisFile;

if (invokedAsMain) {
  try {
    main();
  } catch (err) {
    console.error(String(err?.message ?? err));
    process.exit(1);
  }
}
