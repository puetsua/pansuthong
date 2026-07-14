## MODIFIED Requirements

### Requirement: Watcher and polling fallback

The system SHALL detect data-file changes via a filesystem watcher and also poll
periodically, because native FS events are unreliable on cloud-sync folders. Freshness
is guaranteed by these automatic mechanisms alone; there is no user-facing manual
"sync now" trigger.

#### Scenario: Watcher detects a peer change
- **WHEN** a peer replica in the data folder changes on disk
- **THEN** the filesystem watcher re-reads it and, if the merged document changed, a store-changed event is emitted

#### Scenario: Polling picks up changes the watcher missed
- **WHEN** a cloud-sync client pulls in a peer change without firing a native FS event
- **THEN** the periodic poll re-reads the data file and, if the merged document changed, a store-changed event is emitted
