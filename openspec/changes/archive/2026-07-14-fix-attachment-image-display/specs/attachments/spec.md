## ADDED Requirements

### Requirement: Displaying image attachments

The system SHALL render image attachment previews (the attachment-list thumbnail and
inline notes-preview images) from the stored blob's bytes, delivered to the webview
independently of the operating-system path form. Preview display SHALL NOT depend on
the asset-protocol path scope, so images render correctly when the data folder lives on
a path the asset scope cannot match — including non-ASCII paths and virtual/cloud
(reparse-pointed) filesystems. Byte delivery SHALL enforce the same managed-path guard
as every other attachment read (rejecting `..`, backslashes, and non-managed paths).

#### Scenario: Image renders from a non-ASCII data folder path
- **WHEN** the data folder path contains non-ASCII characters and a task has an image attachment
- **THEN** its thumbnail and inline preview render from the blob's bytes rather than showing a broken-image marker

#### Scenario: Byte read rejects an escaping path
- **WHEN** an attachment byte-read is requested for a path containing `..` or a backslash, or a non-managed path
- **THEN** it is rejected with an invalid-input error and no bytes are returned

#### Scenario: Missing blob surfaces as unavailable, not a crash
- **WHEN** a referenced attachment blob no longer exists on disk
- **THEN** the byte read fails and the preview shows the unavailable/broken marker instead of erroring the editor
