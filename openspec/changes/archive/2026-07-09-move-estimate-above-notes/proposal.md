## Why

In the template editor (`TaskEditor` in template mode), the 預估時間 (estimated time) field
renders *below* the 備註 (notes) field — after notes and attachments, tucked at the bottom of
the form. This is inconsistent with the task editor, where the estimate sits with the other
scalar fields above notes, and it makes a short, frequently-set field easy to miss beneath the
large notes/attachments area.

## What Changes

- Move the template-only 預估時間 (estimated seconds) field so it renders **above** the 備註
  (notes) field in the template editor, matching the field ordering used for tasks.
- No change to labels, validation, state, or persisted data — this is a layout reordering only.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `templates-and-recurrence`: adds a requirement pinning the template editor's field order so the
  estimated-time field appears above the notes field.

## Impact

- `src/components/TaskEditor.tsx` — relocate the `{isTemplate && (...)}` estimate block from
  below the notes field to above it.
- Possibly `src/components/TaskEditor.test.tsx` if a test asserts field order.
- No backend, model, i18n, or data-format changes.
