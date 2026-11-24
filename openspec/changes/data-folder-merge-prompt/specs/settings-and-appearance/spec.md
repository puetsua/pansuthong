## MODIFIED Requirements

### Requirement: Data-folder transfer confirmation dialog

The Settings UI SHALL show a modal on desktop when the user changes or clears the
data folder. Before showing it, the UI SHALL inspect the target folder and show one
of two variants. Each variant SHALL stay minimal: a titled heading, one short
sentence, a muted footnote stating that other devices' files in a shared folder are
never touched, and three actions. Cancel SHALL appear on the left of the action
row; the primary (default-focused) action SHALL be on the right with the secondary
action beside it. The dialog is an approved Settings control for this capability
and SHALL NOT introduce a separate Settings section. Cancel SHALL abort without
invoking the folder-change command. Android SAF folder sync UI is out of scope for
this requirement's v1 surface.

- **Target without Pansuthong data**: title asks whether to switch to the new
  folder; the sentence says the data will be copied there and asks whether to keep
  it in the old folder too. Actions: **Keep both** (primary, transfer mode Copy),
  **Remove from old** (transfer mode Move), **Cancel**.
- **Target with Pansuthong data**: title states the folder already has Pansuthong
  data; the sentence asks whether to merge it with the current tasks and says the
  old folder is left as is. Actions: **Merge** (primary, transfer mode Merge),
  **Use folder's data** (transfer mode Adopt), **Cancel**.

If the inspection fails, the UI SHALL show the error and SHALL NOT open the dialog
or change the folder. If the inspection reports the folder already in use, the UI
SHALL NOT show the dialog: picking it SHALL do nothing, and clearing SHALL invoke
`clear_data_folder` with transfer mode Merge so the custom-folder setting is
dropped without moving or deleting files.

#### Scenario: Re-picking the current folder is a no-op
- **WHEN** the user picks the folder that is already in use
- **THEN** no dialog is shown and no data-folder command is invoked

#### Scenario: Clearing when the custom folder is the default one
- **WHEN** the user chooses Use default location and the default location is the
  folder already in use
- **THEN** no dialog is shown and `clear_data_folder` is invoked with transfer mode Merge

#### Scenario: Empty target shows the keep-both variant
- **WHEN** the user picks a folder on desktop that has no Pansuthong data
- **THEN** the dialog offers Keep both, Remove from old, and Cancel before
  `set_data_folder` runs

#### Scenario: Target with data shows the merge variant
- **WHEN** the user picks a folder on desktop that already has Pansuthong data
- **THEN** the dialog offers Merge, Use folder's data, and Cancel, and does not
  offer Keep both or Remove from old

#### Scenario: Clearing inspects the default location
- **WHEN** the user chooses Use default location
- **THEN** the default location is inspected and the matching dialog variant is shown

#### Scenario: Cancel does not change the folder
- **WHEN** the user chooses Cancel in either dialog variant
- **THEN** `set_data_folder` / `clear_data_folder` is not invoked and the shown
  data location stays the same

#### Scenario: Keep both invokes folder change with copy mode
- **WHEN** the user chooses Keep both
- **THEN** the app invokes the data-folder command with transfer mode Copy

#### Scenario: Remove from old invokes folder change with move mode
- **WHEN** the user chooses Remove from old
- **THEN** the app invokes the data-folder command with transfer mode Move

#### Scenario: Merge invokes folder change with merge mode
- **WHEN** the user chooses Merge
- **THEN** the app invokes the data-folder command with transfer mode Merge

#### Scenario: Use folder's data invokes folder change with adopt mode
- **WHEN** the user chooses Use folder's data
- **THEN** the app invokes the data-folder command with transfer mode Adopt
