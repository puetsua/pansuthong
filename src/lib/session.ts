/**
 * Epoch-ms captured once when the frontend bundle loads, i.e. at each app launch
 * (#idle-timer). Closing and reopening the app reloads the webview, so this resets
 * then — anchoring the idle clock to "since you opened the app" on a fresh start,
 * while still growing without bound within a single session.
 */
export const SESSION_START_MS = Date.now();
