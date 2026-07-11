## ADDED Requirements

### Requirement: Own attachments follow a seeded folder relocate

When the data folder is relocated to an empty target (seed path), the system SHALL
copy this device's `attachments_<device>/` directory from the previous data folder
into the new folder so document attachment paths remain resolvable. The copy SHALL
leave the source directory intact and SHALL NOT copy peer `attachments_<other>/`
trees. Failure to copy attachments SHALL NOT roll back a successful document seed;
the system MAY warn and continue (same class of behavior as history sidecar copy).

#### Scenario: Seed copies device attachment subdirectory
- **WHEN** `repoint` seeds an empty folder and `attachments_<device>/` exists beside
  the previous data file
- **THEN** the new folder contains a copy of that subdirectory with the same
  relative blob paths

#### Scenario: Seed leaves source attachments in place
- **WHEN** own attachments are copied during a seed relocate
- **THEN** the previous folder still contains the original `attachments_<device>/`
  tree

#### Scenario: Same-folder repoint is a no-op for attachments
- **WHEN** the new data path shares the same parent directory as the old path
- **THEN** no attachment directory copy is attempted
