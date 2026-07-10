# desktop-window-chrome Specification

## Purpose

On desktop the main window uses frameless custom chrome so the titlebar matches
the app theme: app icon, drag region, and window controls. Android keeps the
mobile shell and does not render this titlebar. Win11 Snap Layout hover flyout
is deferred.

## Requirements

### Requirement: Frameless main window on desktop

The system SHALL disable OS window decorations on the main desktop window so the webview provides window chrome.

#### Scenario: Main window has no OS titlebar
- **WHEN** the app launches on desktop
- **THEN** the main window has no native titlebar or system window-control buttons

#### Scenario: Android shell unchanged
- **WHEN** the app runs on Android
- **THEN** the mobile shell is shown without a desktop custom titlebar

### Requirement: Custom titlebar chrome

The system SHALL render a custom titlebar on the desktop main window with the app icon on the left, a drag region, and minimize, maximize-or-restore, and close controls on the right, styled with the active theme tokens.

#### Scenario: Titlebar shows icon and controls
- **WHEN** the desktop shell is visible
- **THEN** the top of the window shows the app icon, a draggable region, and minimize, maximize/restore, and close buttons

#### Scenario: Titlebar follows theme
- **WHEN** the user is in light or dark mode (including a custom theme preset)
- **THEN** the titlebar background and controls use the same theme tokens as the desktop shell

### Requirement: Window dragging and controls

The system SHALL allow dragging the window from the titlebar drag region, toggling maximize on double-click of that region, and invoking minimize, maximize-or-restore, and close from the control buttons. Control buttons MUST NOT start a window drag.

#### Scenario: Drag moves the window
- **WHEN** the user presses and drags on the titlebar drag region
- **THEN** the main window moves with the pointer

#### Scenario: Double-click toggles maximize
- **WHEN** the user double-clicks the titlebar drag region
- **THEN** the window toggles between maximized and restored

#### Scenario: Controls act on the window
- **WHEN** the user activates minimize, maximize/restore, or close
- **THEN** the corresponding window action runs (minimize, toggle maximize, or close)

#### Scenario: Maximize control reflects state
- **WHEN** the window is maximized or restored
- **THEN** the maximize/restore control appearance matches the current state

### Requirement: Snap-layout hover flyout deferred

The system is NOT REQUIRED to show the Windows 11 Snap Layout flyout when hovering the maximize control. Edge snap and keyboard snap MAY continue to work via the OS.

#### Scenario: Maximize still works without flyout
- **WHEN** the user activates the maximize control on Windows 11
- **THEN** the window maximizes or restores even if no Snap Layout flyout appears on hover
