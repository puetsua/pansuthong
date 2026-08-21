## ADDED Requirements

### Requirement: Single desktop instance

The system SHALL keep at most one running desktop process per app identifier.
Production (`net.puetsua.pansuthong`) and development (`net.puetsua.pansuthong.dev`)
MAY run at the same time because they use different identifiers.

When the user launches the app while an instance of that identifier is already
running, the new process SHALL exit without opening another window, and the
existing main window SHALL be restored if it is minimized and SHALL be focused.

#### Scenario: Second launch focuses existing window
- **WHEN** the desktop app is already running and the user launches it again
- **THEN** no second main window opens
- **AND** the existing main window is brought to the foreground

#### Scenario: Minimized window is restored
- **WHEN** the desktop app is running with its main window minimized
- **AND** the user launches the app again
- **THEN** the existing window is restored from the minimized state and focused

#### Scenario: Dev and production are independent
- **WHEN** `Pansuthong` is running
- **AND** the user launches `Pansuthong Dev`
- **THEN** both windows remain; neither identifier takes over the other

#### Scenario: Android unchanged
- **WHEN** the app runs on Android
- **THEN** instance handling is left to the OS and no desktop single-instance plugin is used
