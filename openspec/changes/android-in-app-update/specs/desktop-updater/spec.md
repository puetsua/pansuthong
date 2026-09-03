## MODIFIED Requirements

### Requirement: Startup update check

The system SHALL check once at launch for a newer release, resolving to nothing when
already up to date or on any error, so a failed or offline check neither blocks
startup nor surfaces an error. On Android it SHALL use the Android in-app updater
(GitHub Release APK or Dev manifest) instead of the desktop-only updater plugin.

#### Scenario: Android uses the in-app updater plugin

- **WHEN** the update check runs on Android
- **THEN** it checks for a newer APK via the Android updater plugin
- **AND** does not call the desktop-only updater plugin

#### Scenario: A failed check is silent

- **WHEN** the check throws (offline, endpoint unreachable, malformed manifest)
- **THEN** the error is swallowed and no update prompt or error is shown
