#!/usr/bin/env node
/**
 * PreToolUse guard: block agent actions that would launch, kill, uninstall,
 * automate, or mutate the installed production Pansuthong app / its live data.
 * Dev (`Pansuthong Dev`, net.puetsua.pansuthong.dev, npm run tauri dev) is allowed.
 *
 * Override (only when the user explicitly asked): PANSUTHONG_ALLOW_PRODUCTION=1
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROD_ID = "net.puetsua.pansuthong";
const DEV_ID = "net.puetsua.pansuthong.dev";
const DENY_REASON =
  "Blocked: this targets the production Pansuthong app or its data. Use Pansuthong Dev (`npm run tauri dev` / identifier net.puetsua.pansuthong.dev). Locate the production PID/path first and leave it alone. Override only if the user explicitly asked: PANSUTHONG_ALLOW_PRODUCTION=1.";

const READ_ONLY = /\b(tasklist|get-process|get-ciminstance|get-wmiobject|get-item|get-childitem|test-path|findstr|select-string|get-content|get-filehash|type|cat|less|more|head|tail|ps\b|pgrep|readlink|file\b|stat\b|ls\b|dir\b|wmic\s+process\b[^\n]*\bget\b)\b/i;

const MUTATE = /\b(taskkill|stop-process|stop-ciminstance|invoke-cimmethod|kill(all)?\b|uninstall|remove-item|remove-appxpackage|remove-appx|erase\b|rmdir\b|\brd\b|\brm\b|\bdel\b|start-process|invoke-item|invoke-expression|set-content|add-content|out-file|copy-item|move-item|rename-item|\bren\b|copy\b|move\b|winget\s+uninstall|adb\s+uninstall|am\s+force-stop|am\s+start|pm\s+uninstall|pm\s+clear|pm\s+disable)\b/i;

const KILL =
  /\b(taskkill|stop-process|stop-ciminstance|invoke-cimmethod.{0,80}terminate|wmic\s+process[^\n]*call\s+terminate|pkill|killall|kill\s+[-\d])/i;

export function normalize(p) {
  return String(p ?? "").replace(/\\/g, "/").toLowerCase();
}

export function isDevInstallPath(p) {
  const n = normalize(p);
  return (
    /(?:^|[\\/])pansuthong dev(?:[\\/]|\.exe$)/.test(n) ||
    /(?:^|[\\/])pansuthongdev/.test(n) ||
    n.includes(DEV_ID) ||
    n.includes("/src-tauri/target/")
  );
}

export function isDevProcessImage(name) {
  const n = normalize(name);
  return /pansuthong\s+dev(?:\.exe)?$/.test(n) || /pansuthongdev(?:\.exe)?$/.test(n);
}

/** Strip shell comments so trailing "Pansuthong Dev" notes do not affect target checks. */
export function stripShellComments(text) {
  return String(text ?? "")
    .replace(/#.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

export function extractKillImageName(cmd) {
  const s = stripShellComments(cmd);
  let m = s.match(/\b\/IM\s+("([^"]+)"|'([^']+)'|(\S+))/i);
  if (m) return m[2] || m[3] || m[4];
  m = s.match(/\b-Name\s+("([^"]+)"|'([^']+)'|(\S+))/i);
  if (m) return m[2] || m[3] || m[4];
  m = s.match(/\b(?:pkill|killall)\s+("([^"]+)"|'([^']+)'|(\S+))/i);
  if (m) return m[2] || m[3] || m[4];
  return "";
}

export function isDevIdentity(text) {
  const s = normalize(text);
  if (isDevInstallPath(s)) return true;
  if (s === DEV_ID || s.includes(`/${DEV_ID}`) || s.includes(`\\${DEV_ID}`)) {
    return true;
  }
  return (
    s.includes("tauri.dev.conf.json") || s.includes("tauri.android-dev.conf.json")
  );
}

export function isProductionInstallPath(p) {
  const n = normalize(p);
  if (!n || isDevInstallPath(n)) return false;
  if (n.includes("/src-tauri/target/")) return false;
  if (/\/appdata\/local\/pansuthong\/pansuthong(\.exe)?(?:\s|$|['"])/.test(n)) return true;
  if (n.includes("/appdata/local/pansuthong/")) return true;
  if (n.includes("/appdata/local/programs/pansuthong/")) return true;
  // PowerShell / cmd env-var launch paths (e.g. $env:LOCALAPPDATA\Pansuthong\pansuthong.exe).
  if (/(?:\$env:|%)[a-z_]*localappdata[^/\\]*[\\/]pansuthong(?:[\\/]|$)/.test(n)) {
    return true;
  }
  if (n.includes("/usr/bin/pansuthong")) return true;
  if (n.includes("/usr/lib/pansuthong")) return true;
  if (/\/opt\/pansuthong\//.test(n)) return true;
  return false;
}

export function isProductionDataPath(p) {
  const n = normalize(stripShellComments(p));
  if (!n || n.includes(DEV_ID)) return false;
  // Live app dirs, not the git repo. Negative lookahead so `.dev` is allowed.
  return (
    /appdata\/(local|roaming)\/net\.puetsua\.pansuthong(?!\.dev)(?:\/|$)/.test(n) ||
    /(?:^|\/)\.local\/share\/net\.puetsua\.pansuthong(?!\.dev)(?:\/|$)/.test(n) ||
    /(?:^|\/)\.config\/net\.puetsua\.pansuthong(?!\.dev)(?:\/|$)/.test(n)
  );
}

export function mentionsProdPackage(text) {
  return /net\.puetsua\.pansuthong(?!\.dev)\b/i.test(String(text ?? ""));
}

function collectStrings(value, into = []) {
  if (value == null) return into;
  if (typeof value === "string" || typeof value === "number") {
    into.push(String(value));
    return into;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, into);
    return into;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, into);
  }
  return into;
}

function toolNameOf(input) {
  return String(input.toolName ?? input.tool_name ?? "");
}

function toolInputOf(input) {
  return input.toolInput ?? input.tool_input ?? {};
}

function haystackOf(input) {
  const parts = collectStrings(toolInputOf(input));
  if (input.command) parts.push(String(input.command));
  parts.push(toolNameOf(input));
  return parts.join("\n");
}

function commandOf(input) {
  const ti = toolInputOf(input);
  return String(ti.command ?? ti.cmd ?? input.command ?? "");
}

function pathsOf(input) {
  const ti = toolInputOf(input);
  const keys = ["target_file", "file_path", "filePath", "path", "paths"];
  const out = [];
  for (const k of keys) collectStrings(ti[k], out);
  return out;
}

function appIdentifierOf(input) {
  const ti = toolInputOf(input);
  const id = ti.appIdentifier ?? ti.app_identifier;
  return id == null ? "" : String(id).trim();
}

export function extractPids(text) {
  const ids = new Set();
  const re =
    /(?:\/pid\b|:pid\b|(?<![a-z])-id\b|(?<![a-z])-pid\b|processid\s*=)\s*(\d+)/gi;
  for (const m of String(text).matchAll(re)) ids.add(Number(m[1]));
  for (const m of String(text).matchAll(/\b(?:kill|taskkill)\b[^\n]*\b(\d{2,7})\b/gi)) {
    ids.add(Number(m[1]));
  }
  return [...ids].filter((n) => n > 0);
}

export function defaultResolvePid(pid) {
  try {
    if (process.platform === "win32") {
      const ps = [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").ExecutablePath`,
      ];
      return execFileSync("powershell", ps, {
        encoding: "utf8",
        timeout: 4000,
        windowsHide: true,
      }).trim();
    }
    return readlinkSync(`/proc/${Number(pid)}/exe`);
  } catch {
    return "";
  }
}

function isTauriMcp(name) {
  return /^(tauri__|mcp__tauri__|mcp__tauri|MCP:tauri)/i.test(name);
}

function isFileTool(name) {
  return /^(read_file|read|write|search_replace|edit|multiedit|delete|grep)$/i.test(name);
}

function isShellTool(name) {
  return /^(bash|run_terminal_command|powershell|shell)$/i.test(name) || name === "";
}

function isPackageScriptTauri(cmd) {
  return /\b(npm|pnpm|yarn)\s+(run\s+)?tauri\b/i.test(cmd);
}

function denyCargoRunWithoutDevConfig(cmd, cwd) {
  const blob = `${cwd}\n${cmd}`;
  if (!/\bcargo\s+run\b/i.test(cmd)) return false;
  if (!/src-tauri|pansuthong/i.test(blob)) return false;
  if (isDevIdentity(cmd)) return false;
  return true;
}

function denyBareTauriDev(cmd) {
  if (isPackageScriptTauri(cmd)) return false;
  if (/scripts\/tauri\.mjs/i.test(cmd)) return false;
  if (isDevIdentity(cmd)) return false;
  return /(?:^|[\s"'\\/])tauri(?:\.cmd)?\s+(dev|android\s+dev)\b/i.test(cmd);
}

function denyWingetUninstallProd(cmd) {
  if (!/\bwinget\s+uninstall\b/i.test(cmd)) return false;
  const target = stripShellComments(cmd).replace(/^.*\bwinget\s+uninstall\b/i, "").trim();
  if (isDevProcessImage(target) || /\bpansuthong\s+dev\b/i.test(target)) return false;
  if (/\bpansuthong\b/i.test(target)) return true;
  return false;
}

function denyAdbProd(text) {
  if (!mentionsProdPackage(text)) return false;
  return /\b(adb\s+uninstall|pm\s+uninstall|pm\s+clear|am\s+force-stop|am\s+start|am\s+kill)\b/i.test(
    text,
  );
}

function denyKillByImageName(cmd) {
  const body = stripShellComments(cmd);
  const named = extractKillImageName(cmd);
  if (named) {
    if (isDevProcessImage(named)) return false;
    if (/\bpansuthong(?:\.exe)?\b/i.test(named)) {
      return (
        /\b(taskkill|stop-process|killall|pkill)\b/i.test(body) &&
        !/src-tauri[\\/]target/i.test(body) &&
        !/executablepath/i.test(body)
      );
    }
    return false;
  }
  if (!/\b(taskkill|stop-process|killall|pkill)\b/i.test(body)) return false;
  if (/src-tauri[\\/]target/i.test(body) || /executablepath/i.test(body)) return false;
  if (/\bpansuthong\s+dev\b/i.test(body)) return false;
  return /\bpansuthong(?:\.exe)?\b/i.test(body);
}

export function decide(input, opts = {}) {
  const env = opts.env ?? process.env;
  if (env.PANSUTHONG_ALLOW_PRODUCTION === "1") {
    return { decision: "allow" };
  }

  const name = toolNameOf(input);
  const hay = haystackOf(input);
  const cmd = commandOf(input);
  const cwd = String(input.cwd ?? input.workspaceRoot ?? input.workspace_root ?? "");
  const resolvePid = opts.resolvePid ?? defaultResolvePid;

  const id = appIdentifierOf(input);
  if (id === PROD_ID || (isTauriMcp(name) && id && mentionsProdPackage(id) && !isDevIdentity(id))) {
    return { decision: "deny", reason: DENY_REASON };
  }

  for (const p of pathsOf(input)) {
    if (isProductionInstallPath(p) || isProductionDataPath(p)) {
      return { decision: "deny", reason: DENY_REASON };
    }
  }

  if (isFileTool(name)) {
    return { decision: "allow" };
  }

  const blob = `${cmd}\n${hay}\n${cwd}`;
  const cmdBody = stripShellComments(cmd || hay);

  if (denyAdbProd(blob)) return { decision: "deny", reason: DENY_REASON };
  if (denyBareTauriDev(cmd || hay)) return { decision: "deny", reason: DENY_REASON };
  if (denyWingetUninstallProd(cmd || hay)) return { decision: "deny", reason: DENY_REASON };
  if (denyCargoRunWithoutDevConfig(cmd || hay, cwd)) {
    return { decision: "deny", reason: DENY_REASON };
  }
  if (denyKillByImageName(cmd || hay)) return { decision: "deny", reason: DENY_REASON };

  if (KILL.test(blob) || MUTATE.test(blob)) {
    if (
      isProductionInstallPath(stripShellComments(blob)) ||
      isProductionDataPath(blob)
    ) {
      return { decision: "deny", reason: DENY_REASON };
    }
    if (mentionsProdPackage(cmdBody) && !READ_ONLY.test(blob)) {
      // Repo source edits mention the id constantly; only deny when this looks
      // like a live-app action (already gated by MUTATE/KILL).
      if (isShellTool(name) || isTauriMcp(name)) {
        if (MUTATE.test(cmd || hay) || KILL.test(cmd || hay)) {
          return { decision: "deny", reason: DENY_REASON };
        }
      }
    }
    for (const pid of extractPids(cmd || hay)) {
      let exe = "";
      try {
        exe = resolvePid(pid);
      } catch {
        exe = "";
      }
      // Fail closed when the exe path cannot be resolved (unknown PID may be production).
      if (!exe || isProductionInstallPath(exe)) {
        return { decision: "deny", reason: DENY_REASON };
      }
    }
  } else if (
    isShellTool(name) &&
    (isProductionInstallPath(stripShellComments(cmd)) || isProductionDataPath(cmd)) &&
    !READ_ONLY.test(cmd)
  ) {
    // Launching the installed exe (`& path`, start path) with no explicit verb.
    return { decision: "deny", reason: DENY_REASON };
  }

  return { decision: "allow" };
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function productionOverrideEnabled() {
  return process.env.PANSUTHONG_ALLOW_PRODUCTION === "1";
}

function hookPayload(out) {
  if (out.decision === "deny") {
    const reason = out.reason ?? DENY_REASON;
    return {
      permission: "deny",
      user_message: reason,
      agent_message: reason,
      decision: "deny",
      reason,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  }
  return {
    permission: "allow",
    decision: "allow",
  };
}

function writeHookResult(out) {
  const payload = hookPayload(out);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  if (out.decision === "deny") process.exitCode = 2;
}

function main() {
  const override = productionOverrideEnabled();
  try {
    const raw = readStdin().trim();
    if (!raw) {
      if (override) {
        writeHookResult({ decision: "allow" });
      } else {
        writeHookResult({
          decision: "deny",
          reason:
            "Blocked: protect-production hook received empty stdin (fail closed). Set PANSUTHONG_ALLOW_PRODUCTION=1 only if the user explicitly asked for production work.",
        });
      }
      return;
    }
    const input = JSON.parse(raw);
    writeHookResult(decide(input));
  } catch (err) {
    const msg = String(err?.message ?? err);
    process.stderr.write(`protect-production hook error: ${msg}\n`);
    if (override) {
      writeHookResult({ decision: "allow" });
    } else {
      writeHookResult({
        decision: "deny",
        reason: `Blocked: protect-production hook error (fail closed): ${msg}`,
      });
    }
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invokedAsMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === thisFile;

if (invokedAsMain) main();

export { DENY_REASON, PROD_ID, DEV_ID };
