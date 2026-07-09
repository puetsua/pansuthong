## Context

`src/components/TaskEditor.tsx` is a single component that edits either a real task or a
template (`isTemplate = props.kind === "template"`). The 預估時間 (estimated seconds) field is
rendered in two mutually-exclusive places:

- Tasks / new drafts: inside the `{!canComplete && (...)}` block (~L771-781), above tags and notes.
- Templates: inside a trailing `{isTemplate && (...)}` block (~L879-889), which sits **after** the
  notes field (~L807-843) and the attachments field (~L845-877).

The result is that for templates the estimate appears at the very bottom of the form, below 備註.

## Goals / Non-Goals

**Goals:**
- In template mode, render the estimate field above the 備註 (notes) field.
- Keep the task-mode layout untouched.

**Non-Goals:**
- No change to field labels, i18n keys, validation (`estimatedSecondsFormError`), form state, or
  persisted data.
- No change to the task-editor estimate placement or the `TimeTracking` estimate.

## Decisions

- **Relocate the existing `{isTemplate && (...)}` estimate block** (including its `estimateError`
  warning) to immediately before the notes `<div className="te-field te-notes-field">`, rather than
  merging it into the task-mode `{!canComplete && ...}` block. Rationale: the two estimate inputs
  differ in wrapper (`<label>` vs task block context) and the template block is already
  self-contained, so moving it verbatim is the smallest, lowest-risk edit and avoids restructuring
  the conditional logic.
- Placement lands the estimate after the tags field and before notes, consistent with the
  scalar-fields-then-notes grouping.

## Risks / Trade-offs

- [A test asserts DOM/field order] → Check `TaskEditor.test.tsx`; update any order assertion to
  reflect the new position. Low risk — labels and roles are unchanged.
- [Estimate lands in a slightly different visual group] → Intended; it matches the task editor.

## Open Questions

- None.
