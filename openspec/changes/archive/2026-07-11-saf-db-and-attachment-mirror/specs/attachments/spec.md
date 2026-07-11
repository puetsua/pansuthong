## ADDED Requirements

### Requirement: Android SAF mirrors per-device attachment directories

The system SHALL treat `attachments_<device>/attachment_*` paths as first-class
synced blobs on Android folder sync, using the same relative path layout as
desktop cloud sync.

#### Scenario: SAF push includes subdirectory blobs
- **WHEN** a managed attachment is stored under `attachments_<device>/`
- **THEN** Android SAF push mirrors that relative path into the picked folder

#### Scenario: Legacy flat attachments still sync
- **WHEN** a legacy flat `attachment_*` file exists beside the data file
- **THEN** SAF push/pull still mirrors it at the top level of the folder
