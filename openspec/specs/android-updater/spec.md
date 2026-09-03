# android-updater Specification

## Purpose

Android sideload builds check for newer APKs in-app, download them, and launch the system package installer so the user can confirm installation without leaving the app or opening a browser.

## Requirements

### Requirement: Android startup update check

The system SHALL check once at launch on Android for a newer release APK. Production builds SHALL resolve the update from the project's latest GitHub Release (`Pansuthong_*_universal.apk` asset). Dev builds SHALL resolve the update from the manifest URL configured in `tauri.dev.conf.json` only. When already up to date or on any error, the check SHALL resolve to no pending update without blocking startup or surfacing an error.

#### Scenario: Production checks GitHub Releases

- **WHEN** the update check runs on a production Android build
- **THEN** it reads the latest GitHub Release for the repository
- **AND** selects the `Pansuthong_*_universal.apk` asset (not a `.sig` or other file)

#### Scenario: Dev checks the dev manifest URL

- **WHEN** the update check runs on a Dev Android build (`net.puetsua.pansuthong.dev`)
- **THEN** it reads the manifest from the URL in `tauri.dev.conf.json`
- **AND** does not use the desktop `latest.json` minisign manifest

#### Scenario: Already up to date

- **WHEN** the remote version is less than or equal to the running app version
- **THEN** the check resolves to no pending update

#### Scenario: A failed check is silent

- **WHEN** the check throws (offline, endpoint unreachable, malformed manifest)
- **THEN** the error is swallowed and no update prompt or error is shown

### Requirement: Android download and system install

The system SHALL download the pending APK to app-private storage with visible progress, then launch the Android system installer for that file. The download URL SHALL be resolved during `check` and kept in plugin state; the webview MUST NOT supply a download URL to `download_and_install`. The user SHALL confirm installation in the system UI; the app SHALL NOT replace itself silently. On install launch failure, the prompt SHALL show a retryable error.

#### Scenario: Progress is reported while downloading

- **WHEN** an Android update is downloading
- **THEN** a progress bar advances from 0 toward 1 as bytes arrive and reaches 1 on completion

#### Scenario: System installer is launched

- **WHEN** the download completes and install-unknown-apps permission is granted
- **THEN** the system package installer opens for the downloaded APK

#### Scenario: Install launch failure is retryable

- **WHEN** download or install launch fails
- **THEN** the prompt shows the error and offers Retry rather than assuming success

### Requirement: Play Store sideload constraint

Sideload Android builds MAY declare `REQUEST_INSTALL_PACKAGES` for in-app updates. A future Google Play distribution MUST NOT ship that permission and MUST use Play In-App Updates instead.

#### Scenario: Documentation warns Play builders

- **WHEN** a maintainer reads release/updater documentation
- **THEN** the Play Store permission constraint is documented
