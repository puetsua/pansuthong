import type { Location, NavigateFunction } from "react-router-dom";

/** Desktop opens /settings as a panel over the view it was opened from; that
 *  view's location rides along in history state so it keeps rendering behind.
 *  `fromIdx` is the history index it was opened from, so closing can tell
 *  whether Back really returns there. */
export type SettingsRouteState = { backgroundLocation?: Location; fromIdx?: number };

export function settingsBackground(location: Location): Location | undefined {
  return (location.state as SettingsRouteState | null)?.backgroundLocation;
}

/** `state` for a link to /settings from `location`. */
export function settingsLinkState(location: Location): SettingsRouteState {
  // Already on /settings: the link replaces this entry, so keep where it came from.
  const current = location.state as SettingsRouteState | null;
  if (current?.backgroundLocation) return current;
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return { backgroundLocation: location, fromIdx: idx };
}

/** Leave the Settings panel for the view shown behind it: Back when that is
 *  the previous entry, otherwise replace /settings with it (or Today). */
export function closeSettingsPanel(navigate: NavigateFunction, location: Location): void {
  const state = location.state as SettingsRouteState | null;
  const bg = state?.backgroundLocation;
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  if (bg && typeof state?.fromIdx === "number" && idx === state.fromIdx + 1) {
    navigate(-1);
  } else if (bg) {
    navigate({ pathname: bg.pathname, search: bg.search, hash: bg.hash }, { replace: true, state: bg.state });
  } else {
    navigate("/today", { replace: true });
  }
}

/** Phone: the header's ☰ (beside "Settings") asks the Settings page to open
 *  its category drawer. */
export const OPEN_SETTINGS_DRAWER = "pansuthong:open-settings-drawer";

export function openSettingsDrawer(): void {
  window.dispatchEvent(new Event(OPEN_SETTINGS_DRAWER));
}
