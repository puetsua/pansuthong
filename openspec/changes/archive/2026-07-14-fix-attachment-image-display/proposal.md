## Why

Image attachments do not display in the app (broken-image `🔗💔` in the notes
preview, no thumbnail in the attachment list) when the data folder lives on a path
the OS asset protocol can't scope-match — notably a **Google Drive File Stream**
folder and/or a path with **non-ASCII characters** (e.g. `…\マイドライブ\…`). The
blobs are written correctly and are valid; only the *display* fails.

Root cause: images are shown via Tauri's asset protocol (`convertFileSrc` + a
runtime allow-scope added in #115). `Scope::is_allowed` calls `std::fs::canonicalize`
on both the allow-pattern's parent and every requested file, then glob-matches them.
On a virtual/reparse-pointed cloud filesystem with a non-ASCII path, that
canonicalize+glob chain fails, so the scope denies the request and the `<img>` never
loads. Plain `std::fs::read` of the same absolute path works fine.

## What Changes

- Serve attachment image previews by **reading the blob bytes through an IPC command**
  and rendering them as a `blob:` URL, instead of the asset protocol. This removes the
  canonicalize/glob/scope dependency entirely, so images display regardless of the data
  folder's path form (non-ASCII, cloud reparse points, network paths).
- Add backend `read_attachment` command (validated + path-safe, reusing the existing
  managed-path guard) returning the blob bytes.
- Frontend `api.attachmentUrl` now builds a `blob:` URL from those bytes; the two
  consumers (attachment row thumbnail, inline markdown image) revoke it on cleanup.
- **Remove the now-unused asset-protocol machinery**: `resolve_attachment_path`, the
  runtime `allow_attachment_scope` (its startup + `set_data_folder` calls), the static
  `assetProtocol` scope in `tauri.conf.json`, and the `asset:` entries in the CSP. This
  also eliminates the file-path-based asset surface the #115 hardening was guarding.
- `reveal_attachment` (open/reveal via the opener plugin) is unaffected.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `attachments`: add a "Displaying image attachments" requirement — image previews
  render from the stored blob's bytes and do not depend on the OS path form.

## Impact

- Backend: `src-tauri/src/commands.rs` (`read_attachment` added, `resolve_attachment_path`
  removed), `src-tauri/src/lib.rs` (`allow_attachment_scope` removed; handler registration),
  `src-tauri/tauri.conf.json` (assetProtocol + CSP).
- Frontend: `src/lib/tauri.ts` (`attachmentUrl` via bytes → blob URL; drop `convertFileSrc`),
  `src/components/TaskEditor.tsx` (revoke blob URLs on cleanup).
- No data-model or on-disk change; fully backward compatible.
