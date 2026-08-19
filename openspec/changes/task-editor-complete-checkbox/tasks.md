## 1. Editor control

- [x] 1.1 Replace the Complete/Reopen header button in `src/components/TaskEditor.tsx` with a native checkbox (`checked={isDoneTask}`, hidden unless `canComplete`).
- [x] 1.2 Update `toggleComplete` to save dirty edits then `setTaskDone`, stay open (no `onClose()`), and play `playCompletionSound()` when marking done.
- [x] 1.3 Add `taskEditor.toggle` in `en.json` and `zh-TW.json`; use it as the checkbox `aria-label`.

## 2. Styles

- [x] 2.1 Style the header checkbox like the Today-row box, including 22px at `max-width: 720px`.
- [x] 2.2 Remove unused `.te-complete` rules once the button is gone.

## 3. Tests and verify

- [x] 3.1 Rewrite `TaskEditor complete button` tests to the checkbox role: unchecked/checked, complete/reopen, save-before-toggle, no close, hidden for create/template.
- [x] 3.2 Run `npm test -- TaskEditor` and `npm run lint`.
- [x] 3.3 `openspec validate task-editor-complete-checkbox --strict` passes.
