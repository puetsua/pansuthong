## Context

Attachment images are the only thing served through Tauri's asset protocol
(`convertFileSrc`). `api.attachmentUrl(path)` invokes `resolve_attachment_path` to get
the absolute path, then `convertFileSrc` turns it into an `asset://`/`http://asset.localhost`
URL. For a **custom** data folder the app allows that folder into the asset scope at
runtime via `allow_attachment_scope` (glob `allow_file` patterns, added in #115).
`Scope::is_allowed` canonicalizes both the pattern parent and the requested path and
glob-matches them; on a Google Drive File Stream / non-ASCII path this fails, denying
every attachment image. `std::fs::read` of the same absolute path works (proven: the app
already writes, validates, clones, and reveals these blobs via std file IO).

## Goals / Non-Goals

**Goals:**
- Image previews display regardless of the data folder's OS path form.
- Keep the existing managed-path safety guard on reads.
- Remove the now-dead asset-protocol scope surface.

**Non-Goals:**
- No change to attach/remove/merge/GC, to `reveal_attachment`, or to the on-disk layout.
- Not introducing a streaming range protocol — a single read per preview is sufficient
  for the images actually rendered inline.

## Decisions

**Deliver blob bytes over IPC and render as an object URL, not via the asset protocol.**
Add `read_attachment(path) -> bytes`; the frontend wraps the bytes in a `Blob` and uses
`URL.createObjectURL`. Rationale: `std::fs::read` on the absolute path has no
canonicalize/glob/scope dependency, so it is immune to the non-ASCII / cloud-reparse
failure. The bytes come back as a `tauri::ipc::Response` (raw → `ArrayBuffer` in JS),
avoiding the ~33% bloat of a JSON number array or base64. The testable core is a
`read_attachment_bytes(data_path, rel) -> Result<Vec<u8>>` helper reusing
`attachment_abs_path` (which already enforces the managed-path guard); the command is a
thin wrapper returning `Response::new(bytes)`.

**Blob type is left unset.** `<img>` sniffs image bytes from a typeless object URL, so no
mime needs threading through `attachmentUrl` (which only has the path). The consumers must
`URL.revokeObjectURL` on unmount / path change to avoid leaks — the one behavioral
obligation object URLs add over the old asset URLs.

**Remove the asset protocol entirely.** With `convertFileSrc` gone, `resolve_attachment_path`,
`allow_attachment_scope`, the static `assetProtocol` config, and the `asset:` CSP entries
are dead. Removing them deletes the fragile scope code and the file-path asset surface #115
was hardening, rather than leaving broken-but-unused machinery. `blob:` stays in the CSP
`img-src` (already present).

## Risks / Trade-offs

- [Large images load fully into memory instead of streaming] → Acceptable: only images
  rendered inline are read, and typical attachments are small; the size ceiling already
  bounds blobs. A future range protocol can revisit if huge images become common.
- [Object-URL leak if not revoked] → Mitigated: both consumers revoke on cleanup and when
  `path` changes; the lightbox reuses the mounted consumer's URL while open.
- [Hard to GUI-verify here (webview automation bridge times out)] → Mitigated by a backend
  integration test that reads a blob from a **non-ASCII** temp dir — the exact case the
  asset scope failed on — plus build + existing suites.

## Migration Plan

Single change on `main`, then release. No data migration; rollback is a revert. Verify with
`cargo test` (incl. a non-ASCII-path read test), `tsc`, `vitest`, and an app build.
