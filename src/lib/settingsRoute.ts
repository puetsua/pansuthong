import type { Location } from "react-router-dom";

/** Desktop opens /settings as a panel over the view it was opened from; that
 *  view's location rides along in history state so it keeps rendering behind. */
export type SettingsRouteState = { backgroundLocation?: Location };

export function settingsBackground(location: Location): Location | undefined {
  return (location.state as SettingsRouteState | null)?.backgroundLocation;
}

/** Phone: the header's ☰ (beside "Settings") asks the Settings page to open
 *  its category drawer. */
export const OPEN_SETTINGS_DRAWER = "pansuthong:open-settings-drawer";

export function openSettingsDrawer(): void {
  window.dispatchEvent(new Event(OPEN_SETTINGS_DRAWER));
}
