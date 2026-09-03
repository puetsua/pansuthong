import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  manifestBaseUrl,
  parseServeArgs,
  versionFromApkName,
} from "./serve-android-dev-update.mjs";

describe("parseServeArgs", () => {
  const baseArgv = ["node", "scripts/serve-android-dev-update.mjs"];

  it("accepts --host before the serve directory", () => {
    const parsed = parseServeArgs([
      ...baseArgv,
      "--host",
      "0.0.0.0",
      "./tmp/android-dev-update",
    ]);
    expect(parsed.host).toBe("0.0.0.0");
    expect(parsed.serveDir).toBe("./tmp/android-dev-update");
  });

  it("accepts --host after the serve directory", () => {
    const parsed = parseServeArgs([
      ...baseArgv,
      "./tmp/android-dev-update",
      "--host",
      "192.168.1.50",
    ]);
    expect(parsed.host).toBe("192.168.1.50");
    expect(parsed.serveDir).toBe("./tmp/android-dev-update");
  });

  it("rejects unknown flags", () => {
    expect(() => parseServeArgs([...baseArgv, "--folder", "./tmp"])).toThrow(
      /--folder/,
    );
  });

  it("rejects multiple serve directories", () => {
    expect(() => parseServeArgs([...baseArgv, "./one", "./two"])).toThrow(
      /one serve directory/i,
    );
  });
});

describe("manifestBaseUrl", () => {
  it("uses the request Host header for emulator clients", () => {
    expect(
      manifestBaseUrl({ headers: { host: "10.0.2.2:8765" } }, "127.0.0.1", 8765),
    ).toBe("http://10.0.2.2:8765");
  });

  it("uses the request Host header for LAN clients", () => {
    expect(
      manifestBaseUrl({ headers: { host: "192.168.1.50:8765" } }, "0.0.0.0", 8765),
    ).toBe("http://192.168.1.50:8765");
  });

  it("falls back to bind host when Host is missing", () => {
    expect(manifestBaseUrl({ headers: {} }, "127.0.0.1", 8765)).toBe(
      "http://127.0.0.1:8765",
    );
  });

  it("maps 0.0.0.0 bind to loopback when Host is missing", () => {
    expect(manifestBaseUrl({ headers: {} }, "0.0.0.0", 8765)).toBe(
      "http://127.0.0.1:8765",
    );
  });
});

describe("buildManifest", () => {
  it("writes the APK url using the request Host header", async () => {
    const dir = mkdtempSync(join(tmpdir(), "android-dev-update-"));
    const apk = "Pansuthong_0.2.0_universal.apk";
    writeFileSync(join(dir, apk), "apk");
    try {
      const manifest = await buildManifest(
        { headers: { host: "10.0.2.2:8765" } },
        dir,
        "127.0.0.1",
        8765,
      );
      expect(manifest.version).toBe("0.2.0");
      expect(manifest.url).toBe(
        `http://10.0.2.2:8765/${encodeURIComponent(apk)}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("versionFromApkName", () => {
  it("parses a universal APK version", () => {
    expect(versionFromApkName("Pansuthong_1.2.3_universal.apk")).toBe("1.2.3");
  });
});
