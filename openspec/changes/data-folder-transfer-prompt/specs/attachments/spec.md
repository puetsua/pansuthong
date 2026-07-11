## ADDED Requirements

### Requirement: Own attachments follow folder relocate under transfer mode

When the data folder is relocated, the system SHALL transfer this device's
`attachments_<device>/` directory according to the user's Copy or Move choice.
On seed, the subdirectory SHALL be copied into the new folder so document
attachment paths remain resolvable. On adopt, the system MAY copy only
document-referenced managed paths that are missing under the new folder and
present under the old folder (fill-missing), and SHALL NOT overwrite existing
destination blobs. **Copy** SHALL leave the source `attachments_<device>/` tree
intact. **Move** SHALL remove this device's attachment subdirectory from the old
folder only after a successful transfer. The system SHALL NOT copy, move, or
delete peer `attachments_<other>/` trees. Failure mid-transfer SHALL NOT delete
source attachments; the system MAY warn and continue without rolling back a
successful document seed when only attachment copy fails under Copy (same class
as history sidecar warnings), but Move cleanup of the old tree MUST NOT run
unless the owned attachment transfer succeeded.

#### Scenario: Seed Copy places own attachment subdirectory
- **WHEN** `repoint` seeds an empty folder with transfer mode Copy and
  `attachments_<device>/` exists beside the previous data file
- **THEN** the new folder contains a copy of that subdirectory with the same
  relative blob paths and the previous folder still contains the original tree

#### Scenario: Seed Move removes own attachments from the old folder
- **WHEN** `repoint` seeds an empty folder with transfer mode Move and own
  attachment transfer succeeds
- **THEN** the new folder contains the attachment subdirectory and the previous
  folder no longer contains `attachments_<device>/`

#### Scenario: Peer attachment dirs are never transferred or deleted
- **WHEN** the previous folder also holds `attachments_<other>/` for a peer device
- **THEN** Copy and Move leave that peer directory unchanged at the old folder
  and do not create a peer attachment directory from it at the new folder

#### Scenario: Same-folder repoint is a no-op for attachments
- **WHEN** the new data path shares the same parent directory as the old path
- **THEN** no attachment directory copy or cleanup is attempted

#### Scenario: Failed Move transfer does not delete source attachments
- **WHEN** Move is chosen and copying own attachments to the new folder fails
- **THEN** the previous folder's `attachments_<device>/` tree remains intact
