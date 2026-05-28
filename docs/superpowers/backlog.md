# Pansutong — Deferred features

Items intentionally left out of v1. Each was discussed and a v1-cut decision was made; the rationale is recorded so we don't re-argue.

## Task model

### Subtasks
Nested checklist inside a task.
- **Why deferred:** Adds a recursive structure to the JSON, a tree-flatten in every derived index, and UI for nesting/indentation. The "life + work hub" use cases we saw (errands, code reviews, calls) don't need nesting. Almost any subtask can be a separate task with the same tag.
- **Re-evaluate when:** Real usage shows a project where parent/child relationships matter enough that flat siblings feel wrong.

### Recurring tasks
"Every Monday", "every weekday", "every month on the 15th".
- **Why deferred:** Needs a rule engine (parse / serialize iCalendar RRULE or equivalent), an instance-spawning mechanism, and a decision about completion semantics (does completing today's instance affect next week's?). Non-trivial.
- **Re-evaluate when:** Habit/chore tracking becomes a primary use case. Until then, manually re-add.

### Time-of-day on dates
Due/scheduled dates currently `YYYY-MM-DD` only.
- **Why deferred:** YAGNI for v1. Times can live in notes (`due 5pm`). Adding `due_at` (ISO datetime) later is a non-breaking schema migration — old date-only entries still parse.
- **Re-evaluate when:** Reminders become needed (times and reminders are tightly coupled).

## Sync & multi-device

### CRDT / auto-merge
Silent merging of concurrent edits across devices.
- **Why deferred:** The Syncthing conflict-file UI handles the rare same-minute collision interactively. CRDTs require event sourcing, vector clocks, and a much more complex storage format.
- **Re-evaluate when:** Same-minute conflicts become routine (i.e., real-time collaborative editing).

### Background sync on Android with the app closed
- **Why deferred:** Syncthing for Android already handles transport in the background; Pansutong doesn't need to. Adding a Foreground Service would mean a persistent notification, battery-optimization exemptions, and another permissions ask.
- **Re-evaluate when:** Users start reporting "I added a task on my phone and it didn't sync until I opened the app on the laptop."

## Reminders & notifications

### Push notifications when a scheduled task arrives
- **Why deferred:** Requires a notification permission, a scheduling layer that survives device sleep, and a story for what happens when the file is closed/inactive. Tied to the time-of-day question above.
- **Re-evaluate when:** Time-of-day dates ship.

## Collaboration

### Multi-user / sharing a list
- **Why deferred:** This is a single-user app over personal device sync. Sharing changes the data model (per-user permissions, attribution on edits) and the sync model (Syncthing between your devices is fine; Syncthing between people is not).
- **Re-evaluate when:** Probably never — this is a different product.

## UI & polish

### Theme customization beyond `auto / light / dark`
Accent color, custom CSS, etc.
- **Why deferred:** Cosmetic. Ship working basics first.
- **Re-evaluate when:** People actually ask.

### History view of past changes
Audit log of every mutation.
- **Why deferred:** Not in the file format. Adding it later means deciding storage location (separate `history.jsonl`?) and retention.
- **Re-evaluate when:** A real "I deleted something I shouldn't have" incident happens.

## Quick capture

### Foreground-service notification on Android for capture
Persistent notification with an inline input field.
- **Why deferred:** Heavy (foreground service permission, notification channel, battery-optimization exemptions) for what the share intent + home-screen widget already cover.
- **Re-evaluate when:** Share intent + widget prove insufficient for actual capture patterns.
