## 1. Reorder the template estimate field

- [x] 1.1 In `src/components/TaskEditor.tsx`, cut the trailing `{isTemplate && (...)}` estimate block (the `<label className="te-field">` with `taskEditor.estimatedSeconds` plus its `estimateError` warning, ~L879-889).
- [x] 1.2 Paste it immediately before the notes field `<div className="te-field te-notes-field">` (~L807), so in template mode the estimate renders above 備註 and after the tags field.
- [x] 1.3 Confirm the task-mode estimate (`{!canComplete && ...}` block and `TimeTracking`) is untouched.

## 2. Verify

- [x] 2.1 Update `src/components/TaskEditor.test.tsx` if any test asserts field/DOM order in template mode; add/adjust an assertion that 預估時間 precedes 備註 for a template.
- [x] 2.2 Run `npm run lint` and `npm test` (or the project's test command) and confirm they pass.
- [x] 2.3 Manually open a template in the dev build and confirm 預估時間 now appears above 備註.
