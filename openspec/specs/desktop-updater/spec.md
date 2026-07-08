# desktop-updater Specification

## Purpose

On desktop the app updates itself in place: at launch it asks GitHub whether a
newer signed release exists and, if so, offers a one-click download-install-relaunch.
The updater is desktop-only — the `tauri-plugin-updater` has no Android support and
calling it there would throw — so on Android the whole flow is a silent no-op. A
failed or offline check must never block startup or nag the user.

## Requirements

### Requirement: Startup update check

The system SHALL check once at launch for a newer release, resolving to nothing on
Android, when already up to date, or on any error, so a failed or offline check
neither blocks startup nor surfaces an error.

#### Scenario: Android skips the check
- **WHEN** the update check runs on Android
- **THEN** it resolves to no pending update without calling the desktop-only updater plugin

#### Scenario: A failed check is silent
- **WHEN** the check throws (offline, endpoint unreachable, malformed manifest)
- **THEN** the error is swallowed and no update prompt or error is shown

### Requirement: Update prompt

The system SHALL, when a newer release is found, show a modal carrying the new
version and its release notes, offering "Update now" and "Later"; "Later" dismisses
until the next launch and renders nothing when no update is pending.

#### Scenario: Prompt shows version and notes
- **WHEN** a pending update is available
- **THEN** a modal displays the target version and the release body (rendered as Markdown)

#### Scenario: Later defers to next launch
- **WHEN** the user chooses "Later"
- **THEN** the prompt is dismissed and no update is applied until the next launch re-checks

### Requirement: Download, install, and relaunch

The system SHALL download and install the pending update with visible progress and
then relaunch into the new version, surfacing a retryable error if the install fails.

#### Scenario: Progress is reported while downloading
- **WHEN** an update is downloading
- **THEN** a progress bar advances from 0 toward 1 as bytes arrive and reaches 1 on completion

#### Scenario: Install failure is retryable
- **WHEN** the download or install fails
- **THEN** the prompt shows the error and offers "Retry" rather than relaunching

### Requirement: Signed release verification

The system SHALL fetch the update manifest from the configured GitHub latest-release
endpoint and install only artifacts whose signature verifies against the bundled
minisign public key.

#### Scenario: Manifest comes from the release endpoint
- **WHEN** the updater checks for a release
- **THEN** it reads the `latest.json` manifest published on the project's latest GitHub release

#### Scenario: Unsigned or mis-signed artifact is refused
- **WHEN** an update artifact does not verify against the configured public key
- **THEN** it is rejected rather than installed
