## ADDED Requirements

### Requirement: AFK while a timer is running

The system SHALL detect when the user has been away from keyboard and mouse
while at least one timer is running on desktop, using OS last-input idle time.
The AFK span SHALL begin at the last input instant, once idle time has crossed a
fixed threshold (five minutes). Android SHALL NOT prompt. When last-input idle
time is unavailable, the system SHALL NOT prompt.

When the user returns from AFK while a timer is still running, or when they stop
a running timer after a long AFK without having answered a prompt, the system
SHALL show an in-app dialog (not an OS notification and not the untracked-idle
assignment UI) that states how long the AFK span was and offers Keep or Discard.
The dialog SHALL require an explicit choice.

**Keep** SHALL leave the AFK duration in each running interval. If the dialog was
shown because the user returned, timers SHALL continue. If it was shown because
they hit Stop, that task's timer SHALL then stop at the current time (AFK
included).

**Discard** SHALL apply to every task that had a running interval during the AFK
span: close each open interval at the AFK start, or delete the entry when it
started at or after AFK start (no zero-length interval). After Discard, no open
interval SHALL remain.

#### Scenario: Return from AFK prompts keep or discard

- **WHEN** at least one timer is running
- **AND** OS last-input idle time has exceeded the AFK threshold
- **AND** the user provides input again
- **THEN** an in-app dialog shows the AFK duration with Keep and Discard

#### Scenario: Keep leaves AFK time and continues the timer

- **WHEN** the user returns from AFK while a timer is running
- **AND** they choose Keep
- **THEN** the running interval is unchanged
- **AND** the timer continues

#### Scenario: Discard stops at AFK start

- **WHEN** the user returns from AFK while a timer is running
- **AND** they choose Discard
- **THEN** each running interval ends at the AFK start
- **AND** no open interval remains

#### Scenario: Discard drops an entry that started after AFK began

- **WHEN** a running entry's start is at or after the AFK start
- **AND** the user chooses Discard
- **THEN** that entry is deleted rather than stored with zero length

#### Scenario: Several running timers share one choice

- **WHEN** more than one task is timing during the AFK span
- **AND** the user chooses Keep or Discard
- **THEN** that choice is applied to each of those tasks

#### Scenario: Stop after AFK still prompts

- **WHEN** a timer is running and OS last-input idle time has exceeded the AFK threshold
- **AND** the user hits Stop before answering a keep/discard prompt
- **THEN** the same dialog is shown instead of closing the interval at now
- **AND** Keep then stops that task at now with the AFK span included
- **AND** Discard still closes every running interval at the AFK start

#### Scenario: Android and unavailable idle do not prompt

- **WHEN** the app runs on Android, or last-input idle time cannot be read
- **THEN** no AFK-while-running dialog is shown
- **AND** Start/Stop behave as they do today
