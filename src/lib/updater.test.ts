import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the cross-language seams: the updater/process plugins (Rust IPC) and the
// platform probe. A failed or Android-skipped check must never throw.
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("./platform", () => ({ isAndroid: vi.fn() }));

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isAndroid } from "./platform";
import { checkForUpdate, installUpdate } from "./updater";

const checkMock = vi.mocked(check);
const relaunchMock = vi.mocked(relaunch);
const isAndroidMock = vi.mocked(isAndroid);

beforeEach(() => {
  checkMock.mockReset();
  relaunchMock.mockReset();
  relaunchMock.mockResolvedValue(undefined as never);
  isAndroidMock.mockReset();
  isAndroidMock.mockResolvedValue(false);
});

describe("checkForUpdate", () => {
  it("returns null and never calls check() on Android", async () => {
    isAndroidMock.mockResolvedValue(true);
    expect(await checkForUpdate()).toBeNull();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("swallows errors (offline) and returns null", async () => {
    checkMock.mockRejectedValue(new Error("network down"));
    expect(await checkForUpdate()).toBeNull();
  });

  it("returns null when already up to date", async () => {
    checkMock.mockResolvedValue(null);
    expect(await checkForUpdate()).toBeNull();
  });

  it("returns the pending update when one is available", async () => {
    const update = { version: "0.2.0" } as Update;
    checkMock.mockResolvedValue(update);
    expect(await checkForUpdate()).toBe(update);
  });
});

describe("installUpdate", () => {
  it("maps download events to a 0..1 fraction and relaunches", async () => {
    // Drive the onEvent callback through a realistic Started→Progress→Finished run.
    const downloadAndInstall = vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 25 } });
      onEvent({ event: "Progress", data: { chunkLength: 25 } });
      onEvent({ event: "Finished" });
    });
    const update = { downloadAndInstall } as unknown as Update;

    const fractions: number[] = [];
    await installUpdate(update, f => fractions.push(f));

    expect(fractions).toEqual([0.25, 0.5, 1]);
    expect(relaunchMock).toHaveBeenCalledOnce();
  });

  it("does not emit progress before the total length is known", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: {} }); // contentLength unknown
      onEvent({ event: "Progress", data: { chunkLength: 10 } });
    });
    const update = { downloadAndInstall } as unknown as Update;

    const fractions: number[] = [];
    await installUpdate(update, f => fractions.push(f));

    expect(fractions).toEqual([]); // no division by an unknown total
    expect(relaunchMock).toHaveBeenCalledOnce();
  });
});
