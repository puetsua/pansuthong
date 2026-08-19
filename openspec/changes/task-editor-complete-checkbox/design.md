## Context

`TaskEditor` is the shared modal for tasks and templates. For an existing task it currently puts a text **Complete** / **Reopen** button in `.te-title-actions` (`src/components/TaskEditor.tsx`). That button runs `toggleComplete`: save dirty fields if needed, `api.setTaskDone`, then `onClose()`.

List rows (`TaskRow`) use a native checkbox on the right. Checking it calls `api.setTaskDone`, plays the completion sound on done, and leaves the row in place. The two surfaces disagree (#161).

`canComplete` is already `!creating && !isTemplate`. Completion state is `completed_at` via `isDone(task)` from `props.task`, not from editor form state.

## Goals / Non-Goals

**Goals:**
- Replace the header button with a native checkbox that looks and behaves like the Today-row control.
- Checked ↔ done, unchecked ↔ open. Hide it when creating or editing a template.
- Keep save-dirty-then-toggle so unsaved title/dates/estimate are not discarded.

**Non-Goals:**
- No change to `set_task_done`, archival, or view membership.
- No change to the row checkbox, archived Restore button, or ghost-row complete action.
- No Settings controls. No model/schema/i18n product strings beyond the control label.

## Decisions

- **Native `<input type="checkbox">` in the same header slot**, not a restyled button. Same control as `TaskRow` (`checked={isDone(task)}`, `aria-label` from a toggle string). Alternatives considered: keep a button with checkbox styling (still reads as a command, not state); put the box next to the title field (farther from the current Complete location and from the row’s trailing checkbox).
- **Stay open after toggle.** Closing on check is button semantics: the user never sees the box become checked. The row stays put; the editor should too. `isDoneTask` already reads `props.task`, so a store refresh updates the box without local done state.
- **Keep save-then-toggle; drop `onClose()`.** Reuse `toggleComplete` validation (empty title, date/estimate errors). On success, play `playCompletionSound()` when marking done (same as the row). On failure the controlled checkbox stays on the last persisted `props.task`.
- **Touch size:** reuse the row’s 22px checkbox at `max-width: 720px`. Remove `.te-complete` once unused.
- **Copy:** stop using `taskEditor.complete` / `taskEditor.reopen` on this control. Add `taskEditor.toggle` (mirroring `taskRow.toggle`) so the editor namespace stays self-contained. Leave unused complete/reopen keys unless nothing else references them.

## Risks / Trade-offs

- [Users who treated Complete as “done + dismiss” now have an extra close tap] → Accept; matches the row and makes the checked state visible. Escape / ✕ still close.
- [Store update lags and the box snaps back] → Controlled from `props.task` like today; disable while `busy`. Same failure behavior as the old button.
- [Tests look up Complete/Reopen button roles] → Rewrite `TaskEditor complete button` in `TaskEditor.test.tsx` to the checkbox role and assert `onClose` is not called.

## Migration Plan

UI-only. Deploy with the usual frontend release; no data migration or rollback beyond revert.

## Open Questions

- None. Close-vs-stay is decided: stay open.
