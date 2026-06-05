// Initialise i18next (English, synchronously) so components using useTranslation /
// the global i18n instance render real strings during tests instead of raw keys.
import "./i18n";

// jsdom doesn't implement HTMLMediaElement.play; the completion chime (#80) calls
// it and swallows failures, but jsdom still logs a noisy "Not implemented" error.
// Stub it to a resolved no-op so test output stays clean.
if (typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
}
