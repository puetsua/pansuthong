//! Optional task-completion chime (#80). On Linux desktop, playback goes through
//! a Tauri command (rodio/cpal) so WebKitGTK/GStreamer cannot abort the renderer
//! when sink plugins are missing (#242). Elsewhere, a WebView `<audio>` element
//! uses the media volume (Android/desktop non-Linux). The Rust side persists the
//! `sound_on_complete` preference only.

import { invoke } from "@tauri-apps/api/core";
import bellUrl from "../assets/bell.ogg";
import { isLinux } from "./platform";

// Module-level mirror of the device-local `sound_on_complete` setting, kept in
// sync by App from `doc.settings`. Defaults to `true` to match the Rust default,
// so the very first completion still chimes before the sync effect has run.
let enabled = true;

// Cached after first probe so rapid completions do not await `isLinux()` each time.
let nativeLinux: boolean | null = null;

// One reused element so rapid completions don't spawn a new Audio object each time.
let audio: HTMLAudioElement | null = null;

/** Mirror the user's `sound_on_complete` preference into this module (#80). */
export function setCompletionSoundEnabled(on: boolean): void {
  enabled = on;
}

/** Clear cached Linux detection (vitest only). */
export function resetSoundPlatformCache(): void {
  nativeLinux = null;
}

async function useNativeLinuxPlayback(): Promise<boolean> {
  if (nativeLinux === null) {
    try {
      nativeLinux = await isLinux();
    } catch {
      nativeLinux = false;
    }
  }
  return nativeLinux;
}

function playViaWebAudio(): void {
  if (typeof Audio === "undefined") return; // non-browser env (e.g. tests): no-op
  try {
    if (!audio) audio = new Audio(bellUrl);
    audio.currentTime = 0; // restart so back-to-back completions each chime
    // Autoplay-policy or codec rejection is non-fatal; never let a sound failure
    // get in the way of completing a task.
    void audio.play().catch(() => {});
  } catch {
    // `new Audio` can throw in restricted environments; swallow it.
  }
}

/** Play the task-completion chime, unless the user has turned it off (#80). */
export function playCompletionSound(): void {
  if (!enabled) return;
  void (async () => {
    if (await useNativeLinuxPlayback()) {
      try {
        await invoke("play_completion_sound");
      } catch {
        // Missing command, IPC failure, or backend error — completing the task still wins.
      }
      return;
    }
    playViaWebAudio();
  })();
}
