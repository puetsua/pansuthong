## 1. Backend: serve attachment bytes

- [ ] 1.1 Add `read_attachment_bytes(data_path: &Path, relative: &str) -> Result<Vec<u8>>` in `commands.rs`, reusing `attachment_abs_path` (managed-path guard) then `std::fs::read`
- [ ] 1.2 Add `#[tauri::command] read_attachment(path, state) -> Result<tauri::ipc::Response>` wrapping the helper (`Response::new(bytes)`)
- [ ] 1.3 Register `read_attachment` in `lib.rs`; remove `resolve_attachment_path` command + its registration
- [ ] 1.4 Remove `allow_attachment_scope` fn and its two call sites (startup in `lib.rs`, `set_data_folder` in `commands.rs`)

## 2. Config: drop the dead asset protocol

- [ ] 2.1 Remove the `assetProtocol` block from `src-tauri/tauri.conf.json`
- [ ] 2.2 Drop `asset:` / `http://asset.localhost` from the CSP `img-src` (keep `blob:` and `data:`)

## 3. Frontend: blob URLs

- [ ] 3.1 In `src/lib/tauri.ts`, change `attachmentUrl` to `invoke<ArrayBuffer>("read_attachment", { path })` → `URL.createObjectURL(new Blob([buf]))`; drop the `convertFileSrc` import
- [ ] 3.2 In `TaskEditor.tsx` `AttachmentRow`, revoke the object URL on cleanup / path change
- [ ] 3.3 In `TaskEditor.tsx` `MarkdownImage`, revoke the object URL on cleanup / path change

## 4. Tests

- [ ] 4.1 Backend: `read_attachment_bytes` returns the exact bytes for a blob under a **non-ASCII** temp dir (the case the asset scope failed on)
- [ ] 4.2 Backend: `read_attachment_bytes` rejects `..`, backslash, and non-managed paths; errors (not panics) on a missing blob
- [ ] 4.3 Update the frontend `tauri.ts` test: `attachmentUrl` invokes `read_attachment` and yields a `blob:` URL (mock `invoke` + `URL.createObjectURL`)

## 5. Verify

- [ ] 5.1 `cargo test` (incl. new read tests) and `cargo check` pass
- [ ] 5.2 `npx tsc --noEmit` and `npx vitest run` pass
- [ ] 5.3 Build/run the desktop dev app (pointed at the non-ASCII Google Drive folder) and confirm attachment thumbnails and inline preview images now render
- [ ] 5.4 `openspec validate fix-attachment-image-display --strict` passes
