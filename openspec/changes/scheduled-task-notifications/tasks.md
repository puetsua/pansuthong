## 1. Scheduling logic

- [x] 1.1 Add `src/lib/scheduledNotifications.ts` (arrival kind/moment, due detection, dedupe keys, notification id hash) with unit tests
- [x] 1.2 Add device-local notified-key persistence (localStorage)

## 2. Notifier component

- [x] 2.1 Add `ScheduledTaskNotifier` (permission, poll, resume check, OS schedule sync) and mount in `App`
- [x] 2.2 Add en and zh-TW strings for start/due arrival titles

## 3. Verification

- [x] 3.1 Component tests for permission + notify + dedupe
- [x] 3.2 `npm test -- scheduledNotifications ScheduledTaskNotifier` and `npm run build`
