## ADDED Requirements

### Requirement: Task editor completion control

The task editor SHALL expose completion as a checkbox that matches the list-row control. The checkbox SHALL appear only when editing an existing task. Checking it SHALL mark the task done; unchecking it SHALL reopen the task. The editor SHALL remain open after the toggle.

#### Scenario: Open task shows an unchecked checkbox

- **WHEN** the user opens an existing incomplete task
- **THEN** the editor header shows an unchecked checkbox and no Complete or Reopen text button

#### Scenario: Done task shows a checked checkbox

- **WHEN** the user opens an existing completed task
- **THEN** the editor header checkbox is checked

#### Scenario: Checking the box completes the task

- **WHEN** the user checks the editor completion checkbox
- **THEN** the task is marked done and the editor stays open with the checkbox checked

#### Scenario: Completed task lingers until the view is left

- **WHEN** the user checks the editor completion checkbox on a list view
- **THEN** the task stays in that view (de-emphasised) until the user navigates away, and the editor remains open

#### Scenario: Unchecking the box reopens the task

- **WHEN** the user unchecks the editor completion checkbox
- **THEN** the task is reopened and the checkbox is unchecked

#### Scenario: Hidden when creating or editing a template

- **WHEN** the editor is creating a task or editing a template
- **THEN** no completion checkbox is shown
