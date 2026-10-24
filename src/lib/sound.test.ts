import { describe, it, expect, vi, beforeEach } from "vitest";

const platform = vi.hoisted(() => ({
  isLinux: vi.fn().mockResolvedValue(false),
}));

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./platform", () => platform);

import {
  playCompletionSound,
  resetSoundPlatformCache,
  setCompletionSoundEnabled,
} from "./sound";

describe("playCompletionSound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSoundPlatformCache();
    setCompletionSoundEnabled(true);
    platform.isLinux.mockResolvedValue(false);
  });

  it("invokes native playback on Linux instead of HTMLAudioElement (#242)", async () => {
    platform.isLinux.mockResolvedValue(true);
    const audioSpy = vi.spyOn(globalThis, "Audio").mockImplementation(
      () =>
        ({
          play: vi.fn().mockResolvedValue(undefined),
          currentTime: 0,
        }) as unknown as HTMLAudioElement,
    );

    playCompletionSound();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("play_completion_sound"),
    );
    expect(audioSpy).not.toHaveBeenCalled();
    audioSpy.mockRestore();
  });

  it("uses HTMLAudioElement when not on Linux", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(globalThis, "Audio").mockImplementation(
      () =>
        ({
          play,
          currentTime: 0,
        }) as unknown as HTMLAudioElement,
    );

    playCompletionSound();
    await vi.waitFor(() => expect(play).toHaveBeenCalled());
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does nothing when sound is disabled", async () => {
    setCompletionSoundEnabled(false);
    const audioSpy = vi.spyOn(globalThis, "Audio");

    playCompletionSound();
    await new Promise((r) => setTimeout(r, 10));
    expect(invoke).not.toHaveBeenCalled();
    expect(audioSpy).not.toHaveBeenCalled();
    audioSpy.mockRestore();
  });
});
