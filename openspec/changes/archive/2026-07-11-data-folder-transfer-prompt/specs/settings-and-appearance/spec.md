## ADDED Requirements

### Requirement: Data-folder transfer confirmation dialog

The Settings UI SHALL show a modal on desktop when the user changes or clears the
data folder and the operation would seed an empty target or leave a folder that
still holds this device's local payload. The modal SHALL use a titled heading
(for example "Change data folder?"), explain what will happen to this device's
data, and offer **Copy**, **Move**, and **Cancel**. Cancel SHALL appear on the
left of the action row; Copy SHALL be the primary (default-focused) action on the
right with Move beside it. The dialog is an approved Settings control for this
change; it SHALL stay minimal (title, explanation, and those three actions) and
SHALL NOT introduce a separate Settings section. Cancel SHALL abort without
invoking the folder-change command. Copy and Move SHALL invoke the backend with
the corresponding transfer mode. Android SAF folder sync UI is out of scope for
this requirement's v1 surface.

#### Scenario: Dialog appears before setting a new data folder
- **WHEN** the user picks a new data folder on desktop and the change would seed
  or leave own local data behind
- **THEN** a titled modal explains Copy vs Move and offers Copy, Move, and Cancel
  before `set_data_folder` runs

#### Scenario: Cancel does not change the folder
- **WHEN** the user chooses Cancel in the transfer dialog
- **THEN** `set_data_folder` / `clear_data_folder` is not invoked and the shown
  data location stays the same

#### Scenario: Copy invokes folder change with copy mode
- **WHEN** the user chooses Copy in the transfer dialog
- **THEN** the app invokes the data-folder command with transfer mode Copy

#### Scenario: Move invokes folder change with move mode
- **WHEN** the user chooses Move in the transfer dialog
- **THEN** the app invokes the data-folder command with transfer mode Move
