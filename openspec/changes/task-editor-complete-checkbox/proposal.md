## Why

The task editor marks a task done with a text **Complete** / **Reopen** button, while Today (and every other list) uses a checkbox. Completing from the modal should use the same control so the two surfaces match (#161).

## What Changes

- Replace the task editor header's Complete / Reopen button with a checkbox that matches the Today-row control: unchecked when the task is open, checked when it is done.
- Checking the box completes the task; unchecking reopens it. The control stays hidden when creating a task or editing a template.
- No model, API, Settings, or persistence changes.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `task-management`: add a requirement that the task editor's completion control is a checkbox matching the list-row control, shown only for existing tasks.

## Impact

- `src/components/TaskEditor.tsx` — header control and `toggleComplete` close-on-toggle behavior.
- `src/styles/global.css` — `.te-complete` button styles vs checkbox sizing.
- `src/i18n/locales/en.json`, `src/i18n/locales/zh-TW.json` — Complete/Reopen button labels vs checkbox aria-label.
- `src/components/TaskEditor.test.tsx` — `TaskEditor complete button` cases.
- No Rust, schema, or Settings changes.
