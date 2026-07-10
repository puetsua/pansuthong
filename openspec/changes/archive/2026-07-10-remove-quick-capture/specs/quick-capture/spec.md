## REMOVED Requirements

### Requirement: Standalone capture window

**Reason**: Quick Capture is being retired; in-app Composer already covers one-line task creation without a second window or global hotkey.

**Migration**: Use the main app Composer to add tasks. No data migration is required.

The system SHALL provide a separate quick-capture window that can add a task
independently of the main app window.

#### Scenario: Capture adds a task
- **WHEN** the user submits text in the quick-capture window
- **THEN** a task is created via the same add-task path and appears once the main app reads the update

### Requirement: One-line parsing

**Reason**: This requirement was scoped to the Quick Capture capability, which is being retired. In-app Composer continues to use the shared one-line parser; that behavior is no longer specified under `quick-capture`.

**Migration**: Continue using Composer in the main app for parsed one-line capture. No user action required.

The system SHALL parse a single capture line into a structured task (title plus
recognized date/tag tokens), with the frontend and Rust parsers kept in mirror.

#### Scenario: Parsed preview matches what is saved
- **WHEN** the user types a line with recognized tokens
- **THEN** the preview reflects the parsed fields and the saved task matches the preview

### Requirement: Second build entry point

**Reason**: The standalone Quick Capture window and its HTML entry are removed, so the extra Vite rollup input is no longer required.

**Migration**: None — builds emit only the main app entry.

The system SHALL keep the quick-capture HTML entry registered as an additional
Vite rollup input so the standalone window is built.

#### Scenario: Build includes the capture entry
- **WHEN** the app is built
- **THEN** the quick-capture entry point is emitted alongside the main app
