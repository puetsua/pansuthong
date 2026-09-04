// Initialise i18next (English, synchronously) so components using useTranslation /
// the global i18n instance render real strings during tests instead of raw keys.
import "./i18n";

// jsdom doesn't define PointerEvent; pointer-based drag tests dispatch native events.
if (typeof PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

// jsdom doesn't implement HTMLMediaElement.play; the completion chime (#80) calls
// it and swallows failures, but jsdom still logs a noisy "Not implemented" error.
// Stub it to a resolved no-op so test output stays clean.
if (typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
}

// jsdom implements neither URL.createObjectURL nor revokeObjectURL; attachment
// previews build an object URL from the blob's bytes and revoke it on cleanup.
// Stub both so components that render attachments can mount/unmount in tests.
if (typeof URL !== "undefined") {
  URL.createObjectURL = (() => "blob:test") as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
}
