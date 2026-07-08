# quick-capture Specification

## Purpose

Quick Capture is a standalone, lightweight window for adding a task without opening
the full app. It is a second Vite entry point (`quick-capture.html` →
`src/quick-capture/`) and reuses the one-line parser so a single typed line becomes
a structured task. Inline capture in the main views (the Composer) shares the same
parse-and-preview behavior.

## Requirements

### Requirement: Standalone capture window

The system SHALL provide a separate quick-capture window that can add a task
independently of the main app window.

#### Scenario: Capture adds a task
- **WHEN** the user submits text in the quick-capture window
- **THEN** a task is created via the same add-task path and appears once the main app reads the update

### Requirement: One-line parsing

The system SHALL parse a single capture line into a structured task (title plus
recognized date/tag tokens), with the frontend and Rust parsers kept in mirror.

#### Scenario: Parsed preview matches what is saved
- **WHEN** the user types a line with recognized tokens
- **THEN** the preview reflects the parsed fields and the saved task matches the preview

### Requirement: Second build entry point

The system SHALL keep the quick-capture HTML entry registered as an additional
Vite rollup input so the standalone window is built.

#### Scenario: Build includes the capture entry
- **WHEN** the app is built
- **THEN** the quick-capture entry point is emitted alongside the main app
