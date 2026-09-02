## MODIFIED Requirements

### Requirement: Tag creation

The system SHALL create a tag from a non-empty name and a valid hex color. When the caller does not supply a color, the system SHALL apply the active theme’s background (`--c-bg` for the current light/dark variant, including custom presets) as a `#rrggbb` hex, and SHALL apply the configured new-tag priority default. The chosen hex is stored on the tag and SHALL NOT change later when the theme changes.

#### Scenario: Blank name or bad color is rejected
- **WHEN** `add_tag` is called with an empty name or a non-hex color
- **THEN** the call fails with an invalid-input error and no tag is created

#### Scenario: New tag uses the active theme background
- **WHEN** the user creates a tag without picking a color (Tag editor, composer `#tag`, or task-editor create)
- **THEN** the tag is stored with the current theme’s `--c-bg` hex

## ADDED Requirements

### Requirement: Color picker includes the theme background

The tag color picker SHALL offer its static preset swatches plus the active theme background when that background is not already in the preset list, so the default new-tag color is always selectable as a swatch.

#### Scenario: Theme background already in the preset list
- **WHEN** the active background equals an existing preset swatch
- **THEN** that swatch is shown once and is marked active for a new tag

#### Scenario: Theme background missing from the preset list
- **WHEN** the active background is a hex that is not in the static presets (for example the built-in light `#f9fafb` or dark `#0f172a`)
- **THEN** the picker shows that hex as an additional swatch and a new tag starts with it selected
