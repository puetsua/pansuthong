## Context

`buildIndexes` reads the clock itself (`src/state/indexes.ts:252`,
`computeTodayIso(new Date(), dsh)`) and `useDocument` memoizes the result on the
document alone (`src/state/store.ts:122`). The logical day is therefore a hidden,
non-reactive input: it is sampled once per index build, and index builds only happen
when `getDocument` returns a new object — which only happens on the `store-changed`
and `settings-changed` Tauri events. Nothing in `src/` drives a rebuild from time
passing; the two existing `setInterval` callers (`src/lib/useNow.ts`,
`src/components/TimeEstimateReminder.tsx`) feed unrelated UI.

Consumers all read the single `indexes.todayIso`, so they are consistent with each
other but consistently wrong after a rollover. That consistency is worth preserving —
the fix should keep one logical day for the whole app rather than letting each view
sample the clock on its own.

## Goals / Non-Goals

**Goals:**

- The logical day advances on its own while the app sits idle, at the configured
  `day_start_hour`.
- A boundary crossed while the machine slept or the window was hidden is picked up on
  resume.
- The logical day stays a single value shared by every view.
- The current day becomes an explicit input to `buildIndexes`, so rollover behavior is
  directly testable instead of depending on the ambient clock.

**Non-Goals:**

- No change to how `day_start_hour` maps a wall-clock time to a logical day
  (`todayIso` / `logicalDayOf` in `src/lib/dates.ts` are correct and stay as they are).
- No new Settings section or control.
- No Rust, model, schema, or persistence changes.
- Not a general "live clock" for the UI — relative timestamps and running-timer
  displays already have `useNow`; this is only the day boundary.

## Decisions

**1. A dedicated `useLogicalDay(dayStartHour)` hook owns the boundary, and
`useDocument` feeds its value into the memo.**

```ts
const dsh = doc ? dayStartHour(doc.settings) : DAY_START_HOUR_DEFAULT;
const today = useLogicalDay(dsh);
const indexes = useMemo(() => (doc ? buildIndexes(doc, today) : null), [doc, today]);
```

Keeping it in `useDocument` preserves the "one logical day for the whole app" property
for free: everything downstream already reads `indexes.todayIso`, so no view changes.

*Alternative rejected:* have each view call `todayIso()` on render. That re-introduces
per-view drift (two views could straddle the boundary mid-render) and would still not
re-render on its own.

**2. Poll every 60s and recompute the ISO string, setting state only when it differs;
additionally recompute on `visibilitychange`.**

The alternative is arithmetic: compute milliseconds until the next boundary and
schedule one exact `setTimeout`. That is tempting but brittle — it has to be re-derived
across DST transitions, manual clock changes, and `day_start_hour` edits, and
`setTimeout` does not reliably fire on schedule across OS sleep, so it needs a
correctness net anyway. A coarse poll that re-derives the answer from scratch is
immune to all of those: whatever the clock says, within 60s the app agrees with it.
Because the comparison is on the derived string, a tick that does not cross a boundary
is a no-op and triggers no re-render — the steady-state cost is one string
comparison per minute.

Up to 60s of staleness at the boundary is the trade-off, and it is not
user-perceptible for a day rollover.

`visibilitychange` handles the case the poll is worst at: the machine sleeps at 23:00
and wakes at 09:00, where timers are throttled or suspended. Recomputing the moment
the window becomes visible makes resume instant rather than up to a minute late. This
mirrors the existing SAF resume hook in `useDocument` (`src/state/store.ts:105`).

**3. `buildIndexes(doc, todayIso?)` takes the day as an optional parameter, defaulting
to the clock.**

The default keeps every existing `buildIndexes(doc)` call in the view tests working
unchanged. Passing it explicitly from `useDocument` is what makes the production path
reactive, and makes `indexes.test.ts` able to pin a day without faking global time.

*Alternative rejected:* making the parameter required. It would churn eight test files
for no behavioral gain.

## Risks / Trade-offs

- **Rollover rebuilds all indexes, including the O(n) sorts** → It happens once a day
  per open app. The same rebuild already happens on every task edit, which is far more
  frequent, so this adds no new worst case.

- **A task completed seconds before the boundary drops out of Today almost
  immediately** → This is the specified behavior (completions linger only for their
  logical day) and is exactly what makes an idle app correct in the morning. The
  60s poll granularity gives a small grace period rather than a hard cut.

- **Fake timers in tests could hang if the poll is not cleaned up** → The effect
  returns a disposer for both the interval and the listener, and `store.test.ts`
  restores real timers in `afterEach`.

- **A user manually moving the system clock backwards makes the day go backwards** →
  Correct: the derived answer follows the clock. No state is persisted from the
  logical day, so nothing is corrupted by moving in either direction.

## Migration Plan

None required. The change is pure derived-state reactivity: no persisted data, no
wire format, and no settings are touched, so the fix is live on next launch and
rollback is a straight revert.

## Open Questions

None.
