import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./platform", () => ({ isAndroid: vi.fn() }));

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isAndroid } from "./platform";
import {
  checkForUpdate,
  getPendingUpdate,
  installUpdate,
  onUpdatePromptRequested,
  requestUpdatePrompt,
  setPendingUpdate,
  subscribeToPendingUpdate,
  type AppUpdate,
  type DownloadEvent,
} from "./updater";

const checkMock = vi.mocked(check);
const relaunchMock = vi.mocked(relaunch);
const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const isAndroidMock = vi.mocked(isAndroid);

const appUpdate = (over: Partial<AppUpdate> = {}): AppUpdate => ({
  version: "0.2.0",
  downloadAndInstall: vi.fn(),
  ...over,
});

beforeEach(() => {
  checkMock.mockReset();
  relaunchMock.mockReset();
  relaunchMock.mockResolvedValue(undefined as never);
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
  isAndroidMock.mockReset();
  isAndroidMock.mockResolvedValue(false);
  setPendingUpdate(null);
});

describe("checkForUpdate", () => {
  it("calls the Android plugin on Android", async () => {
    isAndroidMock.mockResolvedValue(true);
    invokeMock.mockResolvedValue({
      version: "0.2.0",
      body: "notes",
    });
    const update = await checkForUpdate();
    expect(update?.version).toBe("0.2.0");
    expect(invokeMock).toHaveBeenCalledWith("plugin:android-updater|check");
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("returns null on Android when the plugin reports up to date", async () => {
    isAndroidMock.mockResolvedValue(true);
    invokeMock.mockResolvedValue(null);
    expect(await checkForUpdate()).toBeNull();
  });

  it("swallows Android errors and returns null", async () => {
    isAndroidMock.mockResolvedValue(true);
    invokeMock.mockRejectedValue(new Error("offline"));
    expect(await checkForUpdate()).toBeNull();
  });

  it("swallows desktop errors (offline) and returns null", async () => {
    checkMock.mockRejectedValue(new Error("network down"));
    expect(await checkForUpdate()).toBeNull();
  });

  it("returns null when already up to date on desktop", async () => {
    checkMock.mockResolvedValue(null);
    expect(await checkForUpdate()).toBeNull();
  });

  it("returns the pending update when one is available on desktop", async () => {
    checkMock.mockResolvedValue(appUpdate({ version: "0.2.0" }) as never);
    expect((await checkForUpdate())?.version).toBe("0.2.0");
  });
});

describe("pending update store", () => {
  it("notifies subscribers on change and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPendingUpdate(listener);

    setPendingUpdate(appUpdate({ version: "0.2.0" }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPendingUpdate()?.version).toBe("0.2.0");

    unsubscribe();
    setPendingUpdate(appUpdate({ version: "0.3.0" }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPendingUpdate()?.version).toBe("0.3.0");
  });

  it("does not notify when the same reference is republished", () => {
    const same = appUpdate({ version: "0.2.0" });
    setPendingUpdate(same);
    const listener = vi.fn();
    subscribeToPendingUpdate(listener)();

    const listener2 = vi.fn();
    const off = subscribeToPendingUpdate(listener2);
    setPendingUpdate(same);
    off();
    expect(listener2).not.toHaveBeenCalled();
  });

  it("returns a stable snapshot (safe for useSyncExternalStore)", () => {
    const same = appUpdate({ version: "0.2.0" });
    setPendingUpdate(same);
    expect(getPendingUpdate()).toBe(getPendingUpdate());
    expect(getPendingUpdate()).toBe(same);
  });

  it("stops delivering prompt requests after unsubscribe", () => {
    const handler = vi.fn();
    const off = onUpdatePromptRequested(handler);
    requestUpdatePrompt();
    expect(handler).toHaveBeenCalledTimes(1);

    off();
    requestUpdatePrompt();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("installUpdate", () => {
  it("maps download events to a 0..1 fraction and relaunches on desktop", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (e: DownloadEvent) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 25 } });
      onEvent({ event: "Progress", data: { chunkLength: 25 } });
      onEvent({ event: "Finished" });
    });
    const update: AppUpdate = { version: "0.2.0", downloadAndInstall };

    const fractions: number[] = [];
    await installUpdate(update, f => fractions.push(f));

    expect(fractions).toEqual([0.25, 0.5, 1]);
    expect(relaunchMock).toHaveBeenCalledOnce();
  });

  it("does not relaunch on Android", async () => {
    isAndroidMock.mockResolvedValue(true);
    const downloadAndInstall = vi.fn(async (onEvent: (e: DownloadEvent) => void) => {
      onEvent({ event: "Finished" });
    });
    await installUpdate({ version: "0.2.0", downloadAndInstall });
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("does not emit progress before the total length is known on desktop", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (e: DownloadEvent) => void) => {
      onEvent({ event: "Started", data: {} });
      onEvent({ event: "Progress", data: { chunkLength: 10 } });
    });
    const update: AppUpdate = { version: "0.2.0", downloadAndInstall };

    const fractions: number[] = [];
    await installUpdate(update, f => fractions.push(f));

    expect(fractions).toEqual([]);
    expect(relaunchMock).toHaveBeenCalledOnce();
  });
});
