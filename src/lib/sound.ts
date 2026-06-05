//! Optional task-completion chime (#80). Purely frontend: a WebView `<audio>`
//! element played through the media volume, so it works the same on desktop and
//! Android (users mute via the Settings toggle or the system media volume). The
//! Rust side only persists the `sound_on_complete` preference.

import bellUrl from "../assets/bell.ogg";

// Module-level mirror of the device-local `sound_on_complete` setting, kept in
// sync by App from `doc.settings`. Defaults to `true` to match the Rust default,
// so the very first completion still chimes before the sync effect has run.
let enabled = true;

// One reused element so rapid completions don't spawn a new Audio object each time.
let audio: HTMLAudioElement | null = null;

/** Mirror the user's `sound_on_complete` preference into this module (#80). */
export function setCompletionSoundEnabled(on: boolean): void {
  enabled = on;
}

/** Play the task-completion chime, unless the user has turned it off (#80). */
export function playCompletionSound(): void {
  if (!enabled) return;
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
