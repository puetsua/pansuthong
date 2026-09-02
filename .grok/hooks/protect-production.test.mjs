import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decide,
  extractPids,
  isProductionDataPath,
  isProductionInstallPath,
  DENY_REASON,
} from "./protect-production.mjs";

const prodExe = "C:\\Users\\hank\\AppData\\Local\\Pansuthong\\pansuthong.exe";
const devExe = "D:\\Projects\\pansuthong\\src-tauri\\target\\debug\\pansuthong.exe";
const prodData = "C:\\Users\\hank\\AppData\\Roaming\\net.puetsua.pansuthong\\tasks_x.db";
const devData = "C:\\Users\\hank\\AppData\\Roaming\\net.puetsua.pansuthong.dev\\tasks_x.db";

const bash = (command, extra = {}) => ({
  hookEventName: "pre_tool_use",
  toolName: "run_terminal_command",
  toolInput: { command },
  cwd: extra.cwd ?? "D:\\Projects\\pansuthong",
  ...extra,
});

const allow = (input, opts) => assert.equal(decide(input, opts).decision, "allow");
const deny = (input, opts) => {
  const out = decide(input, opts);
  assert.equal(out.decision, "deny");
  assert.equal(out.reason, DENY_REASON);
};

describe("path classifiers", () => {
  it("detects the Windows install exe and not the repo debug binary", () => {
    assert.equal(isProductionInstallPath(prodExe), true);
    assert.equal(isProductionInstallPath(devExe), false);
    assert.equal(isProductionInstallPath("C:\\Users\\hank\\AppData\\Local\\Pansuthong Dev\\Pansuthong Dev.exe"), false);
  });

  it("detects live production data dirs but not .dev", () => {
    assert.equal(isProductionDataPath(prodData), true);
    assert.equal(isProductionDataPath(devData), false);
    assert.equal(
      isProductionDataPath("/home/hank/.local/share/net.puetsua.pansuthong/tasks.db"),
      true,
    );
    assert.equal(
      isProductionDataPath("/home/hank/.local/share/net.puetsua.pansuthong.dev/tasks.db"),
      false,
    );
  });
});

describe("allow: dev and read-only discovery", () => {
  it("allows npm run tauri dev / android dev", () => {
    allow(bash("npm run tauri dev"));
    allow(bash("npm run tauri android dev"));
  });

  it("allows listing processes to find production so it can be avoided", () => {
    allow(bash('tasklist /FI "IMAGENAME eq Pansuthong.exe"'));
    allow(bash("Get-CimInstance Win32_Process -Filter \"Name='pansuthong.exe'\" | Select-Object ProcessId, ExecutablePath"));
  });

  it("allows targeting Pansuthong Dev by name or repo path", () => {
    allow(bash('taskkill /IM "Pansuthong Dev.exe" /F'));
    allow(bash("Stop-Process -Id 51824 -Force"), {
      resolvePid: (pid) => (Number(pid) === 51824 ? devExe : ""),
    });
  });

  it("allows Tauri MCP against the dev identifier", () => {
    allow({
      toolName: "tauri__driver_session",
      toolInput: { action: "start", appIdentifier: "net.puetsua.pansuthong.dev" },
    });
  });

  it("allows editing repo source that mentions the production identifier", () => {
    allow({
      toolName: "search_replace",
      toolInput: {
        file_path: "D:\\Projects\\pansuthong\\src-tauri\\tauri.conf.json",
        old_string: "net.puetsua.pansuthong",
        new_string: "net.puetsua.pansuthong",
      },
    });
  });

  it("allows cargo test", () => {
    allow(bash("cargo test --manifest-path src-tauri/Cargo.toml -j 1"));
  });
});

describe("deny: production launch / kill / data / mcp", () => {
  it("denies launching the installed exe", () => {
    deny(bash(`Start-Process '${prodExe}'`));
    deny(bash(`& '${prodExe}'`));
  });

  it("denies image-name kill of pansuthong.exe (would also hit production)", () => {
    deny(bash("taskkill /IM pansuthong.exe /F"));
    deny(bash("Stop-Process -Name pansuthong -Force"));
  });

  it("denies killing a PID that resolves to the production exe", () => {
    deny(bash("Stop-Process -Id 43904 -Force"), {
      resolvePid: (pid) => (Number(pid) === 43904 ? prodExe : ""),
    });
    deny(bash("taskkill /PID 43904 /F"), {
      resolvePid: (pid) => (Number(pid) === 43904 ? prodExe : ""),
    });
  });

  it("denies writing production data", () => {
    deny({
      toolName: "write",
      toolInput: { file_path: prodData, content: "{}" },
    });
    deny(bash(`Remove-Item '${prodData}'`));
  });

  it("denies Tauri MCP against the production identifier", () => {
    deny({
      toolName: "tauri__driver_session",
      toolInput: { action: "start", appIdentifier: "net.puetsua.pansuthong" },
    });
    deny({
      tool_name: "tauri__driver_session",
      tool_input: { action: "start", appIdentifier: "net.puetsua.pansuthong" },
    });
  });

  it("denies adb uninstall of the production package", () => {
    deny(bash("adb uninstall net.puetsua.pansuthong"));
    allow(bash("adb uninstall net.puetsua.pansuthong.dev"));
  });

  it("denies cargo run / bare tauri dev without the Dev config", () => {
    deny(bash("cargo run --manifest-path src-tauri/Cargo.toml"));
    deny(bash("cargo run"), { cwd: "D:\\Projects\\pansuthong\\src-tauri" });
    deny(bash("npx tauri dev"));
    allow(bash("npx tauri dev --config src-tauri/tauri.dev.conf.json"));
  });
});

describe("override and pid parse", () => {
  it("allows production actions when PANSUTHONG_ALLOW_PRODUCTION=1", () => {
    allow(bash(`Start-Process '${prodExe}'`), {
      env: { ...process.env, PANSUTHONG_ALLOW_PRODUCTION: "1" },
    });
  });

  it("extracts PIDs from taskkill and Stop-Process", () => {
    assert.deepEqual(extractPids("taskkill /PID 43904 /F"), [43904]);
    assert.deepEqual(extractPids("Stop-Process -Id 51824 -Force"), [51824]);
  });
});
