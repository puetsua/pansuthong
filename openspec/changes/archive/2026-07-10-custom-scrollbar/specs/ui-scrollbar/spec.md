## ADDED Requirements

### Requirement: Themed scrollbar chrome

The system SHALL render scrollbars in scrollable app surfaces using the active theme’s color tokens so track and thumb match the current light, dark, or custom preset, rather than relying solely on the host OS default scrollbar appearance.

#### Scenario: Dark theme scrollbar matches surfaces
- **WHEN** the active theme is dark (or a dark custom preset) and a region has overflow content
- **THEN** the scrollbar track and thumb use theme-derived colors that visually belong with the surrounding surface (not an unthemed light OS bar)

#### Scenario: Theme switch updates scrollbar colors
- **WHEN** the user switches theme mode or preset while a scrollable region is visible
- **THEN** scrollbar colors update with the new theme tokens without requiring an app restart

### Requirement: Thin dual-axis scrollbars

The system SHALL apply a thin scrollbar style to both vertical and horizontal overflow, preserving native scroll interaction (pointer drag, wheel, touch, and keyboard).

#### Scenario: Vertical list overflow
- **WHEN** a task list or similar vertical container overflows its viewport
- **THEN** a thin themed vertical scrollbar appears and the user can still scroll with wheel, drag, and keyboard as before

#### Scenario: Horizontal overflow elsewhere
- **WHEN** a non-heatmap region scrolls horizontally
- **THEN** a thin themed horizontal scrollbar appears with the same visual language as the vertical bar

### Requirement: No scrollbar preference in Settings

The system SHALL NOT introduce a Settings control or persisted preference for scrollbar appearance in this change; themed scrollbars are always applied with the active theme.

#### Scenario: Settings has no scrollbar toggle
- **WHEN** the user opens Settings
- **THEN** there is no new control to enable, disable, or recolor the custom scrollbar
