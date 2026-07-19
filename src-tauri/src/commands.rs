use crate::config::{ConfigState, Settings, ThemePreset};
use crate::conflict::{apply_decisions, diff_tasks, tags_to_merge, Decision, TaskDiff};
use crate::error::{AppError, Result};
use crate::history::HistoryEntry;
use crate::model::{
    new_attachment_id, new_tag_id, new_task_id, new_time_entry_id, now_ms, Attachment, Recurrence,
    Tag, Task, TemplateTask, TimeEntry, Tombstone, YearlyDate,
};
use crate::store::AppState;
use crate::sync::scan_conflict_files;
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

const STORE_CHANGED: &str = "store-changed";
/// Device-local settings (`config.json`) changed. Frontend reloads the document
/// view so `settings` stay in sync, but Android must NOT schedule a SAF push —
/// settings are not synced and a push would only re-hash / re-open the folder.
const SETTINGS_CHANGED: &str = "settings-changed";

fn emit_changed(app: &AppHandle) {
    let _ = app.emit(STORE_CHANGED, ());
}

fn emit_settings_changed(app: &AppHandle) {
    let _ = app.emit(SETTINGS_CHANGED, ());
}

/// Wire shape the frontend consumes: the synced document (tasks + tags) with the
/// device-local `settings` spliced in. Settings live in `config.json`, not the
/// synced `Document`, but the UI still receives them in one payload.
#[derive(Serialize)]
pub struct DocumentView {
    version: u32,
    // ISO-8601 local time with offset (second precision), consistent with the
    // on-disk file and the frontend's string-typed `last_modified`. Omitted when 0
    // (never edited), so the UI shows an em dash instead of a 1970 date.
    #[serde(
        skip_serializing_if = "crate::model::is_zero",
        serialize_with = "crate::model::iso_secs::serialize"
    )]
    last_modified: i64,
    settings: Settings,
    tags: Vec<Tag>,
    tasks: Vec<Task>,
    template_tasks: Vec<TemplateTask>,
}

fn document_view(state: &AppState, config: &ConfigState) -> DocumentView {
    state.read(|d| DocumentView {
        version: d.version,
        last_modified: d.last_modified,
        settings: config.settings(),
        tags: d.tags.clone(),
        tasks: d.tasks.clone(),
        template_tasks: d.template_tasks.clone(),
    })
}

#[tauri::command]
pub fn get_document(state: State<'_, AppState>, config: State<'_, ConfigState>) -> DocumentView {
    document_view(&state, &config)
}

/// Reveal the initially hidden main window only after the frontend has painted
/// its first meaningful state. The invoking window is used so this remains
/// correct for the desktop main window and the mobile webview.
#[tauri::command]
pub fn show_main_window(window: tauri::WebviewWindow) -> std::result::Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_history(state: State<'_, AppState>) -> Result<Vec<HistoryEntry>> {
    crate::history::read_all_history(&state.path())
}

#[derive(Deserialize)]
pub struct NewTaskInput {
    pub title: String,
    #[serde(default)]
    pub due_date: Option<NaiveDate>,
    #[serde(default)]
    pub due_time: Option<String>,
    #[serde(default)]
    pub start_date: Option<NaiveDate>,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub estimated_seconds: Option<i64>,
}

/// Reject a time-of-day that isn't a valid "HH:MM" (#93). `None` (all-day) is
/// always fine. Keeps malformed times from ever reaching tasks.json.
fn validate_time(t: Option<&str>) -> Result<()> {
    if let Some(s) = t {
        chrono::NaiveTime::parse_from_str(s, "%H:%M")
            .map_err(|_| AppError::Invalid(format!("time must be HH:MM, got {s:?}")))?;
    }
    Ok(())
}

/// Estimated effort is optional, but when present it must be a positive whole
/// number of seconds. The cap preserves the old 100,000-minute maximum while
/// allowing explicit second-level estimates such as `50s`.
const ESTIMATED_SECONDS_MAX: i64 = 100_000 * 60;

fn validate_estimated_seconds(seconds: Option<i64>) -> Result<()> {
    if let Some(n) = seconds {
        if !(1..=ESTIMATED_SECONDS_MAX).contains(&n) {
            return Err(AppError::Invalid(format!(
                "estimated seconds must be 1..={ESTIMATED_SECONDS_MAX}, got {n}"
            )));
        }
    }
    Ok(())
}

/// Drop tag ids that don't exist in the document so tasks never persist dangling
/// tag references (which silently behave as untagged, landing in Inbox at
/// priority 0) (#40).
fn retain_known_tags(ids: Vec<String>, tags: &[Tag]) -> Vec<String> {
    ids.into_iter()
        .filter(|id| tags.iter().any(|t| &t.id == id))
        .collect()
}

const ATTACHMENT_PREFIX: &str = "attachment_";

fn attachment_err(e: impl std::fmt::Display) -> AppError {
    AppError::Invalid(format!("attachment: {e}"))
}

fn safe_attachment_name(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('_');
        }
    }
    let trimmed = out.trim_matches(['.', '_', '-']).to_string();
    if trimmed.is_empty() {
        "file".into()
    } else {
        trimmed.chars().take(96).collect()
    }
}

fn managed_attachment_name(id: &str, original_name: &str) -> String {
    format!(
        "{ATTACHMENT_PREFIX}{id}_{}",
        safe_attachment_name(original_name)
    )
}

/// A managed blob filename: `attachment_<id>_<safe-name>`, no path separators.
fn is_managed_attachment_file(name: &str) -> bool {
    name.starts_with(ATTACHMENT_PREFIX) && !name.contains('/') && !name.contains('\\')
}

/// A per-device attachment subdirectory: `attachments_<seg>` where `<seg>` is the
/// sanitized device-id charset (see `config::attachments_dir_name`).
pub(crate) fn is_attachments_subdir(dir: &str) -> bool {
    dir.len() > "attachments_".len()
        && dir.starts_with("attachments_")
        && dir.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Accept a stored attachment path: either a legacy flat `attachment_*` (no
/// separators) or the new `attachments_<device>/attachment_*` form (exactly one
/// `/`). Rejects `..` and backslashes so a crafted IPC/markdown reference can
/// never escape the data folder. This is the single guard used by
/// `attachment_abs_path`, `validate_attachments`, and `resolve_attachment_path`.
pub(crate) fn is_attachment_filename(name: &str) -> bool {
    if name.contains('\\') || name.contains("..") {
        return false;
    }
    match name.split_once('/') {
        Some((dir, file)) => is_attachments_subdir(dir) && is_managed_attachment_file(file),
        None => is_managed_attachment_file(name),
    }
}

/// Relative paths of managed attachment blobs under `dir`: legacy flat
/// `attachment_*` files and one level of `attachments_*/attachment_*`.
pub(crate) fn list_managed_attachment_rels(dir: &Path) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(|n| n.to_string()) else {
            continue;
        };
        let file_type = entry.file_type()?;
        if file_type.is_file() {
            if is_attachment_filename(&name) {
                out.push(name);
            }
        } else if file_type.is_dir() && is_attachments_subdir(&name) {
            for inner in std::fs::read_dir(entry.path())? {
                let inner = inner?;
                if !inner.file_type()?.is_file() {
                    continue;
                }
                let Some(file) = inner.file_name().to_str().map(|n| n.to_string()) else {
                    continue;
                };
                let relative = format!("{name}/{file}");
                if is_attachment_filename(&relative) {
                    out.push(relative);
                }
            }
        }
    }
    Ok(out)
}

fn attachment_abs_path(data_path: &Path, relative: &str) -> Result<PathBuf> {
    if !is_attachment_filename(relative) {
        return Err(AppError::Invalid("invalid attachment path".into()));
    }
    let dir = data_path.parent().unwrap_or_else(|| Path::new("."));
    // The stored path uses '/' as separator (including the optional device
    // subdir); rebuild it segment-by-segment so it joins correctly on Windows.
    let mut abs = dir.to_path_buf();
    for seg in relative.split('/') {
        abs.push(seg);
    }
    Ok(abs)
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &dest)?;
        }
    }
    Ok(())
}

/// Copy this device's `attachments_<device>/` tree when seeding an empty data folder.
///
/// Mirrors `history::copy_own_history`: leave the source intact, skip peer
/// `attachments_*` dirs, and no-op when `from` and `to` share a parent.
pub(crate) fn copy_own_attachments(from_data_path: &Path, to_data_path: &Path) -> Result<()> {
    let from_parent = from_data_path.parent().unwrap_or_else(|| Path::new("."));
    let to_parent = to_data_path.parent().unwrap_or_else(|| Path::new("."));
    if from_parent == to_parent {
        return Ok(());
    }

    let device_id = crate::config::device_id_from_data_path(from_data_path)
        .unwrap_or_else(|| "device".to_string());
    let dir_name = crate::config::attachments_dir_name(&device_id);
    let from_dir = from_parent.join(&dir_name);
    if !from_dir.is_dir() {
        return Ok(());
    }
    let to_dir = to_parent.join(&dir_name);
    copy_dir_recursive(&from_dir, &to_dir)
}

/// On adopt, copy only document-referenced managed attachment blobs that are
/// missing at the new folder and present at the old folder. Never overwrites
/// existing destination files; leaves sources intact; skips unreferenced blobs.
pub(crate) fn fill_missing_referenced_attachments(
    from_data_path: &Path,
    to_data_path: &Path,
    doc: &crate::model::Document,
) -> Result<()> {
    let from_parent = from_data_path.parent().unwrap_or_else(|| Path::new("."));
    let to_parent = to_data_path.parent().unwrap_or_else(|| Path::new("."));
    if from_parent == to_parent {
        return Ok(());
    }

    let mut seen = std::collections::HashSet::new();
    let refs = doc
        .tasks
        .iter()
        .flat_map(|t| t.attachments.iter())
        .chain(doc.template_tasks.iter().flat_map(|t| t.attachments.iter()))
        .map(|a| a.path.as_str());

    for rel in refs {
        // Only modern `attachments_<device>/attachment_*` paths (not legacy flat).
        if !rel.contains('/') || !is_attachment_filename(rel) {
            continue;
        }
        if !seen.insert(rel.to_string()) {
            continue;
        }
        let dest = attachment_abs_path(to_data_path, rel)?;
        if dest.exists() {
            continue;
        }
        let src = attachment_abs_path(from_data_path, rel)?;
        if !src.is_file() {
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&src, &dest)?;
    }
    Ok(())
}

/// After a successful Move transfer, delete only this device's owned files from
/// the old data folder. Never touches peer replicas, history, or attachment trees.
/// No-op when `old` and `new` share a parent (same-folder relocate).
pub(crate) fn remove_own_payload(old_data_path: &Path, new_data_path: &Path) -> Result<()> {
    let old_parent = old_data_path.parent().unwrap_or_else(|| Path::new("."));
    let new_parent = new_data_path.parent().unwrap_or_else(|| Path::new("."));
    if old_parent == new_parent {
        return Ok(());
    }

    let device_id = crate::config::device_id_from_data_path(old_data_path)
        .unwrap_or_else(|| "device".to_string());

    // Own SQLite replica at the path we just left.
    if old_data_path.is_file() {
        std::fs::remove_file(old_data_path)?;
    }
    // Legacy JSON replica for this device, if still present.
    let legacy_json = old_parent.join(format!("tasks_{device_id}.json"));
    if legacy_json.is_file() {
        std::fs::remove_file(&legacy_json)?;
    }

    let history = crate::history::history_path(old_data_path);
    if history.is_file() {
        std::fs::remove_file(&history)?;
    }

    let attachments = old_parent.join(crate::config::attachments_dir_name(&device_id));
    if attachments.is_dir() {
        std::fs::remove_dir_all(&attachments)?;
    }
    Ok(())
}

fn file_display_name(path: &Path) -> Result<String> {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.to_string())
        .ok_or_else(|| {
            AppError::Invalid(format!("invalid attachment file path {}", path.display()))
        })
}

/// Inclusive bounds (in MiB) for the configurable per-attachment size ceiling.
/// Attachments are copied into the data folder and mirrored to the sync folder,
/// so a large file bloats every device's synced copy — hence a cap (default 1
/// GiB, see `config::default_max_attachment_mb`). Mirrored by the UI.
const MAX_ATTACHMENT_MB_MIN: u32 = 1;
const MAX_ATTACHMENT_MB_MAX: u32 = 10240;

/// The configured per-attachment ceiling in bytes.
fn max_attachment_bytes(config: &ConfigState) -> u64 {
    config.settings().max_attachment_mb as u64 * 1024 * 1024
}

fn attachment_from_bytes(
    data_path: &Path,
    device_id: &str,
    max_bytes: u64,
    name: String,
    mime_type: Option<String>,
    bytes: &[u8],
) -> Result<Attachment> {
    if bytes.len() as u64 > max_bytes {
        return Err(AppError::Invalid(format!(
            "attachment {name} is too large ({} bytes); max {max_bytes}",
            bytes.len()
        )));
    }
    let id = new_attachment_id();
    let relative = format!(
        "{}/{}",
        crate::config::attachments_dir_name(device_id),
        managed_attachment_name(&id, &name)
    );
    let dest = attachment_abs_path(data_path, &relative)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dest, bytes)?;
    Ok(Attachment {
        id,
        name,
        path: relative,
        mime_type,
        size: Some(bytes.len() as u64),
        created_at: now_ms(),
    })
}

/// Copy each source attachment's blob to a fresh attachment (new id + new file),
/// so a spawned occurrence owns its files independently of the template instead
/// of sharing the template's ids and blob paths (which would confuse merge-by-id
/// and per-attachment deletion). A source whose blob is missing/unreadable is
/// skipped rather than carried as a dangling shared reference.
struct ClonedAttachments {
    attachments: Vec<Attachment>,
    path_map: Vec<(String, String)>,
}

fn rewrite_cloned_attachment_refs(notes: &str, path_map: &[(String, String)]) -> String {
    let mut rewritten = notes.to_string();
    for (old, new) in path_map {
        rewritten = rewritten.replace(old, new);
    }
    rewritten
}

fn clone_attachments(
    data_path: &Path,
    device_id: &str,
    src: &[Attachment],
) -> Result<ClonedAttachments> {
    let mut attachments = Vec::new();
    let mut path_map = Vec::new();
    for a in src {
        let Ok(abs) = attachment_abs_path(data_path, &a.path) else {
            continue;
        };
        match std::fs::read(&abs) {
            // No size check on a clone: the source was already accepted, so a
            // later-lowered limit must not orphan a recurring occurrence's copy.
            Ok(bytes) => {
                let copied = attachment_from_bytes(
                    data_path,
                    device_id,
                    u64::MAX,
                    a.name.clone(),
                    a.mime_type.clone(),
                    &bytes,
                )?;
                path_map.push((a.path.clone(), copied.path.clone()));
                attachments.push(copied);
            }
            Err(_) => continue,
        }
    }
    Ok(ClonedAttachments {
        attachments,
        path_map,
    })
}

fn attachments_referenced(d: &crate::model::Document, path: &str) -> bool {
    d.tasks
        .iter()
        .flat_map(|t| t.attachments.iter())
        .chain(d.template_tasks.iter().flat_map(|t| t.attachments.iter()))
        .any(|a| a.path == path)
}

/// Delete the on-disk file for each path in `paths` that is no longer referenced
/// by any task or template, so removing an entity (or whole task) doesn't orphan
/// its attachment blobs in the data folder (which would otherwise be mirrored to
/// the sync folder forever). Mirrors the per-attachment cleanup in
/// `remove_task_attachment`; a failed unlink is non-fatal (the metadata is gone).
fn gc_attachment_files(state: &AppState, paths: &[String]) {
    for path in paths {
        if state.read(|d| attachments_referenced(d, path)) {
            continue;
        }
        if let Ok(abs) = attachment_abs_path(&state.path(), path) {
            let _ = std::fs::remove_file(abs);
        }
    }
}

/// Opportunistic GC: delete every managed attachment blob under the data folder
/// whose path is unreferenced in the merged document (flat `attachment_*` and
/// `attachments_*/attachment_*`). Safe after local removes and after peer merges
/// that apply attachment tombstones. Failed unlinks are non-fatal.
pub(crate) fn gc_unreferenced_attachment_blobs(state: &AppState) {
    let folder = match state.path().parent() {
        Some(p) => p.to_path_buf(),
        None => return,
    };
    let Ok(candidates) = list_managed_attachment_rels(&folder) else {
        return;
    };
    gc_attachment_files(state, &candidates);
}

/// Relocate this device's legacy flat attachment blobs into the per-device
/// subdir. Pre-subdir builds stored `attachment_*` flat beside the data file;
/// this moves each blob referenced by THIS replica into `attachments_<device>/`
/// and rewrites its stored path. It is a path-only relocation, so it must NOT
/// bump `updated_at` — doing so would falsely mark every attachment-bearing task
/// as freshly edited and skew the LWW merge against other devices. Per-file
/// failures are non-fatal: a missing/unmovable blob keeps its old flat path and
/// resolves (or gracefully fails) exactly as before. Each blob is owned by the
/// replica that created it, so two devices never contend for the same flat file.
pub(crate) fn migrate_attachments_to_subdir(state: &AppState, device_id: &str) {
    let folder = match state.path().parent() {
        Some(p) => p.to_path_buf(),
        None => return,
    };
    let subdir = crate::config::attachments_dir_name(device_id);
    // Legacy = a managed path with no '/' separator (flat, beside the data file).
    let legacy: Vec<String> = state
        .read(|d| {
            Ok::<_, AppError>(d
                .tasks
                .iter()
                .flat_map(|t| t.attachments.iter())
                .chain(d.template_tasks.iter().flat_map(|t| t.attachments.iter()))
                .map(|a| a.path.clone())
                .filter(|p| !p.contains('/') && is_attachment_filename(p))
                .collect())
        })
        .unwrap_or_default();
    if legacy.is_empty() {
        return;
    }
    let _ = std::fs::create_dir_all(folder.join(&subdir));
    let mut moved: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for old_rel in legacy {
        if moved.contains_key(&old_rel) {
            continue;
        }
        let src = folder.join(&old_rel);
        let dst = folder.join(&subdir).join(&old_rel);
        if src.exists() && std::fs::rename(&src, &dst).is_ok() {
            moved.insert(old_rel.clone(), format!("{subdir}/{old_rel}"));
        }
    }
    if moved.is_empty() {
        return;
    }
    let _ = state.write(|d| {
        let rewrite = |atts: &mut Vec<Attachment>| {
            for a in atts.iter_mut() {
                if let Some(new) = moved.get(&a.path) {
                    a.path = new.clone();
                }
            }
        };
        d.tasks.iter_mut().for_each(|t| rewrite(&mut t.attachments));
        d.template_tasks
            .iter_mut()
            .for_each(|t| rewrite(&mut t.attachments));
        Ok(())
    });
}

#[derive(Deserialize)]
pub struct AttachFilesInput {
    pub id: String,
    pub paths: Vec<String>,
}

fn attachments_from_paths(
    data_path: &Path,
    device_id: &str,
    max_bytes: u64,
    paths: Vec<String>,
) -> Result<Vec<Attachment>> {
    let mut out = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        let name = file_display_name(&path)?;
        // Reject oversized files by metadata before reading, so a huge file is
        // never buffered into memory in the first place.
        if std::fs::metadata(&path)?.len() > max_bytes {
            return Err(AppError::Invalid(format!(
                "attachment {name} is too large; max {max_bytes} bytes"
            )));
        }
        let bytes = std::fs::read(&path)?;
        out.push(attachment_from_bytes(data_path, device_id, max_bytes, name, None, &bytes)?);
    }
    Ok(out)
}

/// Reject an attachments array whose entries don't point at a managed attachment
/// file (`attachment_*`, no path separators). The file ops re-validate on read,
/// but this keeps a crafted IPC payload from persisting a bogus/absolute path
/// into the synced document in the first place.
fn validate_attachments(attachments: &[Attachment]) -> Result<()> {
    for a in attachments {
        if !is_attachment_filename(&a.path) {
            return Err(AppError::Invalid(format!(
                "invalid attachment path: {:?}",
                a.path
            )));
        }
    }
    Ok(())
}

/// Validate a new tag's name and color the way `update_tag`/`update_settings`
/// already validate edits, so the create path can't persist a blank-named or
/// non-hex-color tag into the synced document.
fn validate_new_tag(name: &str, color: &str) -> Result<()> {
    if name.trim().is_empty() {
        return Err(AppError::Invalid("name is empty".into()));
    }
    if !is_hex_color(color) {
        return Err(AppError::Invalid(format!("invalid color: {color}")));
    }
    Ok(())
}

#[tauri::command]
pub fn attach_task_files(
    input: AttachFilesInput,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> Result<Task> {
    if input.paths.is_empty() {
        return state.read(|d| {
            d.tasks
                .iter()
                .find(|t| t.id == input.id)
                .cloned()
                .ok_or_else(|| AppError::NotFound(format!("task {}", input.id)))
        });
    }
    state.read(|d| {
        if d.tasks.iter().any(|t| t.id == input.id) {
            Ok(())
        } else {
            Err(AppError::NotFound(format!("task {}", input.id)))
        }
    })?;
    let attachments =
        attachments_from_paths(&state.path(), &config.device_id(), max_attachment_bytes(&config), input.paths)?;
    let updated = state.write(|d| {
        let t = task_mut(d, &input.id)?;
        t.attachments.extend(attachments);
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[tauri::command]
pub fn attach_template_files(
    input: AttachFilesInput,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> Result<TemplateTask> {
    if input.paths.is_empty() {
        return state.read(|d| {
            d.template_tasks
                .iter()
                .find(|t| t.id == input.id)
                .cloned()
                .ok_or_else(|| AppError::NotFound(format!("template {}", input.id)))
        });
    }
    state.read(|d| {
        if d.template_tasks.iter().any(|t| t.id == input.id) {
            Ok(())
        } else {
            Err(AppError::NotFound(format!("template {}", input.id)))
        }
    })?;
    let attachments =
        attachments_from_paths(&state.path(), &config.device_id(), max_attachment_bytes(&config), input.paths)?;
    let updated = state.write(|d| {
        let t = d
            .template_tasks
            .iter_mut()
            .find(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("template {}", input.id)))?;
        t.attachments.extend(attachments);
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

/// Pasted/dropped in-memory content (image from the clipboard, or a file with no
/// filesystem path the webview can hand us). The bytes are persisted as a managed
/// attachment exactly like a picked file.
#[derive(Deserialize)]
pub struct AttachBytesInput {
    pub id: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub fn attach_task_bytes(
    input: AttachBytesInput,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> Result<Task> {
    let att = attachment_from_bytes(
        &state.path(),
        &config.device_id(),
        max_attachment_bytes(&config),
        input.name,
        input.mime_type,
        &input.bytes,
    )?;
    let updated = state.write(|d| {
        let t = task_mut(d, &input.id)?;
        t.attachments.push(att);
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[tauri::command]
pub fn attach_template_bytes(
    input: AttachBytesInput,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> Result<TemplateTask> {
    let att = attachment_from_bytes(
        &state.path(),
        &config.device_id(),
        max_attachment_bytes(&config),
        input.name,
        input.mime_type,
        &input.bytes,
    )?;
    let updated = state.write(|d| {
        let t = d
            .template_tasks
            .iter_mut()
            .find(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("template {}", input.id)))?;
        t.attachments.push(att);
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

/// Display name + MIME type for the attachment stored at `path`, looked up in
/// the document so the Android save dialog can suggest the original filename
/// rather than the managed `attachment_<id>_…` blob name.
#[cfg(target_os = "android")]
fn attachment_display_meta(state: &AppState, path: &str) -> (String, Option<String>) {
    state.read(|d| {
        d.tasks
            .iter()
            .flat_map(|t| t.attachments.iter())
            .chain(d.template_tasks.iter().flat_map(|t| t.attachments.iter()))
            .find(|a| a.path == path)
            .map(|a| (a.name.clone(), a.mime_type.clone()))
            .unwrap_or_else(|| {
                let fallback = path.rsplit('/').next().unwrap_or(path).to_string();
                (fallback, None)
            })
    })
}

/// Android: export the blob via the system "save as" dialog (SAF
/// ACTION_CREATE_DOCUMENT). App-private files can't be handed to other apps as
/// a plain path — an ACTION_VIEW intent on it resolves to nothing — so saving a
/// copy the user can open from their file manager is the supported route.
/// Cancelling the dialog is a no-op, not an error.
#[cfg(target_os = "android")]
async fn export_attachment_android(
    app: &AppHandle,
    abs: std::path::PathBuf,
    name: String,
    mime_type: Option<String>,
) -> Result<()> {
    use tauri_plugin_android_fs::AndroidFsExt;
    let fs = app.android_fs_async();
    let picked = fs
        .file_picker()
        .save_file(None, &name, mime_type.as_deref(), false)
        .await
        .map_err(attachment_err)?;
    let Some(uri) = picked else { return Ok(()) };
    let bytes = std::fs::read(&abs)?;
    fs.write(&uri, &bytes).await.map_err(attachment_err)
}

/// Reveal an attachment in the OS file manager (Explorer/Finder) on desktop; on
/// Android it exports a copy via the system save dialog (see
/// `export_attachment_android`). Routed through Rust so no opener ACL permission
/// lands in the shared Android capabilities.
#[tauri::command]
pub async fn reveal_attachment(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let abs = attachment_abs_path(&state.path(), &path)?;
    #[cfg(target_os = "android")]
    {
        let (name, mime_type) = attachment_display_meta(&state, &path);
        export_attachment_android(&app, abs, name, mime_type).await
    }
    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener().reveal_item_in_dir(&abs).map_err(attachment_err)
    }
}

/// Open an attachment in its default application; on Android it exports a copy
/// via the system save dialog instead (see `export_attachment_android`).
#[tauri::command]
pub async fn open_attachment(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let abs = attachment_abs_path(&state.path(), &path)?;
    #[cfg(target_os = "android")]
    {
        let (name, mime_type) = attachment_display_meta(&state, &path);
        export_attachment_android(&app, abs, name, mime_type).await
    }
    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_path(abs.to_string_lossy().to_string(), None::<&str>)
            .map_err(attachment_err)
    }
}

#[derive(Deserialize)]
pub struct RemoveAttachmentInput {
    pub id: String,
    pub attachment_id: String,
}

#[tauri::command]
pub fn remove_task_attachment(
    input: RemoveAttachmentInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Task> {
    let updated = state.write(|d| {
        let idx = d
            .tasks
            .iter()
            .position(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("task {}", input.id)))?;
        let before = d.tasks[idx].attachments.len();
        let mut removed_id: Option<String> = None;
        d.tasks[idx].attachments.retain(|a| {
            if a.id == input.attachment_id {
                removed_id = Some(a.id.clone());
                false
            } else {
                true
            }
        });
        if d.tasks[idx].attachments.len() == before {
            return Err(AppError::NotFound(format!(
                "attachment {}",
                input.attachment_id
            )));
        }
        d.tasks[idx].updated_at = now_ms();
        let out = d.tasks[idx].clone();
        if let Some(id) = removed_id {
            d.deleted_attachments.retain(|tomb| tomb.id != id);
            d.deleted_attachments.push(Tombstone {
                id,
                deleted_at: now_ms(),
                deleted_by: None,
            });
        }
        Ok(out)
    })?;
    gc_unreferenced_attachment_blobs(&state);
    emit_changed(&app);
    Ok(updated)
}

#[tauri::command]
pub fn remove_template_attachment(
    input: RemoveAttachmentInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<TemplateTask> {
    let updated = state.write(|d| {
        let idx = d
            .template_tasks
            .iter()
            .position(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("template {}", input.id)))?;
        let before = d.template_tasks[idx].attachments.len();
        let mut removed_id: Option<String> = None;
        d.template_tasks[idx].attachments.retain(|a| {
            if a.id == input.attachment_id {
                removed_id = Some(a.id.clone());
                false
            } else {
                true
            }
        });
        if d.template_tasks[idx].attachments.len() == before {
            return Err(AppError::NotFound(format!(
                "attachment {}",
                input.attachment_id
            )));
        }
        d.template_tasks[idx].updated_at = now_ms();
        let out = d.template_tasks[idx].clone();
        if let Some(id) = removed_id {
            d.deleted_attachments.retain(|tomb| tomb.id != id);
            d.deleted_attachments.push(Tombstone {
                id,
                deleted_at: now_ms(),
                deleted_by: None,
            });
        }
        Ok(out)
    })?;
    gc_unreferenced_attachment_blobs(&state);
    emit_changed(&app);
    Ok(updated)
}

/// Read a managed attachment blob's bytes. Reuses `attachment_abs_path` so the
/// same managed-path guard (no `..`, no backslash, managed name only) applies as
/// on every other attachment read, then reads the file directly. Plain file IO
/// has no asset-protocol canonicalize/glob-scope dependency, so it works when the
/// data folder sits on a path the asset scope can't match (non-ASCII, cloud
/// reparse points), which is exactly where the old asset-URL display failed.
pub(crate) fn read_attachment_bytes(data_path: &Path, relative: &str) -> Result<Vec<u8>> {
    let abs = attachment_abs_path(data_path, relative)?;
    Ok(std::fs::read(abs)?)
}

/// Deliver an attachment blob to the webview as raw bytes (rendered as a
/// `blob:` URL) rather than via the asset protocol.
#[tauri::command]
pub fn read_attachment(path: String, state: State<'_, AppState>) -> Result<tauri::ipc::Response> {
    let bytes = read_attachment_bytes(&state.path(), &path)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(target_os = "android")]
async fn pick_android_attachments(
    app: &AppHandle,
    data_path: &Path,
    device_id: &str,
    max_bytes: u64,
) -> Result<Vec<Attachment>> {
    use tauri_plugin_android_fs::{AndroidFsExt, Entry};
    let fs = app.android_fs_async();
    let picked = fs
        .file_picker()
        .pick_files(None, &[], false)
        .await
        .map_err(attachment_err)?;
    let mut attachments = Vec::new();
    for uri in picked {
        let info = fs.get_info(&uri).await.map_err(attachment_err)?;
        let (name, mime_type) = match info {
            Entry::File {
                name, mime_type, ..
            } => (name, Some(mime_type)),
            Entry::Dir { .. } => continue,
        };
        let bytes = fs.read(&uri).await.map_err(attachment_err)?;
        attachments.push(attachment_from_bytes(
            data_path, device_id, max_bytes, name, mime_type, &bytes,
        )?);
    }
    Ok(attachments)
}

#[tauri::command]
pub async fn pick_task_attachments(
    id: String,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> Result<Option<Task>> {
    #[cfg(target_os = "android")]
    {
        state.read(|d| {
            if d.tasks.iter().any(|t| t.id == id) {
                Ok(())
            } else {
                Err(AppError::NotFound(format!("task {}", id)))
            }
        })?;
        let attachments = pick_android_attachments(
            &app,
            &state.path(),
            &config.device_id(),
            max_attachment_bytes(&config),
        )
        .await?;
        if attachments.is_empty() {
            return Ok(None);
        }
        let updated = state.write(|d| {
            let t = task_mut(d, &id)?;
            t.attachments.extend(attachments);
            t.updated_at = now_ms();
            Ok(t.clone())
        })?;
        emit_changed(&app);
        Ok(Some(updated))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (id, state, config, app);
        Ok(None)
    }
}

#[tauri::command]
pub async fn pick_template_attachments(
    id: String,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> Result<Option<TemplateTask>> {
    #[cfg(target_os = "android")]
    {
        state.read(|d| {
            if d.template_tasks.iter().any(|t| t.id == id) {
                Ok(())
            } else {
                Err(AppError::NotFound(format!("template {}", id)))
            }
        })?;
        let attachments = pick_android_attachments(
            &app,
            &state.path(),
            &config.device_id(),
            max_attachment_bytes(&config),
        )
        .await?;
        if attachments.is_empty() {
            return Ok(None);
        }
        let updated = state.write(|d| {
            let t = d
                .template_tasks
                .iter_mut()
                .find(|t| t.id == id)
                .ok_or_else(|| AppError::NotFound(format!("template {}", id)))?;
            t.attachments.extend(attachments);
            t.updated_at = now_ms();
            Ok(t.clone())
        })?;
        emit_changed(&app);
        Ok(Some(updated))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (id, state, config, app);
        Ok(None)
    }
}

/// Upper bound for a template's relative date offset (#71). 0 = today; the editor
/// caps entry to this range too.
const OFFSET_DAYS_MAX: i64 = 3650;

/// Reject a template offset outside `0..=OFFSET_DAYS_MAX` so a bad value never
/// persists (and so instantiation's date arithmetic always stays in range).
fn validate_offset_days(days: Option<i64>) -> Result<()> {
    if let Some(n) = days {
        if !(0..=OFFSET_DAYS_MAX).contains(&n) {
            return Err(AppError::Invalid(format!(
                "offset days must be 0..={OFFSET_DAYS_MAX}, got {n}"
            )));
        }
    }
    Ok(())
}

fn due_date_from_offset(
    occurrence_date: NaiveDate,
    due_offset_days: Option<i64>,
) -> Option<NaiveDate> {
    due_offset_days.map(|days| occurrence_date + Duration::days(days))
}

/// Reject a recurrence schedule that could never fire or carries an out-of-range
/// value, so a bad rule never persists (#9). Weekday numbers are ISO 1=Mon..7=Sun.
fn validate_recurrence(rec: Option<&Recurrence>) -> Result<()> {
    match rec {
        None => Ok(()),
        Some(Recurrence::Weekly { weekdays }) => {
            if weekdays.is_empty() {
                return Err(AppError::Invalid(
                    "weekly recurrence needs at least one weekday".into(),
                ));
            }
            if weekdays.iter().any(|d| !(1..=7).contains(d)) {
                return Err(AppError::Invalid("weekday must be 1..=7 (Mon..Sun)".into()));
            }
            Ok(())
        }
        Some(Recurrence::Monthly { days }) => {
            if days.is_empty() {
                return Err(AppError::Invalid(
                    "monthly recurrence needs at least one day".into(),
                ));
            }
            if days.iter().any(|d| !(1..=31).contains(d)) {
                return Err(AppError::Invalid("monthly day must be 1..=31".into()));
            }
            Ok(())
        }
        Some(Recurrence::Daily) => Ok(()),
        Some(Recurrence::Yearly { dates }) => {
            if dates.is_empty() {
                return Err(AppError::Invalid(
                    "yearly recurrence needs at least one date".into(),
                ));
            }
            for YearlyDate { month, day } in dates {
                if !(1..=12).contains(month) {
                    return Err(AppError::Invalid("yearly month must be 1..=12".into()));
                }
                // Reject a day that can never occur in the chosen month, so a yearly
                // date is never silently inert. February allows 29 (leap-only).
                let max_day =
                    [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(*month as usize) - 1];
                if !(1..=max_day).contains(day) {
                    return Err(AppError::Invalid(
                        "yearly day must be a valid day for the chosen month".into(),
                    ));
                }
            }
            Ok(())
        }
    }
}

/// A scheduled template must designate a recurrence tag, and it must be one of the
/// template's own tags — so a task spawned from it carries that tag and suppresses
/// the ghost (#9). A template with no schedule needs no recurrence tag.
fn validate_recurrence_tag(
    recurrence: Option<&Recurrence>,
    tag_id: Option<&String>,
    tag_ids: &[String],
) -> Result<()> {
    if recurrence.is_some() {
        let id = tag_id.ok_or_else(|| {
            AppError::Invalid("a recurring template needs a recurrence tag".into())
        })?;
        if !tag_ids.iter().any(|t| t == id) {
            return Err(AppError::Invalid(
                "the recurrence tag must be one of the template's tags".into(),
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn add_task(input: NewTaskInput, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("title is empty".into()));
    }
    validate_time(input.due_time.as_deref())?;
    validate_time(input.start_time.as_deref())?;
    validate_estimated_seconds(input.estimated_seconds)?;
    validate_attachments(&input.attachments)?;
    let ts = now_ms();
    let saved = state.write(|d| {
        let task = Task {
            id: new_task_id(),
            title,
            due_date: input.due_date,
            // A time without its date is meaningless; drop it (all-day).
            due_time: input.due_date.and(input.due_time),
            start_date: input.start_date,
            start_time: input.start_date.and(input.start_time),
            notes: input.notes,
            attachments: input.attachments,
            tag_ids: retain_known_tags(input.tag_ids, &d.tags),
            estimated_seconds: input.estimated_seconds,
            created_at: ts,
            completed_at: None,
            updated_at: ts,
            time_entries: Vec::new(),
        };
        d.tasks.push(task.clone());
        Ok(task)
    })?;
    emit_changed(&app);
    Ok(saved)
}

fn duplicate_task_record(
    src: Task,
    cloned_attachments: ClonedAttachments,
    tags: &[Tag],
    ts: i64,
) -> Task {
    Task {
        id: new_task_id(),
        title: format!("{} (copy)", src.title),
        due_date: src.due_date,
        due_time: src.due_time,
        start_date: src.start_date,
        start_time: src.start_time,
        notes: rewrite_cloned_attachment_refs(&src.notes, &cloned_attachments.path_map),
        attachments: cloned_attachments.attachments,
        tag_ids: retain_known_tags(src.tag_ids, tags),
        estimated_seconds: src.estimated_seconds,
        created_at: ts,
        completed_at: None,
        updated_at: ts,
        time_entries: Vec::new(),
    }
}

#[tauri::command]
pub fn duplicate_task(
    id: String,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> Result<Task> {
    let ts = now_ms();
    let data_path = state.path();
    let device_id = config.device_id();
    let saved = state.write(|d| {
        let src = d
            .tasks
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("task {id}")))?
            .clone();
        let cloned_attachments = clone_attachments(&data_path, &device_id, &src.attachments)?;
        let task = duplicate_task_record(src, cloned_attachments, &d.tags, ts);
        d.tasks.push(task.clone());
        Ok(task)
    })?;
    emit_changed(&app);
    Ok(saved)
}

/// Lets an optional field distinguish "absent" from an explicit JSON `null`.
/// With `#[serde(default, deserialize_with = "double_option")]`:
///   absent -> None (leave unchanged); null -> Some(None) (clear); value -> Some(Some(v)) (set).
fn double_option<'de, T, D>(de: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(de).map(Some)
}

// `due_date` and `start_date` are `Option<Option<_>>` decoded with the
// `double_option` deserializer above, so the edit UI can distinguish "field absent
// (don't change)" from "field is null (clear it)".
#[derive(Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_time: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub start_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")]
    pub start_time: Option<Option<String>>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub attachments: Option<Vec<Attachment>>,
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub estimated_seconds: Option<Option<i64>>,
}

#[tauri::command]
pub fn update_task(
    input: UpdateTaskInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Task> {
    let updated = state.write(|d| {
        // Snapshot known tag ids before the mutable task borrow so dangling
        // references can be stripped (#40).
        let known: std::collections::HashSet<String> =
            d.tags.iter().map(|t| t.id.clone()).collect();
        let t = d
            .tasks
            .iter_mut()
            .find(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("task {}", input.id)))?;
        if let Some(v) = input.title {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                return Err(AppError::Invalid("title is empty".into()));
            }
            t.title = trimmed;
        }
        if let Some(ref v) = input.due_time {
            validate_time(v.as_deref())?;
        }
        if let Some(ref v) = input.start_time {
            validate_time(v.as_deref())?;
        }
        if let Some(v) = input.estimated_seconds {
            validate_estimated_seconds(v)?;
        }
        if let Some(v) = input.due_date {
            t.due_date = v;
        }
        if let Some(v) = input.due_time {
            t.due_time = v;
        }
        if let Some(v) = input.start_date {
            t.start_date = v;
        }
        if let Some(v) = input.start_time {
            t.start_time = v;
        }
        if let Some(v) = input.notes {
            t.notes = v;
        }
        if let Some(v) = input.attachments {
            validate_attachments(&v)?;
            t.attachments = v;
        }
        if let Some(v) = input.tag_ids {
            t.tag_ids = v.into_iter().filter(|id| known.contains(id)).collect();
        }
        if let Some(v) = input.estimated_seconds {
            t.estimated_seconds = v;
        }
        // A time without its date is meaningless; clearing a date drops its time.
        if t.due_date.is_none() {
            t.due_time = None;
        }
        if t.start_date.is_none() {
            t.start_time = None;
        }
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

/// Toggle a task's completion. Finishing a task also archives it (sending it out
/// of the active views); reopening it restores the task. See `Task::set_done`.
#[tauri::command]
pub fn set_task_done(
    id: String,
    done: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Task> {
    let updated = state.write(|d| {
        let t = d
            .tasks
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("task {id}")))?;
        t.set_done(done, now_ms());
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[tauri::command]
pub fn delete_task(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<()> {
    let mut orphaned: Vec<String> = Vec::new();
    state.write(|d| {
        let ts = now_ms();
        let before = d.tasks.len();
        if let Some(t) = d.tasks.iter().find(|t| t.id == id) {
            orphaned = t.attachments.iter().map(|a| a.path.clone()).collect();
        }
        d.tasks.retain(|t| t.id != id);
        if d.tasks.len() == before {
            return Err(AppError::NotFound(format!("task {id}")));
        }
        d.deleted_tasks.push(Tombstone {
            id: id.clone(),
            deleted_at: ts,
            deleted_by: None,
        });
        Ok(())
    })?;
    gc_attachment_files(&state, &orphaned);
    emit_changed(&app);
    Ok(())
}

// ─────────────────────────── Time tracking (#81) ───────────────────────────
// Each task carries a list of {start, end} intervals; the open one (no end) is the
// running timer. A single task has at most one open interval, but different tasks
// may run at once. Every command persists, emits store-changed, and returns the
// updated task.

/// Look up a task by id for a mutating command, or a NotFound error.
fn task_mut<'a>(d: &'a mut crate::model::Document, id: &str) -> Result<&'a mut Task> {
    d.tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| AppError::NotFound(format!("task {id}")))
}

/// Start the clock on a task: append an open interval. Starting one that's already
/// running is a no-op (a task never holds two open intervals).
#[tauri::command]
pub fn start_timer(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let updated = state.write(|d| {
        let t = task_mut(d, &id)?;
        if t.running_entry().is_none() {
            let ts = now_ms();
            t.time_entries.push(TimeEntry {
                id: new_time_entry_id(),
                start: ts,
                end: None,
            });
            t.updated_at = ts;
        }
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

/// Stop the clock on a task: close its open interval. A no-op if none is running.
#[tauri::command]
pub fn stop_timer(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let updated = state.write(|d| {
        let t = task_mut(d, &id)?;
        let ts = now_ms();
        if t.stop_timer(ts) {
            t.updated_at = ts;
        }
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[derive(Deserialize)]
pub struct AddTimeEntryInput {
    pub task_id: String,
    pub start: i64, // epoch millis
    pub end: i64,   // epoch millis
}

/// Manually add a finished session (#81). Closed only: both ends required, `end > start`.
#[tauri::command]
pub fn add_time_entry(
    input: AddTimeEntryInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Task> {
    if input.end <= input.start {
        return Err(AppError::Invalid(
            "time entry end must be after start".into(),
        ));
    }
    let updated = state.write(|d| {
        let t = task_mut(d, &input.task_id)?;
        if t.time_entry_overlaps(input.start, Some(input.end), None) {
            return Err(AppError::Invalid(
                "time entry overlaps an existing entry".into(),
            ));
        }
        t.time_entries.push(TimeEntry {
            id: new_time_entry_id(),
            start: input.start,
            end: Some(input.end),
        });
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[derive(Deserialize)]
pub struct UpdateTimeEntryInput {
    pub task_id: String,
    pub entry_id: String,
    #[serde(default)]
    pub start: Option<i64>,
    #[serde(default)]
    pub end: Option<i64>,
}

/// Edit an existing entry's start and/or end (#81). A closed entry must keep
/// `end > start`; the running entry's start can be moved (its `end` stays open).
#[tauri::command]
pub fn update_time_entry(
    input: UpdateTimeEntryInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Task> {
    let updated = state.write(|d| {
        let t = task_mut(d, &input.task_id)?;
        // Read the edited entry's current bounds by value (and confirm it exists)
        // without holding the borrow across validation.
        let (cur_start, cur_end) = t
            .time_entries
            .iter()
            .find(|e| e.id == input.entry_id)
            .map(|e| (e.start, e.end))
            .ok_or_else(|| AppError::NotFound(format!("time entry {}", input.entry_id)))?;
        // Validate the *candidate* values before mutating, so a rejected edit leaves
        // the entry untouched — `AppState::write` doesn't roll back on Err.
        let new_start = input.start.unwrap_or(cur_start);
        let new_end = match input.end {
            Some(en) => Some(en),
            None => cur_end,
        };
        if let Some(en) = new_end {
            if en <= new_start {
                return Err(AppError::Invalid(
                    "time entry end must be after start".into(),
                ));
            }
        }
        if t.time_entry_overlaps(new_start, new_end, Some(&input.entry_id)) {
            return Err(AppError::Invalid(
                "time entry overlaps an existing entry".into(),
            ));
        }
        let e = t
            .time_entries
            .iter_mut()
            .find(|e| e.id == input.entry_id)
            .ok_or_else(|| AppError::NotFound(format!("time entry {}", input.entry_id)))?;
        e.start = new_start;
        e.end = new_end;
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[derive(Deserialize)]
pub struct DeleteTimeEntryInput {
    pub task_id: String,
    pub entry_id: String,
}

/// Remove a time entry (#81). Deleting the open interval simply stops timing.
#[tauri::command]
pub fn delete_time_entry(
    input: DeleteTimeEntryInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Task> {
    let updated = state.write(|d| {
        let t = task_mut(d, &input.task_id)?;
        let before = t.time_entries.len();
        t.time_entries.retain(|e| e.id != input.entry_id);
        if t.time_entries.len() == before {
            return Err(AppError::NotFound(format!("time entry {}", input.entry_id)));
        }
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

// ───────────────────────────── Templates (#71) ─────────────────────────────
// Reusable blueprints live in their own `template_tasks` list. They carry relative
// date offsets (resolved to absolute dates when a task is spawned, client-side via
// add_task) rather than completion or absolute dates.

#[derive(Deserialize)]
pub struct NewTemplateInput {
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub due_offset_days: Option<i64>,
    #[serde(default)]
    pub start_offset_days: Option<i64>,
    #[serde(default)]
    pub estimated_seconds: Option<i64>,
    #[serde(default)]
    pub recurrence: Option<Recurrence>,
    #[serde(default)]
    pub recurrence_tag_id: Option<String>,
    #[serde(default)]
    pub recurrence_start_date: Option<String>,
    #[serde(default)]
    pub dashboard_view: Option<String>,
}

/// A dashboard view must be one of the known kinds when present. `None` (unpinned)
/// is always valid.
fn validate_dashboard_view(view: Option<&String>) -> Result<()> {
    match view {
        Some(v) if v != "heatmap" && v != "streak" => Err(AppError::Invalid(format!(
            "dashboard_view must be \"heatmap\" or \"streak\", got {v:?}"
        ))),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn add_template(
    input: NewTemplateInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<TemplateTask> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("title is empty".into()));
    }
    validate_offset_days(input.due_offset_days)?;
    validate_offset_days(input.start_offset_days)?;
    validate_estimated_seconds(input.estimated_seconds)?;
    validate_recurrence(input.recurrence.as_ref())?;
    validate_attachments(&input.attachments)?;
    validate_dashboard_view(input.dashboard_view.as_ref())?;
    let ts = now_ms();
    let saved = state.write(|d| {
        let tag_ids = retain_known_tags(input.tag_ids, &d.tags);
        validate_recurrence_tag(
            input.recurrence.as_ref(),
            input.recurrence_tag_id.as_ref(),
            &tag_ids,
        )?;
        // A non-recurring template carries no recurrence tag.
        let recurrence_tag_id = if input.recurrence.is_some() {
            input.recurrence_tag_id.clone()
        } else {
            None
        };
        let tmpl = TemplateTask {
            id: new_task_id(),
            title,
            notes: input.notes,
            attachments: input.attachments,
            tag_ids,
            created_at: ts,
            updated_at: ts,
            due_offset_days: input.due_offset_days,
            start_offset_days: input.start_offset_days,
            estimated_seconds: input.estimated_seconds,
            recurrence: input.recurrence,
            recurrence_tag_id,
            recurrence_start_date: input.recurrence_start_date,
            dashboard_view: input.dashboard_view,
        };
        d.template_tasks.push(tmpl.clone());
        Ok(tmpl)
    })?;
    emit_changed(&app);
    Ok(saved)
}

fn duplicate_template_record(
    src: TemplateTask,
    cloned_attachments: ClonedAttachments,
    tags: &[Tag],
    ts: i64,
) -> TemplateTask {
    let tag_ids = retain_known_tags(src.tag_ids, tags);
    let recurrence_tag_id = src
        .recurrence_tag_id
        .filter(|id| src.recurrence.is_some() && tag_ids.contains(id));
    TemplateTask {
        id: new_task_id(),
        title: format!("{} (copy)", src.title),
        notes: rewrite_cloned_attachment_refs(&src.notes, &cloned_attachments.path_map),
        attachments: cloned_attachments.attachments,
        tag_ids,
        created_at: ts,
        updated_at: ts,
        due_offset_days: src.due_offset_days,
        start_offset_days: src.start_offset_days,
        estimated_seconds: src.estimated_seconds,
        recurrence: src.recurrence,
        recurrence_tag_id,
        recurrence_start_date: src.recurrence_start_date.clone(),
        dashboard_view: src.dashboard_view.clone(),
    }
}

#[tauri::command]
pub fn duplicate_template(
    id: String,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> Result<TemplateTask> {
    let ts = now_ms();
    let data_path = state.path();
    let device_id = config.device_id();
    let saved = state.write(|d| {
        let src = d
            .template_tasks
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("template {id}")))?
            .clone();
        let cloned_attachments = clone_attachments(&data_path, &device_id, &src.attachments)?;
        let tmpl = duplicate_template_record(src, cloned_attachments, &d.tags, ts);
        d.template_tasks.push(tmpl.clone());
        Ok(tmpl)
    })?;
    emit_changed(&app);
    Ok(saved)
}

#[derive(Deserialize)]
pub struct UpdateTemplateInput {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub attachments: Option<Vec<Attachment>>,
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_offset_days: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub start_offset_days: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub estimated_seconds: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub recurrence: Option<Option<Recurrence>>,
    #[serde(default, deserialize_with = "double_option")]
    pub recurrence_tag_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub recurrence_start_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub dashboard_view: Option<Option<String>>,
}

#[tauri::command]
pub fn update_template(
    input: UpdateTemplateInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<TemplateTask> {
    let updated = state.write(|d| {
        let known: std::collections::HashSet<String> =
            d.tags.iter().map(|t| t.id.clone()).collect();
        let t = d
            .template_tasks
            .iter_mut()
            .find(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("template {}", input.id)))?;
        if let Some(v) = input.title {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                return Err(AppError::Invalid("title is empty".into()));
            }
            t.title = trimmed;
        }
        if let Some(v) = input.notes {
            t.notes = v;
        }
        if let Some(v) = input.attachments {
            validate_attachments(&v)?;
            t.attachments = v;
        }
        if let Some(v) = input.tag_ids {
            t.tag_ids = v.into_iter().filter(|id| known.contains(id)).collect();
        }
        if let Some(v) = input.due_offset_days {
            validate_offset_days(v)?;
            t.due_offset_days = v;
        }
        if let Some(v) = input.start_offset_days {
            validate_offset_days(v)?;
            t.start_offset_days = v;
        }
        if let Some(v) = input.estimated_seconds {
            validate_estimated_seconds(v)?;
            t.estimated_seconds = v;
        }
        // Recurrence + its designated tag, validated together against the final tags.
        let new_recurrence = match input.recurrence {
            Some(v) => v,
            None => t.recurrence.clone(),
        };
        let new_rec_tag = match input.recurrence_tag_id {
            Some(v) => v,
            None => t.recurrence_tag_id.clone(),
        };
        validate_recurrence(new_recurrence.as_ref())?;
        validate_recurrence_tag(new_recurrence.as_ref(), new_rec_tag.as_ref(), &t.tag_ids)?;
        t.recurrence = new_recurrence;
        // A template with no schedule carries no recurrence tag.
        t.recurrence_tag_id = if t.recurrence.is_some() {
            new_rec_tag
        } else {
            None
        };
        if let Some(v) = input.recurrence_start_date {
            t.recurrence_start_date = v;
        }
        if let Some(v) = input.dashboard_view {
            validate_dashboard_view(v.as_ref())?;
            t.dashboard_view = v;
        }
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[tauri::command]
pub fn delete_template(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<()> {
    let mut orphaned: Vec<String> = Vec::new();
    state.write(|d| {
        let ts = now_ms();
        let before = d.template_tasks.len();
        if let Some(t) = d.template_tasks.iter().find(|t| t.id == id) {
            orphaned = t.attachments.iter().map(|a| a.path.clone()).collect();
        }
        d.template_tasks.retain(|t| t.id != id);
        if d.template_tasks.len() == before {
            return Err(AppError::NotFound(format!("template {id}")));
        }
        d.deleted_template_tasks.push(Tombstone {
            id: id.clone(),
            deleted_at: ts,
            deleted_by: None,
        });
        Ok(())
    })?;
    gc_attachment_files(&state, &orphaned);
    emit_changed(&app);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnRecurringTaskInput {
    pub template_id: String,
    pub occurrence_date: NaiveDate,
}

/// Promote a recurring template's ghost into a real task on its occurrence date
/// (#9). Copies the template's title/notes/tags and sets `start_date` to the
/// occurrence date and `due_date` to occurrence date + template due offset when
/// present. The tag + start_date pair is the only "link" back to the recurrence,
/// so the ghost self-suppresses on the next refresh. The task is created active;
/// the caller applies any follow-up action (complete / start timer).
#[tauri::command]
pub fn spawn_recurring_task(
    input: SpawnRecurringTaskInput,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> Result<Task> {
    let ts = now_ms();
    let data_path = state.path();
    let device_id = config.device_id();
    let saved = state.write(|d| {
        let tmpl = d
            .template_tasks
            .iter()
            .find(|t| t.id == input.template_id)
            .ok_or_else(|| AppError::NotFound(format!("template {}", input.template_id)))?
            .clone();
        let cloned_attachments = clone_attachments(&data_path, &device_id, &tmpl.attachments)?;
        let task = Task {
            id: new_task_id(),
            title: tmpl.title,
            due_date: due_date_from_offset(input.occurrence_date, tmpl.due_offset_days),
            due_time: None,
            start_date: Some(input.occurrence_date),
            start_time: None,
            notes: rewrite_cloned_attachment_refs(&tmpl.notes, &cloned_attachments.path_map),
            // Each occurrence owns independent copies of the template's
            // attachments (fresh ids + blobs), not shared references.
            attachments: cloned_attachments.attachments,
            tag_ids: retain_known_tags(tmpl.tag_ids, &d.tags),
            estimated_seconds: tmpl.estimated_seconds,
            created_at: ts,
            completed_at: None,
            updated_at: ts,
            time_entries: Vec::new(),
        };
        d.tasks.push(task.clone());
        Ok(task)
    })?;
    emit_changed(&app);
    Ok(saved)
}

#[derive(Deserialize)]
pub struct NewTagInput {
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub pinned: bool,
}

#[tauri::command]
pub fn add_tag(input: NewTagInput, state: State<'_, AppState>, app: AppHandle) -> Result<Tag> {
    validate_new_tag(&input.name, &input.color)?;
    let t = Tag {
        id: new_tag_id(),
        name: input.name.trim().to_string(),
        color: input.color,
        priority: input.priority,
        pinned: input.pinned,
        updated_at: now_ms(),
        dashboard_view: None,
    };
    let saved = state.write(|d| {
        d.tags.push(t.clone());
        Ok(t)
    })?;
    emit_changed(&app);
    Ok(saved)
}

#[tauri::command]
pub fn delete_tag(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<()> {
    state.write(|d| {
        let ts = now_ms();
        let before = d.tags.len();
        d.tags.retain(|t| t.id != id);
        if d.tags.len() == before {
            return Err(AppError::NotFound(format!("tag {id}")));
        }
        d.deleted_tags.push(Tombstone {
            id: id.clone(),
            deleted_at: ts,
            deleted_by: None,
        });
        for task in d.tasks.iter_mut() {
            task.tag_ids.retain(|tid| tid != &id);
            task.updated_at = ts;
        }
        for tmpl in d.template_tasks.iter_mut() {
            tmpl.tag_ids.retain(|tid| tid != &id);
            tmpl.updated_at = ts;
        }
        Ok(())
    })?;
    emit_changed(&app);
    Ok(())
}

#[derive(Deserialize)]
pub struct UpdateTagInput {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub pinned: Option<bool>,
    /// Pin/unpin this tag on the Dashboard. Outer `Option` = field present;
    /// inner `Option` = the view (`Some("heatmap")`/`Some("streak")`) or `null`
    /// to unpin. Absent leaves the current state unchanged.
    #[serde(default, deserialize_with = "double_option")]
    pub dashboard_view: Option<Option<String>>,
}

#[tauri::command]
pub fn update_tag(
    input: UpdateTagInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<crate::model::Tag> {
    let updated = state.write(|d| {
        let t = d
            .tags
            .iter_mut()
            .find(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("tag {}", input.id)))?;
        if let Some(v) = input.name {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                return Err(AppError::Invalid("name is empty".into()));
            }
            t.name = trimmed;
        }
        if let Some(v) = input.color {
            t.color = v;
        }
        if let Some(v) = input.priority {
            t.priority = v;
        }
        if let Some(v) = input.pinned {
            t.pinned = v;
        }
        if let Some(v) = input.dashboard_view {
            validate_dashboard_view(v.as_ref())?;
            t.dashboard_view = v;
        }
        t.updated_at = now_ms();
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

/// Bounds for the configurable Upcoming horizon (#25).
const UPCOMING_DAYS_MIN: u32 = 1;
const UPCOMING_DAYS_MAX: u32 = 365;
const DAY_START_HOUR_MAX: u32 = 23;

/// Bounds for the time-estimate re-notify interval, in minutes (1 minute .. 24 hours).
const REMINDER_INTERVAL_MIN: u32 = 1;
const REMINDER_INTERVAL_MAX: u32 = 1440;

/// Bounds for a tag priority weight, mirrored by the configurable default (#79).
const TAG_WEIGHT_MIN: i64 = -9999;
const TAG_WEIGHT_MAX: i64 = 9999;

/// Bounds for the Recurrence dashboard heatmap range, in days (1 week .. 1 year).
const RECURRENCE_HEATMAP_DAYS_MIN: u32 = 7;
const RECURRENCE_HEATMAP_DAYS_MAX: u32 = 365;

/// True for a `#rgb` or `#rrggbb` hex color string. Guards the configurable
/// default tag color (#79) so a malformed value can't be stored and then
/// pre-filled into every new tag's swatch.
fn is_hex_color(s: &str) -> bool {
    let Some(hex) = s.strip_prefix('#') else {
        return false;
    };
    (hex.len() == 3 || hex.len() == 6) && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_date_format(s: &str) -> bool {
    matches!(
        s,
        "locale"
            | "locale_short"
            | "locale_long"
            | "locale_full"
            | "iso"
            | "slash_ymd"
            | "dot_ymd"
            | "slash_mdy"
            | "slash_dmy"
            | "dot_dmy"
            | "compact"
            | "month_day_year"
            | "day_month_year"
            | "weekday_short"
            | "weekday_long"
            | "chinese"
            | "xiyuan_zh"
            | "gongyuan_zh"
            | "roc"
            | "minguo_zh"
            | "buddhist_thai"
            | "hebrew"
            | "islamic"
            | "persian"
            | "indian"
            | "chinese_lunar"
            | "japanese"
    )
}

fn is_time_format(s: &str) -> bool {
    matches!(
        s,
        "locale"
            | "twenty_four"
            | "twelve_hour"
            | "chinese_day_period"
            | "japanese_day_period"
            | "korean_day_period"
            | "thai_day_period"
            | "arabic_day_period"
    )
}

/// A theme preset id (#15) is an opaque, frontend-owned identifier. Rust only
/// shape-checks it — non-empty, bounded, and `[a-z0-9_-]` — so it can't carry junk
/// into config.json; it never validates the id against the known preset list (the
/// frontend falls back to the default preset for an unknown id).
fn is_preset_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// A theme color-override token key (#15) is a CSS custom-property name like
/// "--c-accent". Like preset ids, Rust only shape-checks it (bounded, `[a-z0-9_-]`);
/// the frontend ignores any key outside its editable set when applying.
fn is_token_key(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 40
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// Reject a theme token map whose keys aren't sane token names or whose values
/// aren't hex colors, so a malformed map can't be persisted (#15).
fn validate_theme_tokens(map: &HashMap<String, String>) -> Result<()> {
    for (k, v) in map {
        if !is_token_key(k) {
            return Err(AppError::Invalid(format!("invalid theme color token: {k}")));
        }
        if !is_hex_color(v) {
            return Err(AppError::Invalid(format!(
                "invalid theme color value for {k}: {v}"
            )));
        }
    }
    Ok(())
}

/// A custom preset name (#15) is a free user-facing label; only bound its length so
/// it can't bloat config.json.
fn is_preset_name(s: &str) -> bool {
    !s.is_empty() && s.chars().count() <= 60
}

/// Shape-validate every user-defined preset (#15): a sane id, a bounded name, and
/// token maps that are well-formed. Rust never inspects token *meaning*.
fn validate_custom_presets(presets: &[ThemePreset]) -> Result<()> {
    for p in presets {
        if !is_preset_id(&p.id) {
            return Err(AppError::Invalid(format!(
                "invalid custom preset id: {}",
                p.id
            )));
        }
        if !is_preset_name(&p.name) {
            return Err(AppError::Invalid(format!(
                "invalid custom preset name: {}",
                p.name
            )));
        }
        validate_theme_tokens(&p.light)?;
        validate_theme_tokens(&p.dark)?;
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct UpdateSettingsInput {
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub sort_order: Option<String>,
    #[serde(default)]
    pub upcoming_days: Option<u32>,
    #[serde(default)]
    pub day_start_hour: Option<u32>,
    #[serde(default)]
    pub default_tag_color: Option<String>,
    #[serde(default)]
    pub default_tag_priority: Option<i64>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub sound_on_complete: Option<bool>,
    #[serde(default)]
    pub reminder_interval_minutes: Option<u32>,
    #[serde(default)]
    pub max_attachment_mb: Option<u32>,
    #[serde(default)]
    pub recurrence_heatmap_days: Option<u32>,
    #[serde(default)]
    pub first_day_of_week: Option<u32>,
    #[serde(default)]
    pub date_time_format: Option<String>,
    #[serde(default)]
    pub date_format: Option<String>,
    #[serde(default)]
    pub time_format: Option<String>,
    #[serde(default)]
    pub theme_preset: Option<String>,
    #[serde(default)]
    pub custom_presets: Option<Vec<ThemePreset>>,
}

#[tauri::command]
pub fn update_settings(
    input: UpdateSettingsInput,
    config: State<'_, ConfigState>,
    app: AppHandle,
) -> Result<()> {
    config.update_settings(|s| {
        if let Some(t) = input.theme {
            if !matches!(t.as_str(), "auto" | "light" | "dark") {
                return Err(AppError::Invalid(format!("invalid theme: {t}")));
            }
            s.theme = t;
        }
        if let Some(order) = input.sort_order {
            if !matches!(order.as_str(), "priority" | "date") {
                return Err(AppError::Invalid(format!("invalid sort_order: {order}")));
            }
            s.sort_order = order;
        }
        if let Some(n) = input.upcoming_days {
            if !(UPCOMING_DAYS_MIN..=UPCOMING_DAYS_MAX).contains(&n) {
                return Err(AppError::Invalid(format!(
                    "upcoming_days must be {UPCOMING_DAYS_MIN}..={UPCOMING_DAYS_MAX}, got {n}"
                )));
            }
            s.upcoming_days = n;
        }
        if let Some(h) = input.day_start_hour {
            if h > DAY_START_HOUR_MAX {
                return Err(AppError::Invalid(format!(
                    "day_start_hour must be 0..={DAY_START_HOUR_MAX}, got {h}"
                )));
            }
            s.day_start_hour = h;
        }
        if let Some(color) = input.default_tag_color {
            if !is_hex_color(&color) {
                return Err(AppError::Invalid(format!("invalid default_tag_color: {color}")));
            }
            s.default_tag_color = color;
        }
        if let Some(p) = input.default_tag_priority {
            if !(TAG_WEIGHT_MIN..=TAG_WEIGHT_MAX).contains(&p) {
                return Err(AppError::Invalid(format!(
                    "default_tag_priority must be {TAG_WEIGHT_MIN}..={TAG_WEIGHT_MAX}, got {p}"
                )));
            }
            s.default_tag_priority = p;
        }
        if let Some(lang) = input.language {
            if !matches!(lang.as_str(), "auto" | "en" | "zh-TW") {
                return Err(AppError::Invalid(format!("invalid language: {lang}")));
            }
            s.language = lang;
        }
        if let Some(on) = input.sound_on_complete {
            s.sound_on_complete = on;
        }
        if let Some(m) = input.reminder_interval_minutes {
            if !(REMINDER_INTERVAL_MIN..=REMINDER_INTERVAL_MAX).contains(&m) {
                return Err(AppError::Invalid(format!(
                    "reminder_interval_minutes must be {REMINDER_INTERVAL_MIN}..={REMINDER_INTERVAL_MAX}, got {m}"
                )));
            }
            s.reminder_interval_minutes = m;
        }
        if let Some(mb) = input.max_attachment_mb {
            if !(MAX_ATTACHMENT_MB_MIN..=MAX_ATTACHMENT_MB_MAX).contains(&mb) {
                return Err(AppError::Invalid(format!(
                    "max_attachment_mb must be {MAX_ATTACHMENT_MB_MIN}..={MAX_ATTACHMENT_MB_MAX}, got {mb}"
                )));
            }
            s.max_attachment_mb = mb;
        }
        if let Some(d) = input.recurrence_heatmap_days {
            if !(RECURRENCE_HEATMAP_DAYS_MIN..=RECURRENCE_HEATMAP_DAYS_MAX).contains(&d) {
                return Err(AppError::Invalid(format!(
                    "recurrence_heatmap_days must be {RECURRENCE_HEATMAP_DAYS_MIN}..={RECURRENCE_HEATMAP_DAYS_MAX}, got {d}"
                )));
            }
            s.recurrence_heatmap_days = d;
        }
        if let Some(fdow) = input.first_day_of_week {
            if fdow > 6 {
                return Err(AppError::Invalid(format!(
                    "first_day_of_week must be 0..=6, got {fdow}"
                )));
            }
            s.first_day_of_week = fdow;
        }
        if let Some(fmt) = input.date_time_format {
            if !is_date_format(&fmt) {
                return Err(AppError::Invalid(format!("invalid date_time_format: {fmt}")));
            }
            s.date_time_format = fmt;
        }
        if let Some(fmt) = input.date_format {
            if !is_date_format(&fmt) {
                return Err(AppError::Invalid(format!("invalid date_format: {fmt}")));
            }
            s.date_format = Some(fmt);
        }
        if let Some(fmt) = input.time_format {
            if !is_time_format(&fmt) {
                return Err(AppError::Invalid(format!("invalid time_format: {fmt}")));
            }
            s.time_format = Some(fmt);
        }
        if let Some(id) = input.theme_preset {
            if !is_preset_id(&id) {
                return Err(AppError::Invalid(format!("invalid theme_preset: {id}")));
            }
            s.theme_preset = Some(id);
        }
        // The custom-preset list replaces wholesale; an empty list clears it (stored as
        // None so config.json stays clean for the stock theme).
        if let Some(presets) = input.custom_presets {
            validate_custom_presets(&presets)?;
            s.custom_presets = if presets.is_empty() { None } else { Some(presets) };
        }
        Ok(())
    })?;
    emit_settings_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn list_conflicts(state: State<'_, AppState>) -> Vec<String> {
    let path = state.path();
    scan_conflict_files(&path)
}

/// Reject any conflict path the UI didn't get from `list_conflicts`. A valid path
/// must live directly in the data dir (same parent as the data file) and match the
/// conflict-file naming pattern `scan_conflict_files` recognizes (see sync.rs).
/// Without this, these commands would `std::fs::read` / `remove_file` an arbitrary
/// caller-supplied path; a frontend bug could then touch an unrelated file (#49).
fn validate_conflict_path(candidate: &str, data_path: &Path) -> Result<PathBuf> {
    let candidate = Path::new(candidate);
    let data_dir = data_path
        .parent()
        .ok_or_else(|| AppError::Invalid("data path has no parent".into()))?;
    // Parent must be the data dir. Plain PathBuf equality, not canonicalize:
    // legitimate paths are echoed verbatim from list_conflicts, and a `..`/other-dir
    // path simply won't match (fail-safe) — canonicalize would also break on a
    // stale entry and add a Windows `\\?\` prefix mismatch.
    match candidate.parent() {
        Some(p) if p == data_dir => {}
        _ => {
            return Err(AppError::Invalid(
                "conflict path is not in the data directory".into(),
            ))
        }
    }
    let name = candidate
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Invalid("conflict path has no file name".into()))?;
    let stem = data_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("tasks");
    let data_file_name = data_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !crate::sync::is_conflict_file_name(name, stem, data_file_name) {
        return Err(AppError::Invalid("not a recognized conflict file".into()));
    }
    Ok(candidate.to_path_buf())
}

#[tauri::command]
pub fn read_conflict(conflict_path: String, state: State<'_, AppState>) -> Result<Vec<TaskDiff>> {
    let path = validate_conflict_path(&conflict_path, &state.path())?;
    let theirs = read_conflict_doc(&path)?;
    let diffs = state.read(|d| diff_tasks(d, &theirs));
    Ok(diffs)
}

/// Read a conflict file and parse it with the same newer-version guard the master
/// file gets (#44). Without this, a conflict copy written by a future app build
/// would be silently merged into the master, defeating the version gate the rest
/// of the store enforces.
fn read_conflict_doc(path: &Path) -> Result<crate::model::Document> {
    let bytes = std::fs::read(path)?;
    crate::store::parse_checked(&bytes)
}

#[derive(Deserialize)]
pub struct ResolveConflictInput {
    pub conflict_path: String,
    pub decisions: Vec<Decision>,
}

#[tauri::command]
pub fn resolve_conflict(
    input: ResolveConflictInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let path = validate_conflict_path(&input.conflict_path, &state.path())?;
    let theirs = read_conflict_doc(&path)?;
    state.write(|d| {
        let new_tasks = apply_decisions(d, &theirs, &input.decisions);
        // Keep tags referenced by merged-in tasks so they don't dangle (#30).
        let added_tags = tags_to_merge(&new_tasks, d, &theirs);
        d.tasks = new_tasks;
        d.tags.extend(added_tags);
        Ok(())
    })?;
    let _ = std::fs::remove_file(&path);
    // Also remove the conflict copy from the synced SAF folder so it doesn't
    // re-appear on the next pull (#Phase 4B). Use the validated `path`, not the
    // raw input, so the SAF delete honors the same confinement as the local one (#49).
    #[cfg(target_os = "android")]
    saf_delete_conflict(&app, &path);
    emit_changed(&app);
    let data_path: PathBuf = state.path();
    let _ = app.emit("conflicts-detected", &scan_conflict_files(&data_path));
    Ok(())
}

#[tauri::command]
pub fn dismiss_conflict(
    conflict_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    let path = validate_conflict_path(&conflict_path, &state.path())?;
    let _ = std::fs::remove_file(&path);
    // Mirror the deletion into the synced SAF folder, using the validated path (#49).
    #[cfg(target_os = "android")]
    saf_delete_conflict(&app, &path);
    let data_path: PathBuf = state.path();
    let _ = app.emit("conflicts-detected", &scan_conflict_files(&data_path));
    Ok(())
}

#[derive(serde::Serialize)]
pub struct DataLocation {
    /// User-chosen folder, or null when using the default app-data dir.
    pub folder: Option<String>,
    /// Stable per-install id used to name this device's sync replica.
    pub device_id: String,
    /// The effective folder containing this device's data replica.
    pub folder_path: String,
    /// The effective absolute tasks.json path in use right now. Kept for
    /// compatibility; Settings shows folder_path instead.
    pub effective_path: String,
}

fn default_data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Invalid(format!("app_data_dir: {e}")))
}

fn data_location(state: &AppState, config: &ConfigState) -> DataLocation {
    let effective_path = state.path();
    let folder_path = effective_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    DataLocation {
        folder: config.folder(),
        device_id: config.device_id(),
        folder_path,
        effective_path: effective_path.to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn get_data_location(
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
) -> DataLocation {
    data_location(&state, &config)
}

#[tauri::command]
pub fn set_data_folder(
    folder: String,
    transfer_mode: crate::store::TransferMode,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    watcher: State<'_, crate::sync::WatcherHandle>,
    app: AppHandle,
) -> Result<DataLocation> {
    let folder_path = PathBuf::from(&folder);
    if !folder_path.is_dir() {
        return Err(AppError::Invalid(format!("not a folder: {folder}")));
    }
    let new_path = folder_path.join(crate::config::data_file_name(&config.device_id()));
    state.repoint(new_path.clone(), transfer_mode)?;
    config.set_folder(Some(folder))?;
    crate::sync::restart(&watcher, &app, new_path);
    emit_changed(&app);
    let _ = app.emit(
        "conflicts-detected",
        &crate::sync::scan_conflict_files(&state.path()),
    );
    Ok(data_location(&state, &config))
}

#[tauri::command]
pub fn clear_data_folder(
    transfer_mode: crate::store::TransferMode,
    state: State<'_, AppState>,
    config: State<'_, ConfigState>,
    watcher: State<'_, crate::sync::WatcherHandle>,
    app: AppHandle,
) -> Result<DataLocation> {
    let default_dir = default_data_dir(&app)?;
    let new_path = default_dir.join(crate::config::data_file_name(&config.device_id()));
    state.repoint(new_path.clone(), transfer_mode)?;
    config.set_folder(None)?;
    crate::sync::restart(&watcher, &app, new_path);
    emit_changed(&app);
    // Refresh the conflict badge for the new (default) folder, mirroring
    // set_data_folder, so stale conflicts from the previous folder don't linger
    // until the next poll tick.
    let _ = app.emit(
        "conflicts-detected",
        &crate::sync::scan_conflict_files(&state.path()),
    );
    Ok(data_location(&state, &config))
}

// ───────────────────────── Android SAF folder sync ─────────────────────────
// Mirror the app-private tasks.json (and any sync-tool conflict copies) to/from a
// user-picked SAF folder (e.g. a cloud-synced folder). All SAF I/O
// lives behind a trait in safsync.rs; these commands wire it to the app. Desktop
// builds get inert stubs so the command names always resolve in generate_handler!.

#[cfg(target_os = "android")]
fn saf_delete_conflict(app: &AppHandle, conflict_path: &std::path::Path) {
    use crate::safsync::SafBackend as _;
    let Some(name) = conflict_path.file_name().and_then(|s| s.to_str()) else {
        return;
    };
    let saf = app.state::<crate::safsync::SafSync>();
    let folder_json = saf.inner.lock().unwrap_or_else(|e| e.into_inner()).folder_uri_json.clone();
    if let Some(json) = folder_json {
        if let Ok(backend) = crate::safsync::android::AndroidSafBackend::from_json(app, &json) {
            let _ = backend.delete_file(name);
        }
    }
}

#[cfg(target_os = "android")]
fn saf_conflict_count(path: &std::path::Path) -> usize {
    scan_conflict_files(path).len()
}

/// Persist the current link + last-synced hash to the device-local sidecar so a
/// cold start can restore the hash and avoid clobbering a remote that another
/// device updated while this app was closed (#Phase 4B).
#[cfg(target_os = "android")]
fn saf_persist(state: &AppState, saf: &crate::safsync::SafSync) {
    let cfg = {
        let g = saf.inner.lock().unwrap_or_else(|e| e.into_inner());
        crate::safsync::SyncConfig {
            folder_uri_json: g.folder_uri_json.clone(),
            folder_label: g.folder_label.clone(),
            last_synced_hash: g.last_synced_hash,
        }
    };
    let _ = crate::safsync::save_config(&state.path(), &cfg);
}

/// Pull the remote into the app-private master. Returns `(ok, status)` where
/// `ok` is false when the remote couldn't be read — callers MUST NOT push after
/// a failed pull, or a transient unreadable remote would be overwritten by this
/// device's copy (the Google Drive data-loss bug). A folder that simply has no
/// remote yet pulls cleanly (`ok = true`).
#[cfg(target_os = "android")]
fn saf_run_pull(
    app: &AppHandle,
    state: &AppState,
    saf: &crate::safsync::SafSync,
) -> (bool, crate::safsync::SyncStatus) {
    use crate::safsync::{self, android::AndroidSafBackend};
    let path = state.path();
    let (folder_json, last_hash) = {
        let g = saf.inner.lock().unwrap_or_else(|e| e.into_inner());
        (g.folder_uri_json.clone(), g.last_synced_hash)
    };
    let mut conflicts = 0usize;
    let mut ok = true;
    if let Some(json) = folder_json {
        match AndroidSafBackend::from_json(app, &json) {
            Ok(backend) => match safsync::pull_in(state, &backend, &path, last_hash) {
                Ok(out) => {
                    {
                        let mut g = saf.inner.lock().unwrap_or_else(|e| e.into_inner());
                        g.last_synced_hash = out.new_synced_hash;
                        g.last_synced_ms = Some(now_ms());
                        // A non-fatal warning (e.g. an invalid remote main doc)
                        // surfaces here without discarding the mirrored conflicts.
                        g.last_error = out.warning.clone();
                    }
                    conflicts = out.conflict_count;
                    if out.imported {
                        let _ = app.emit(STORE_CHANGED, ());
                    }
                    saf_persist(state, saf); // persist the advanced last_synced_hash
                    let _ = app.emit("conflicts-detected", &scan_conflict_files(&path));
                }
                Err(e) => {
                    saf.inner.lock().unwrap_or_else(|e| e.into_inner()).last_error = Some(e.to_string());
                    ok = false;
                }
            },
            Err(e) => {
                saf.inner.lock().unwrap_or_else(|e| e.into_inner()).last_error = Some(e.to_string());
                ok = false;
            }
        }
    }
    (ok, saf.status(conflicts))
}

/// Switch the data source to the linked folder: discard the local in-memory
/// document and load the folder's `tasks.json` outright (no conflict file). Used
/// only by the explicit folder-pick action, not routine sync.
#[cfg(target_os = "android")]
fn saf_run_switch(
    app: &AppHandle,
    state: &AppState,
    saf: &crate::safsync::SafSync,
) -> crate::safsync::SyncStatus {
    use crate::safsync::{self, android::AndroidSafBackend};
    let path = state.path();
    let folder_json = saf.inner.lock().unwrap_or_else(|e| e.into_inner()).folder_uri_json.clone();
    let mut conflicts = 0usize;
    if let Some(json) = folder_json {
        match AndroidSafBackend::from_json(app, &json) {
            Ok(backend) => match safsync::switch_to_remote(state, &backend, &path) {
                Ok(out) => {
                    {
                        let mut g = saf.inner.lock().unwrap_or_else(|e| e.into_inner());
                        g.last_synced_hash = out.new_synced_hash;
                        g.last_synced_ms = Some(now_ms());
                        // A non-fatal warning (e.g. an invalid remote main doc)
                        // surfaces here without discarding the mirrored conflicts.
                        g.last_error = out.warning.clone();
                    }
                    conflicts = out.conflict_count;
                    if out.imported {
                        let _ = app.emit(STORE_CHANGED, ());
                    }
                    saf_persist(state, saf);
                    let _ = app.emit("conflicts-detected", &scan_conflict_files(&path));
                }
                Err(e) => {
                    saf.inner.lock().unwrap_or_else(|e| e.into_inner()).last_error = Some(e.to_string());
                }
            },
            Err(e) => {
                saf.inner.lock().unwrap_or_else(|e| e.into_inner()).last_error = Some(e.to_string());
            }
        }
    }
    saf.status(conflicts)
}

#[cfg(target_os = "android")]
fn saf_run_push(
    app: &AppHandle,
    state: &AppState,
    saf: &crate::safsync::SafSync,
) -> crate::safsync::SyncStatus {
    use crate::safsync::{self, android::AndroidSafBackend};
    let path = state.path();
    let (folder_json, last_hash) = {
        let g = saf.inner.lock().unwrap_or_else(|e| e.into_inner());
        (g.folder_uri_json.clone(), g.last_synced_hash)
    };
    if let Some(json) = folder_json {
        match AndroidSafBackend::from_json(app, &json) {
            Ok(backend) => match safsync::push_out(state, &backend, &path, last_hash) {
                Ok(Some(h)) => {
                    {
                        let mut g = saf.inner.lock().unwrap_or_else(|e| e.into_inner());
                        g.last_synced_hash = Some(h);
                        g.last_synced_ms = Some(now_ms());
                        g.last_error = None;
                    }
                    saf_persist(state, saf); // persist the advanced last_synced_hash
                }
                Ok(None) => {}
                Err(e) => {
                    saf.inner.lock().unwrap_or_else(|e| e.into_inner()).last_error = Some(e.to_string());
                }
            },
            Err(e) => {
                saf.inner.lock().unwrap_or_else(|e| e.into_inner()).last_error = Some(e.to_string());
            }
        }
    }
    saf.status(saf_conflict_count(&state.path()))
}

/// Open the SAF folder picker, persist permission, save the link, and seed/pull.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn saf_pick_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> Result<crate::safsync::SyncStatus> {
    use crate::safsync::{self, LinkAction};
    let picked = safsync::android::pick_and_persist(&app).await?;
    if let Some((json, label)) = picked {
        {
            let mut g = saf.inner.lock().unwrap_or_else(|e| e.into_inner());
            g.folder_uri_json = Some(json.clone());
            g.folder_label = Some(label.clone());
            g.permission_ok = true;
            g.last_synced_hash = None; // force a real sync on first link
            g.last_error = None;
        }
        safsync::save_config(
            &state.path(),
            &safsync::SyncConfig {
                folder_uri_json: Some(json.clone()),
                folder_label: Some(label),
                last_synced_hash: None, // the seed/pull below persists the real hash
            },
        )?;
        // Choosing a folder, decided fail-safe. If it already has a tasks.json,
        // SWITCH to it: discard the local in-memory document and load the folder's
        // data outright (no conflict file). If the folder is confirmed empty, SEED
        // it from this device's document. If the folder can't be read, ABORT rather
        // than risk overwriting an existing remote (the Google Drive data-loss
        // bug): surface the error and leave the remote untouched.
        let backend = safsync::android::AndroidSafBackend::from_json(&app, &json)?;
        return Ok(match safsync::first_link_action(&backend) {
            LinkAction::Pull => saf_run_switch(&app, &state, &saf),
            LinkAction::Seed => saf_run_push(&app, &state, &saf),
            LinkAction::Abort => {
                let msg =
                    "Couldn't read the selected folder, so its contents were left untouched. \
                           Check the folder is reachable and try linking again.";
                saf.inner.lock().unwrap_or_else(|e| e.into_inner()).last_error = Some(msg.into());
                saf.status(saf_conflict_count(&state.path()))
            }
        });
    }
    Ok(saf.status(saf_conflict_count(&state.path())))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn saf_clear_folder(
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> Result<()> {
    {
        let mut g = saf.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.folder_uri_json = None;
        g.folder_label = None;
        g.permission_ok = false;
        g.last_synced_hash = None;
        g.last_error = None;
    }
    crate::safsync::save_config(&state.path(), &crate::safsync::SyncConfig::default())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn saf_push(
    app: AppHandle,
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> crate::safsync::SyncStatus {
    saf_run_push(&app, &state, &saf)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn saf_sync_now(
    app: AppHandle,
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> crate::safsync::SyncStatus {
    // Pull first so a remote another device updated is merged into local BEFORE
    // we push — otherwise a cold start would push this device's stale copy over
    // the newer remote (#Phase 4B).
    // Only push if the pull SUCCEEDED: if the remote couldn't be read, pushing now
    // would overwrite it with this device's copy (the Google Drive data-loss bug).
    let (pull_ok, status) = saf_run_pull(&app, &state, &saf);
    if pull_ok {
        saf_run_push(&app, &state, &saf)
    } else {
        status
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn saf_status(
    state: State<'_, AppState>,
    saf: State<'_, crate::safsync::SafSync>,
) -> crate::safsync::SyncStatus {
    saf.status(saf_conflict_count(&state.path()))
}

// Desktop/iOS stubs (no SAF): keep the command names resolvable for the handler.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn saf_pick_folder() -> crate::safsync::SyncStatus {
    crate::safsync::SyncStatus::unlinked()
}
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn saf_clear_folder() -> Result<()> {
    Ok(())
}
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn saf_push() -> crate::safsync::SyncStatus {
    crate::safsync::SyncStatus::unlinked()
}
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn saf_sync_now() -> crate::safsync::SyncStatus {
    crate::safsync::SyncStatus::unlinked()
}
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn saf_status() -> crate::safsync::SyncStatus {
    crate::safsync::SyncStatus::unlinked()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task_with_attachment(id: &str, attach_path: &str) -> Task {
        Task {
            id: id.into(),
            title: "t".into(),
            due_date: None,
            due_time: None,
            start_date: None,
            start_time: None,
            notes: String::new(),
            attachments: vec![Attachment {
                id: "att_1".into(),
                name: "f".into(),
                path: attach_path.into(),
                mime_type: None,
                size: None,
                created_at: 0,
            }],
            tag_ids: Vec::new(),
            estimated_seconds: None,
            created_at: 0,
            completed_at: None,
            updated_at: 0,
            time_entries: Vec::new(),
        }
    }

    fn tag(id: &str) -> Tag {
        Tag {
            id: id.into(),
            name: id.into(),
            color: "#000000".into(),
            priority: 0,
            pinned: false,
            updated_at: 0,
            dashboard_view: None,
        }
    }

    #[test]
    fn duplicate_task_record_resets_identity_completion_and_timer() {
        let src = Task {
            id: "k_old".into(),
            title: "task".into(),
            due_date: NaiveDate::from_ymd_opt(2026, 6, 20),
            due_time: Some("09:30".into()),
            start_date: NaiveDate::from_ymd_opt(2026, 6, 19),
            start_time: Some("08:00".into()),
            notes: "![old](attachment_old.bin)".into(),
            attachments: vec![Attachment {
                id: "att_old".into(),
                name: "old".into(),
                path: "attachment_old.bin".into(),
                mime_type: None,
                size: None,
                created_at: 1,
            }],
            tag_ids: vec!["tag_keep".into(), "tag_drop".into()],
            estimated_seconds: Some(60),
            created_at: 10,
            completed_at: Some(11),
            updated_at: 12,
            time_entries: vec![TimeEntry {
                id: "te_1".into(),
                start: 13,
                end: None,
            }],
        };
        let copied_attachment = Attachment {
            id: "att_new".into(),
            name: "new".into(),
            path: "attachment_new.bin".into(),
            mime_type: None,
            size: None,
            created_at: 20,
        };

        let dup = duplicate_task_record(
            src,
            ClonedAttachments {
                attachments: vec![copied_attachment.clone()],
                path_map: vec![("attachment_old.bin".into(), "attachment_new.bin".into())],
            },
            &[tag("tag_keep")],
            99,
        );

        assert_ne!(dup.id, "k_old");
        assert_eq!(dup.title, "task (copy)");
        assert_eq!(dup.notes, "![old](attachment_new.bin)");
        assert_eq!(dup.due_time.as_deref(), Some("09:30"));
        assert_eq!(dup.start_time.as_deref(), Some("08:00"));
        assert_eq!(dup.attachments, vec![copied_attachment]);
        assert_eq!(dup.tag_ids, vec!["tag_keep".to_string()]);
        assert_eq!(dup.estimated_seconds, Some(60));
        assert_eq!(dup.created_at, 99);
        assert_eq!(dup.updated_at, 99);
        assert_eq!(dup.completed_at, None);
        assert!(dup.time_entries.is_empty());
    }

    #[test]
    fn duplicate_template_record_keeps_template_fields() {
        let src = TemplateTask {
            id: "k_tmpl".into(),
            title: "template".into(),
            notes: "[doc](attachment_old.bin)".into(),
            attachments: vec![Attachment {
                id: "att_old".into(),
                name: "old".into(),
                path: "attachment_old.bin".into(),
                mime_type: None,
                size: None,
                created_at: 1,
            }],
            tag_ids: vec!["tag_keep".into(), "tag_drop".into()],
            created_at: 10,
            updated_at: 11,
            due_offset_days: Some(3),
            start_offset_days: Some(1),
            estimated_seconds: Some(120),
            recurrence: Some(Recurrence::Daily),
            recurrence_tag_id: Some("tag_keep".into()),
            recurrence_start_date: None,
            dashboard_view: None,
        };

        let copied_attachment = Attachment {
            id: "att_new".into(),
            name: "new".into(),
            path: "attachment_new.bin".into(),
            mime_type: None,
            size: None,
            created_at: 20,
        };

        let dup = duplicate_template_record(
            src,
            ClonedAttachments {
                attachments: vec![copied_attachment.clone()],
                path_map: vec![("attachment_old.bin".into(), "attachment_new.bin".into())],
            },
            &[tag("tag_keep")],
            99,
        );

        assert_ne!(dup.id, "k_tmpl");
        assert_eq!(dup.title, "template (copy)");
        assert_eq!(dup.notes, "[doc](attachment_new.bin)");
        assert_eq!(dup.attachments, vec![copied_attachment]);
        assert_eq!(dup.tag_ids, vec!["tag_keep".to_string()]);
        assert_eq!(dup.due_offset_days, Some(3));
        assert_eq!(dup.start_offset_days, Some(1));
        assert_eq!(dup.estimated_seconds, Some(120));
        assert!(matches!(dup.recurrence, Some(Recurrence::Daily)));
        assert_eq!(dup.recurrence_tag_id.as_deref(), Some("tag_keep"));
        assert_eq!(dup.created_at, 99);
        assert_eq!(dup.updated_at, 99);
    }

    #[test]
    fn validate_new_tag_rejects_blank_name_and_bad_color() {
        assert!(validate_new_tag("  ", "#fff").is_err(), "blank name rejected");
        assert!(validate_new_tag("work", "blue").is_err(), "non-hex color rejected");
        assert!(validate_new_tag("work", "#10b981").is_ok(), "valid tag accepted");
    }

    #[test]
    fn validate_attachments_rejects_unmanaged_paths() {
        let bad = vec![Attachment {
            id: "a".into(),
            name: "x".into(),
            path: "../../etc/passwd".into(),
            mime_type: None,
            size: None,
            created_at: 0,
        }];
        assert!(validate_attachments(&bad).is_err(), "traversal path rejected");

        let ok = vec![Attachment {
            id: "a".into(),
            name: "x".into(),
            path: "attachment_a_x.bin".into(),
            mime_type: None,
            size: None,
            created_at: 0,
        }];
        assert!(validate_attachments(&ok).is_ok(), "managed path accepted");
    }

    #[test]
    fn is_attachment_filename_accepts_legacy_and_device_subdir() {
        // Legacy flat layout (pre-migration).
        assert!(is_attachment_filename("attachment_a_x.bin"));
        // New per-device subdir layout.
        assert!(is_attachment_filename("attachments_dev/attachment_a_x.bin"));
        assert!(is_attachment_filename("attachments_ab12-cd_/attachment_b_y.png"));
        // Rejections: traversal, backslash, wrong subdir, nested dirs, bare dir.
        assert!(!is_attachment_filename("attachments_dev/../attachment_a.bin"));
        assert!(!is_attachment_filename("attachments_dev\\attachment_a.bin"));
        assert!(!is_attachment_filename("evil/attachment_a.bin"));
        assert!(!is_attachment_filename("attachments_dev/sub/attachment_a.bin"));
        assert!(!is_attachment_filename("attachments_dev/notmanaged.bin"));
        assert!(!is_attachment_filename("../../etc/passwd"));
    }

    #[test]
    fn attachment_from_bytes_rejects_oversized_files() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("tasks_dev.json");
        let max = 4u64;
        let oversized = vec![0u8; (max + 1) as usize];
        let res = attachment_from_bytes(&data, "dev", max, "big.bin".into(), None, &oversized);
        assert!(res.is_err(), "a file over the cap must be rejected");
    }

    #[test]
    fn read_attachment_bytes_round_trips_from_non_ascii_data_folder() {
        // The exact case that broke asset-protocol display: a data folder whose
        // path contains non-ASCII characters (e.g. Google Drive's localized
        // マイドライブ). Plain file IO must still round-trip the blob bytes.
        let base = tempfile::tempdir().unwrap();
        let folder = base.path().join("マイドライブ_テスト");
        std::fs::create_dir_all(&folder).unwrap();
        let data = folder.join("tasks_dev.json");
        let payload = b"\x89PNG\r\n\x1a\n not really a png, just bytes";
        let att = attachment_from_bytes(
            &data,
            "dev",
            1_000_000,
            "image.png".into(),
            Some("image/png".into()),
            payload,
        )
        .unwrap();
        let got = read_attachment_bytes(&data, &att.path).unwrap();
        assert_eq!(got, payload.to_vec());
    }

    #[test]
    fn read_attachment_bytes_rejects_unsafe_and_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("tasks_dev.json");
        // Same managed-path guard as every other attachment read.
        assert!(read_attachment_bytes(&data, "../secret").is_err());
        assert!(read_attachment_bytes(&data, "attachments_dev\\attachment_a.png").is_err());
        assert!(read_attachment_bytes(&data, "notmanaged.png").is_err());
        // A well-formed managed path whose blob is absent errors rather than panics.
        assert!(read_attachment_bytes(&data, "attachments_dev/attachment_missing.png").is_err());
    }

    #[test]
    fn clone_attachments_makes_independent_copies() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("tasks_dev.json");

        // A source blob the "template" references.
        let src_rel = "attachment_src_doc.bin";
        let mut f = std::fs::File::create(dir.path().join(src_rel)).unwrap();
        f.write_all(b"hello").unwrap();
        let src = vec![Attachment {
            id: "att_src".into(),
            name: "doc".into(),
            path: src_rel.into(),
            mime_type: Some("text/plain".into()),
            size: Some(5),
            created_at: 0,
        }];

        let cloned = clone_attachments(&data, "dev", &src).unwrap();
        let copies = cloned.attachments;
        assert_eq!(copies.len(), 1);
        let c = &copies[0];
        assert_ne!(c.id, "att_src", "copy gets a fresh id");
        assert_ne!(c.path, src_rel, "copy gets its own blob path");
        assert_eq!(
            cloned.path_map,
            vec![(src_rel.to_string(), c.path.clone())],
            "old attachment paths are mapped to copied paths for markdown rewrite"
        );
        assert!(
            c.path.starts_with("attachments_dev/"),
            "copy lands in the per-device subdir, got {}",
            c.path
        );
        assert_eq!(c.name, "doc");
        // The new blob exists with the same content, and the source is untouched.
        let copied = std::fs::read(dir.path().join(&c.path)).unwrap();
        assert_eq!(copied, b"hello");
        assert!(dir.path().join(src_rel).exists(), "source blob untouched");
    }

    #[test]
    fn clone_attachments_skips_a_missing_source_blob() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("tasks_dev.json");
        let src = vec![Attachment {
            id: "att_gone".into(),
            name: "gone".into(),
            path: "attachment_gone.bin".into(), // no file on disk
            mime_type: None,
            size: None,
            created_at: 0,
        }];
        let cloned = clone_attachments(&data, "dev", &src).unwrap();
        assert!(cloned.attachments.is_empty());
        assert!(cloned.path_map.is_empty());
    }

    #[test]
    fn migrate_attachments_moves_legacy_blobs_into_device_subdir() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("tasks_dev.json");
        let state = AppState::open(data).unwrap();

        let rel = "attachment_x_doc.bin";
        let mut f = std::fs::File::create(dir.path().join(rel)).unwrap();
        f.write_all(b"hi").unwrap();
        state
            .write(|d| {
                d.tasks.push(task_with_attachment("t1", rel));
                Ok(())
            })
            .unwrap();

        migrate_attachments_to_subdir(&state, "dev");

        assert!(!dir.path().join(rel).exists(), "flat blob is relocated");
        assert_eq!(
            std::fs::read(dir.path().join("attachments_dev").join(rel)).unwrap(),
            b"hi",
            "content preserved in the subdir"
        );
        let stored = state
            .read(|d| Ok::<_, AppError>(d.tasks[0].attachments[0].path.clone()))
            .unwrap();
        assert_eq!(stored, "attachments_dev/attachment_x_doc.bin");
    }

    #[test]
    fn copy_own_attachments_copies_device_subdir_to_new_folder() {
        let from_dir = tempfile::tempdir().unwrap();
        let to_dir = tempfile::tempdir().unwrap();
        let from = from_dir.path().join("tasks_dev.db");
        let to = to_dir.path().join("tasks_dev.db");
        let own = from_dir.path().join("attachments_dev");
        std::fs::create_dir_all(&own).unwrap();
        std::fs::write(own.join("attachment_a_x.bin"), b"blob-a").unwrap();
        // Peer tree must stay behind.
        let peer = from_dir.path().join("attachments_other");
        std::fs::create_dir_all(&peer).unwrap();
        std::fs::write(peer.join("attachment_b_y.bin"), b"blob-b").unwrap();

        copy_own_attachments(&from, &to).unwrap();

        assert_eq!(
            std::fs::read(to_dir.path().join("attachments_dev").join("attachment_a_x.bin")).unwrap(),
            b"blob-a"
        );
        assert!(
            from_dir
                .path()
                .join("attachments_dev")
                .join("attachment_a_x.bin")
                .exists(),
            "source left intact (copy, not move)"
        );
        assert!(
            !to_dir.path().join("attachments_other").exists(),
            "peer attachments_* must not be seeded"
        );
    }

    #[test]
    fn copy_own_attachments_is_noop_within_same_folder() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("tasks_dev.db");
        let to = dir.path().join("tasks_dev.db");
        let own = dir.path().join("attachments_dev");
        std::fs::create_dir_all(&own).unwrap();
        std::fs::write(own.join("attachment_a_x.bin"), b"x").unwrap();
        copy_own_attachments(&from, &to).unwrap();
        assert!(own.join("attachment_a_x.bin").exists());
    }

    #[test]
    fn copy_own_attachments_noop_when_source_subdir_missing() {
        let from_dir = tempfile::tempdir().unwrap();
        let to_dir = tempfile::tempdir().unwrap();
        let from = from_dir.path().join("tasks_dev.db");
        let to = to_dir.path().join("tasks_dev.db");
        copy_own_attachments(&from, &to).unwrap();
        assert!(!to_dir.path().join("attachments_dev").exists());
    }

    #[test]
    fn fill_missing_referenced_attachments_copies_only_gaps() {
        let from_dir = tempfile::tempdir().unwrap();
        let to_dir = tempfile::tempdir().unwrap();
        let from = from_dir.path().join("tasks_dev.db");
        let to = to_dir.path().join("tasks_dev.db");

        let missing_rel = "attachments_dev/attachment_missing_x.bin";
        let keep_rel = "attachments_dev/attachment_keep_y.bin";
        let orphan_rel = "attachments_dev/attachment_orphan_z.bin";
        std::fs::create_dir_all(from_dir.path().join("attachments_dev")).unwrap();
        std::fs::write(from_dir.path().join(missing_rel), b"from-missing").unwrap();
        std::fs::write(from_dir.path().join(keep_rel), b"from-keep").unwrap();
        std::fs::write(from_dir.path().join(orphan_rel), b"from-orphan").unwrap();

        std::fs::create_dir_all(to_dir.path().join("attachments_dev")).unwrap();
        std::fs::write(to_dir.path().join(keep_rel), b"dest-keep").unwrap();

        let mut doc = crate::model::Document::default();
        doc.tasks.push(task_with_attachment("t1", missing_rel));
        doc.tasks[0]
            .attachments
            .push(Attachment {
                id: "att_keep".into(),
                name: "keep".into(),
                path: keep_rel.into(),
                mime_type: None,
                size: Some(9),
                created_at: 0,
            });

        fill_missing_referenced_attachments(&from, &to, &doc).unwrap();

        assert_eq!(
            std::fs::read(to_dir.path().join(missing_rel)).unwrap(),
            b"from-missing",
            "missing referenced blob filled from old folder"
        );
        assert_eq!(
            std::fs::read(to_dir.path().join(keep_rel)).unwrap(),
            b"dest-keep",
            "existing destination blob must not be replaced"
        );
        assert!(
            !to_dir.path().join(orphan_rel).exists(),
            "unreferenced old blobs must not be copied"
        );
        assert!(
            from_dir.path().join(missing_rel).exists(),
            "source left intact"
        );
    }

    #[test]
    fn gc_attachment_files_removes_only_unreferenced_files() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("tasks_dev.json");
        let state = AppState::open(data).unwrap();

        // Two attachment blobs on disk; the doc references only the first.
        let kept = "attachment_keep.bin";
        let orphan = "attachment_orphan.bin";
        for name in [kept, orphan] {
            let mut f = std::fs::File::create(dir.path().join(name)).unwrap();
            f.write_all(b"x").unwrap();
        }
        state
            .write(|d| {
                d.tasks.push(task_with_attachment("k_1", kept));
                Ok(())
            })
            .unwrap();

        gc_attachment_files(&state, &[kept.to_string(), orphan.to_string()]);

        assert!(dir.path().join(kept).exists(), "referenced file must be kept");
        assert!(
            !dir.path().join(orphan).exists(),
            "unreferenced file must be deleted"
        );
    }

    #[test]
    fn read_conflict_doc_rejects_a_newer_schema_version() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();

        // A conflict file written by a future app build (version > CURRENT_VERSION)
        // must be refused, not silently merged into the master (#44).
        let newer = dir.path().join("tasks.sync-conflict-newer.json");
        let mut f = std::fs::File::create(&newer).unwrap();
        write!(f, r#"{{"version":{},"tasks":[],"tags":[]}}"#, crate::model::CURRENT_VERSION + 1).unwrap();
        assert!(read_conflict_doc(&newer).is_err(), "newer-version conflict file must be rejected");

        // A current-version conflict file still parses fine.
        let ok = dir.path().join("tasks.sync-conflict-ok.json");
        let mut f = std::fs::File::create(&ok).unwrap();
        write!(f, r#"{{"version":{},"tasks":[],"tags":[]}}"#, crate::model::CURRENT_VERSION).unwrap();
        assert!(read_conflict_doc(&ok).is_ok(), "current-version conflict file must parse");
    }

    #[test]
    fn update_task_input_absent_field_stays_none() {
        let v: UpdateTaskInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(v.due_date, None);
        assert_eq!(v.start_date, None);
    }

    #[test]
    fn time_entry_inputs_parse_the_keys_the_js_sends(/* #81 */) {
        let add: AddTimeEntryInput =
            serde_json::from_str(r#"{"task_id":"k_1","start":1000,"end":2000}"#).unwrap();
        assert_eq!(
            (add.task_id.as_str(), add.start, add.end),
            ("k_1", 1000, 2000)
        );

        // Update: start and/or end are optional; absent stays None.
        let upd: UpdateTimeEntryInput =
            serde_json::from_str(r#"{"task_id":"k_1","entry_id":"te_1","start":5}"#).unwrap();
        assert_eq!(upd.entry_id, "te_1");
        assert_eq!(upd.start, Some(5));
        assert_eq!(upd.end, None);

        let del: DeleteTimeEntryInput =
            serde_json::from_str(r#"{"task_id":"k_1","entry_id":"te_1"}"#).unwrap();
        assert_eq!(
            (del.task_id.as_str(), del.entry_id.as_str()),
            ("k_1", "te_1")
        );
    }

    #[test]
    fn update_task_input_null_field_clears() {
        let v: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","due_date":null,"start_date":null}"#).unwrap();
        assert_eq!(v.due_date, Some(None));
        assert_eq!(v.start_date, Some(None));
    }

    #[test]
    fn update_task_input_value_sets_field() {
        let v: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","due_date":"2026-06-01"}"#).unwrap();
        assert_eq!(
            v.due_date,
            Some(Some(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap()))
        );
    }

    #[test]
    fn task_time_fields_round_trip_and_clear(/* #93 */) {
        // Absent -> None (leave), null -> Some(None) (clear), value -> Some(Some) (set).
        let absent: UpdateTaskInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(absent.start_time, None);
        assert_eq!(absent.due_time, None);
        let cleared: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","start_time":null,"due_time":null}"#).unwrap();
        assert_eq!(cleared.start_time, Some(None));
        assert_eq!(cleared.due_time, Some(None));
        let set: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","start_time":"09:30"}"#).unwrap();
        assert_eq!(set.start_time, Some(Some("09:30".to_string())));
        let new: NewTaskInput =
            serde_json::from_str(r#"{"title":"t","due_time":"23:59"}"#).unwrap();
        assert_eq!(new.due_time.as_deref(), Some("23:59"));
    }

    #[test]
    fn task_estimated_seconds_round_trip_and_clear() {
        let absent: UpdateTaskInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(absent.estimated_seconds, None);
        let cleared: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","estimated_seconds":null}"#).unwrap();
        assert_eq!(cleared.estimated_seconds, Some(None));
        let set: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","estimated_seconds":90}"#).unwrap();
        assert_eq!(set.estimated_seconds, Some(Some(90)));
        let new: NewTaskInput =
            serde_json::from_str(r#"{"title":"t","estimated_seconds":30}"#).unwrap();
        assert_eq!(new.estimated_seconds, Some(30));
    }

    #[test]
    fn validate_estimated_seconds_accepts_positive_seconds_only() {
        assert!(validate_estimated_seconds(None).is_ok());
        assert!(validate_estimated_seconds(Some(1)).is_ok());
        assert!(validate_estimated_seconds(Some(ESTIMATED_SECONDS_MAX)).is_ok());
        assert!(validate_estimated_seconds(Some(0)).is_err());
        assert!(validate_estimated_seconds(Some(-1)).is_err());
        assert!(validate_estimated_seconds(Some(ESTIMATED_SECONDS_MAX + 1)).is_err());
    }

    #[test]
    fn validate_time_accepts_hh_mm_and_rejects_garbage(/* #93 */) {
        assert!(validate_time(None).is_ok()); // all-day
        assert!(validate_time(Some("00:00")).is_ok());
        assert!(validate_time(Some("09:30")).is_ok());
        assert!(validate_time(Some("23:59")).is_ok());
        assert!(validate_time(Some("24:00")).is_err()); // hour out of range
        assert!(validate_time(Some("5pm")).is_err()); // not HH:MM
        assert!(validate_time(Some("09:30:00")).is_err()); // trailing seconds
    }

    #[test]
    fn update_tag_input_priority_parses() {
        let v: UpdateTagInput = serde_json::from_str(r#"{"id":"t_1","priority":9}"#).unwrap();
        assert_eq!(v.priority, Some(9));
        let absent: UpdateTagInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(absent.priority, None);
    }

    #[test]
    fn update_tag_input_pinned_parses() {
        // An absent `pinned` leaves the tag's flag untouched (None); a present
        // value drives the toggle (#78).
        let absent: UpdateTagInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(absent.pinned, None);
        let set: UpdateTagInput = serde_json::from_str(r#"{"id":"t_1","pinned":true}"#).unwrap();
        assert_eq!(set.pinned, Some(true));
    }

    #[test]
    fn update_tag_input_dashboard_view_parses_absent_null_value() {
        // Absent leaves the pin untouched; explicit null unpins; a string pins to
        // that view (#dashboard). Mirrors the template dashboard_view tri-state.
        let absent: UpdateTagInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(absent.dashboard_view, None);
        let cleared: UpdateTagInput =
            serde_json::from_str(r#"{"id":"t_1","dashboard_view":null}"#).unwrap();
        assert_eq!(cleared.dashboard_view, Some(None));
        let set: UpdateTagInput =
            serde_json::from_str(r#"{"id":"t_1","dashboard_view":"streak"}"#).unwrap();
        assert_eq!(set.dashboard_view, Some(Some("streak".into())));
    }

    #[test]
    fn new_tag_input_priority_defaults_zero() {
        let v: NewTagInput = serde_json::from_str(r##"{"name":"x","color":"#fff"}"##).unwrap();
        assert_eq!(v.priority, 0);
    }

    #[test]
    fn new_tag_input_pinned_defaults_false() {
        let v: NewTagInput = serde_json::from_str(r##"{"name":"x","color":"#fff"}"##).unwrap();
        assert!(!v.pinned);
        let pinned: NewTagInput =
            serde_json::from_str(r##"{"name":"x","color":"#fff","pinned":true}"##).unwrap();
        assert!(pinned.pinned);
    }

    #[test]
    fn retain_known_tags_strips_unknown_ids() {
        let tags = vec![Tag {
            id: "t_known".into(),
            name: "k".into(),
            color: "#000".into(),
            priority: 0,
            pinned: false,
            updated_at: 1,
            dashboard_view: None,
        }];
        let out = retain_known_tags(
            vec!["t_known".into(), "t_unknown".into(), "t_known".into()],
            &tags,
        );
        assert_eq!(out, vec!["t_known".to_string(), "t_known".to_string()]);
    }

    #[test]
    fn retain_known_tags_empty_when_no_tags_exist() {
        let out = retain_known_tags(vec!["t_x".into(), "t_y".into()], &[]);
        assert!(out.is_empty());
    }

    #[test]
    fn update_settings_input_parses_sort_order() {
        // Pins the snake_case `sort_order` key that the JS api sends.
        let v: UpdateSettingsInput = serde_json::from_str(r#"{"sort_order":"date"}"#).unwrap();
        assert_eq!(v.sort_order.as_deref(), Some("date"));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.sort_order, None);
        assert_eq!(absent.theme, None);
    }

    #[test]
    fn update_settings_input_parses_upcoming_days() {
        // Pins the snake_case `upcoming_days` key that the JS api sends.
        let v: UpdateSettingsInput = serde_json::from_str(r#"{"upcoming_days":30}"#).unwrap();
        assert_eq!(v.upcoming_days, Some(30));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.upcoming_days, None);
    }

    #[test]
    fn update_settings_input_parses_day_start_hour() {
        // Pins the snake_case `day_start_hour` key that the JS api sends.
        let v: UpdateSettingsInput = serde_json::from_str(r#"{"day_start_hour":4}"#).unwrap();
        assert_eq!(v.day_start_hour, Some(4));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.day_start_hour, None);
    }

    #[test]
    fn update_settings_input_parses_new_tag_defaults() {
        // Pins the snake_case keys the JS api sends (#79).
        let v: UpdateSettingsInput =
            serde_json::from_str(r##"{"default_tag_color":"#ef4444","default_tag_priority":7}"##)
                .unwrap();
        assert_eq!(v.default_tag_color.as_deref(), Some("#ef4444"));
        assert_eq!(v.default_tag_priority, Some(7));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.default_tag_color, None);
        assert_eq!(absent.default_tag_priority, None);
    }

    #[test]
    fn update_settings_input_parses_language() {
        // Pins the `language` key the JS api sends (#26).
        let v: UpdateSettingsInput = serde_json::from_str(r#"{"language":"zh-TW"}"#).unwrap();
        assert_eq!(v.language.as_deref(), Some("zh-TW"));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.language, None);
    }

    #[test]
    fn update_settings_input_parses_sound_on_complete() {
        // Pins the snake_case `sound_on_complete` key the JS api sends (#80).
        let off: UpdateSettingsInput =
            serde_json::from_str(r#"{"sound_on_complete":false}"#).unwrap();
        assert_eq!(off.sound_on_complete, Some(false));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.sound_on_complete, None);
    }

    #[test]
    fn update_settings_input_parses_reminder_interval_minutes() {
        // Pins the snake_case `reminder_interval_minutes` key the JS api sends.
        let v: UpdateSettingsInput =
            serde_json::from_str(r#"{"reminder_interval_minutes":30}"#).unwrap();
        assert_eq!(v.reminder_interval_minutes, Some(30));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.reminder_interval_minutes, None);
    }

    #[test]
    fn update_settings_input_parses_max_attachment_mb() {
        // Pins the snake_case `max_attachment_mb` key the JS api sends.
        let v: UpdateSettingsInput =
            serde_json::from_str(r#"{"max_attachment_mb":2048}"#).unwrap();
        assert_eq!(v.max_attachment_mb, Some(2048));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.max_attachment_mb, None);
    }

    #[test]
    fn update_settings_input_parses_recurrence_heatmap_days() {
        // Pins the snake_case `recurrence_heatmap_days` key the JS api sends.
        let v: UpdateSettingsInput =
            serde_json::from_str(r#"{"recurrence_heatmap_days":120}"#).unwrap();
        assert_eq!(v.recurrence_heatmap_days, Some(120));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.recurrence_heatmap_days, None);
    }

    #[test]
    fn update_settings_input_parses_first_day_of_week() {
        // Pins the snake_case `first_day_of_week` key the JS api sends.
        let v: UpdateSettingsInput = serde_json::from_str(r#"{"first_day_of_week":0}"#).unwrap();
        assert_eq!(v.first_day_of_week, Some(0));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.first_day_of_week, None);
    }

    #[test]
    fn update_settings_input_parses_date_time_format() {
        // Pins the snake_case `date_time_format` key the JS api sends.
        let v: UpdateSettingsInput =
            serde_json::from_str(r#"{"date_time_format":"japanese"}"#).unwrap();
        assert_eq!(v.date_time_format.as_deref(), Some("japanese"));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.date_time_format, None);
    }

    #[test]
    fn update_settings_input_parses_date_and_time_formats() {
        let v: UpdateSettingsInput = serde_json::from_str(
            r#"{"date_format":"chinese_lunar","time_format":"chinese_day_period"}"#,
        )
        .unwrap();
        assert_eq!(v.date_format.as_deref(), Some("chinese_lunar"));
        assert_eq!(v.time_format.as_deref(), Some("chinese_day_period"));
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.date_format, None);
        assert_eq!(absent.time_format, None);
    }

    #[test]
    fn update_settings_input_parses_theme_customization() {
        // Pins the snake_case keys the JS api sends (#15).
        let v: UpdateSettingsInput = serde_json::from_str(
            r##"{"theme_preset":"custom_1","custom_presets":[{"id":"custom_1","name":"Mine","light":{"--c-accent":"#ff0000"},"dark":{"--c-bg":"#000000"}}]}"##,
        ).unwrap();
        assert_eq!(v.theme_preset.as_deref(), Some("custom_1"));
        let presets = v.custom_presets.unwrap();
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].id, "custom_1");
        assert_eq!(presets[0].name, "Mine");
        assert_eq!(
            presets[0].light.get("--c-accent").map(String::as_str),
            Some("#ff0000")
        );
        assert_eq!(
            presets[0].dark.get("--c-bg").map(String::as_str),
            Some("#000000")
        );
        let absent: UpdateSettingsInput = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(absent.theme_preset, None);
        assert!(absent.custom_presets.is_none());
    }

    #[test]
    fn is_preset_id_accepts_sane_ids_and_rejects_junk() {
        assert!(is_preset_id("default"));
        assert!(is_preset_id("custom_1a2b"));
        assert!(is_preset_id("a-b-1"));
        assert!(!is_preset_id("")); // empty
        assert!(!is_preset_id("Slate")); // uppercase
        assert!(!is_preset_id("drop table")); // space
        assert!(!is_preset_id(&"x".repeat(65))); // too long
    }

    fn preset(id: &str, name: &str, light: &[(&str, &str)]) -> ThemePreset {
        ThemePreset {
            id: id.to_string(),
            name: name.to_string(),
            light: light
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            dark: HashMap::new(),
        }
    }

    #[test]
    fn validate_custom_presets_accepts_well_formed_presets() {
        let ps = vec![preset(
            "custom_1",
            "Mine",
            &[("--c-accent", "#ff0000"), ("--c-bg", "#fff")],
        )];
        assert!(validate_custom_presets(&ps).is_ok());
    }

    #[test]
    fn validate_custom_presets_rejects_non_hex_value() {
        let ps = vec![preset("custom_1", "Mine", &[("--c-accent", "red")])];
        assert!(validate_custom_presets(&ps).is_err());
    }

    #[test]
    fn validate_custom_presets_rejects_malformed_token_key() {
        let ps = vec![preset(
            "custom_1",
            "Mine",
            &[("javascript:alert(1)", "#ffffff")],
        )];
        assert!(validate_custom_presets(&ps).is_err());
    }

    #[test]
    fn validate_custom_presets_rejects_bad_id_or_empty_name() {
        assert!(validate_custom_presets(&[preset("Bad Id", "Mine", &[])]).is_err());
        assert!(validate_custom_presets(&[preset("custom_1", "", &[])]).is_err());
    }

    #[test]
    fn is_hex_color_accepts_short_and_long_forms() {
        assert!(is_hex_color("#10b981"));
        assert!(is_hex_color("#FFF"));
        assert!(is_hex_color("#abcDEF"));
    }

    #[test]
    fn is_hex_color_rejects_malformed_values() {
        assert!(!is_hex_color("10b981")); // no leading '#'
        assert!(!is_hex_color("#12g456")); // non-hex digit
        assert!(!is_hex_color("#1234")); // wrong length
        assert!(!is_hex_color("#")); // empty body
        assert!(!is_hex_color("red")); // not hex at all
    }

    #[test]
    fn validate_conflict_path_accepts_a_scanner_named_file_in_the_data_dir() {
        let data = Path::new("/data/tasks.json");
        // Matches store.rs's `{stem}.conflict-local-{ms}.json` shape.
        assert!(validate_conflict_path("/data/tasks.conflict-local-123.json", data).is_ok());
        // And a cloud-sync sibling the scanner would also surface.
        assert!(validate_conflict_path("/data/tasks.sync-conflict-1.json", data).is_ok());
    }

    #[test]
    fn validate_conflict_path_rejects_a_path_outside_the_data_dir() {
        let data = Path::new("/data/tasks.json");
        assert!(validate_conflict_path("/etc/passwd", data).is_err());
        // Right name, wrong directory.
        assert!(validate_conflict_path("/other/tasks.conflict-local-1.json", data).is_err());
        // A `..` escape resolves to a different parent, so it's rejected.
        assert!(validate_conflict_path("/data/sub/../tasks.conflict-local-1.json", data).is_err());
    }

    #[test]
    fn validate_conflict_path_rejects_the_data_file_and_non_conflict_siblings() {
        let data = Path::new("/data/tasks.json");
        assert!(validate_conflict_path("/data/tasks.json", data).is_err());
        assert!(validate_conflict_path("/data/notes.txt", data).is_err());
        // Same dir + .json but neither mentions "conflict" nor starts with the stem.
        assert!(validate_conflict_path("/data/random.json", data).is_err());
    }

    #[test]
    fn validate_conflict_path_filename_match_is_case_insensitive() {
        // Mirrors scan_conflict_files's lowercasing so a Windows-cased name isn't
        // rejected when the scanner would have surfaced it.
        let data = Path::new("/data/tasks.json");
        assert!(validate_conflict_path("/data/Tasks.CONFLICT-local-1.JSON", data).is_ok());
    }

    #[test]
    fn new_template_input_parses_offset_fields() {
        // Pins the snake_case keys the JS api sends for a template (#71).
        let v: NewTemplateInput = serde_json::from_str(
            r#"{"title":"t","due_offset_days":3,"start_offset_days":0,"notes":"n","tag_ids":["t_x"]}"#,
        ).unwrap();
        assert_eq!(v.due_offset_days, Some(3));
        assert_eq!(v.start_offset_days, Some(0));
        assert_eq!(v.notes, "n");
        assert_eq!(v.tag_ids, ["t_x"]);
        // Absent offsets default to None (no spawned date).
        let plain: NewTemplateInput = serde_json::from_str(r#"{"title":"t"}"#).unwrap();
        assert_eq!(plain.due_offset_days, None);
        assert_eq!(plain.start_offset_days, None);
    }

    #[test]
    fn update_template_input_offset_double_option_distinguishes_absent_null_value() {
        // Mirrors the due_date double_option semantics for offsets.
        let absent: UpdateTemplateInput = serde_json::from_str(r#"{"id":"k_1"}"#).unwrap();
        assert_eq!(absent.due_offset_days, None);
        assert_eq!(absent.title, None);
        let cleared: UpdateTemplateInput =
            serde_json::from_str(r#"{"id":"k_1","due_offset_days":null}"#).unwrap();
        assert_eq!(cleared.due_offset_days, Some(None));
        let set: UpdateTemplateInput =
            serde_json::from_str(r#"{"id":"k_1","title":"x","due_offset_days":5}"#).unwrap();
        assert_eq!(set.title.as_deref(), Some("x"));
        assert_eq!(set.due_offset_days, Some(Some(5)));
    }

    #[test]
    fn update_template_input_parses_dashboard_view_absent_null_value() {
        // null unpins (Some(None)); absent leaves it (None); a value pins.
        let absent: UpdateTemplateInput = serde_json::from_str(r#"{"id":"k_1"}"#).unwrap();
        assert_eq!(absent.dashboard_view, None);
        let cleared: UpdateTemplateInput =
            serde_json::from_str(r#"{"id":"k_1","dashboard_view":null}"#).unwrap();
        assert_eq!(cleared.dashboard_view, Some(None));
        let set: UpdateTemplateInput =
            serde_json::from_str(r#"{"id":"k_1","dashboard_view":"streak"}"#).unwrap();
        assert_eq!(set.dashboard_view, Some(Some("streak".into())));
    }

    #[test]
    fn validate_dashboard_view_rejects_unknown_kinds() {
        assert!(validate_dashboard_view(None).is_ok());
        assert!(validate_dashboard_view(Some(&"heatmap".to_string())).is_ok());
        assert!(validate_dashboard_view(Some(&"streak".to_string())).is_ok());
        assert!(validate_dashboard_view(Some(&"bogus".to_string())).is_err());
    }

    #[test]
    fn template_inputs_parse_estimated_seconds() {
        let new: NewTemplateInput =
            serde_json::from_str(r#"{"title":"t","estimated_seconds":50}"#).unwrap();
        assert_eq!(new.estimated_seconds, Some(50));

        let absent: UpdateTemplateInput = serde_json::from_str(r#"{"id":"k_1"}"#).unwrap();
        assert_eq!(absent.estimated_seconds, None);
        let cleared: UpdateTemplateInput =
            serde_json::from_str(r#"{"id":"k_1","estimated_seconds":null}"#).unwrap();
        assert_eq!(cleared.estimated_seconds, Some(None));
        let set: UpdateTemplateInput =
            serde_json::from_str(r#"{"id":"k_1","estimated_seconds":3600}"#).unwrap();
        assert_eq!(set.estimated_seconds, Some(Some(3600)));
    }

    #[test]
    fn new_template_input_parses_recurrence() {
        let v: NewTemplateInput = serde_json::from_str(
            r#"{"title":"t","recurrence":{"kind":"weekly","weekdays":[1,5]}}"#,
        )
        .unwrap();
        assert_eq!(
            v.recurrence,
            Some(crate::model::Recurrence::Weekly {
                weekdays: vec![1, 5]
            })
        );
        let plain: NewTemplateInput = serde_json::from_str(r#"{"title":"t"}"#).unwrap();
        assert_eq!(plain.recurrence, None);
    }

    #[test]
    fn validate_recurrence_bounds() {
        use crate::model::{Recurrence, YearlyDate};
        let yd = |month, day| YearlyDate { month, day };
        assert!(validate_recurrence(None).is_ok());
        assert!(validate_recurrence(Some(&Recurrence::Weekly {
            weekdays: vec![1, 7]
        }))
        .is_ok());
        assert!(validate_recurrence(Some(&Recurrence::Monthly { days: vec![1, 31] })).is_ok());
        // Empty weekday set is meaningless.
        assert!(validate_recurrence(Some(&Recurrence::Weekly { weekdays: vec![] })).is_err());
        // Out-of-range weekday (0 or >7) and day-of-month (0 or >31).
        assert!(validate_recurrence(Some(&Recurrence::Weekly { weekdays: vec![0] })).is_err());
        assert!(validate_recurrence(Some(&Recurrence::Weekly { weekdays: vec![8] })).is_err());
        // Monthly: needs at least one day, each 1..=31.
        assert!(validate_recurrence(Some(&Recurrence::Monthly { days: vec![] })).is_err());
        assert!(validate_recurrence(Some(&Recurrence::Monthly { days: vec![0] })).is_err());
        assert!(validate_recurrence(Some(&Recurrence::Monthly { days: vec![32] })).is_err());
        assert!(validate_recurrence(Some(&Recurrence::Monthly { days: vec![15, 32] })).is_err());
        // Daily always fires.
        assert!(validate_recurrence(Some(&Recurrence::Daily)).is_ok());
        // Yearly: needs at least one date; each month 1..=12 and day valid for it
        // (Feb allows 29 for leap years).
        assert!(validate_recurrence(Some(&Recurrence::Yearly {
            dates: vec![yd(3, 15), yd(12, 25)]
        }))
        .is_ok());
        assert!(validate_recurrence(Some(&Recurrence::Yearly {
            dates: vec![yd(2, 29)]
        }))
        .is_ok());
        assert!(validate_recurrence(Some(&Recurrence::Yearly { dates: vec![] })).is_err());
        assert!(validate_recurrence(Some(&Recurrence::Yearly {
            dates: vec![yd(0, 1)]
        }))
        .is_err());
        assert!(validate_recurrence(Some(&Recurrence::Yearly {
            dates: vec![yd(13, 1)]
        }))
        .is_err());
        assert!(validate_recurrence(Some(&Recurrence::Yearly {
            dates: vec![yd(2, 30)]
        }))
        .is_err());
        assert!(validate_recurrence(Some(&Recurrence::Yearly {
            dates: vec![yd(4, 31)]
        }))
        .is_err());
        assert!(validate_recurrence(Some(&Recurrence::Yearly {
            dates: vec![yd(1, 0)]
        }))
        .is_err());
        // One bad date among good ones still fails.
        assert!(validate_recurrence(Some(&Recurrence::Yearly {
            dates: vec![yd(1, 1), yd(4, 31)]
        }))
        .is_err());
    }

    #[test]
    fn validate_recurrence_tag_requires_a_template_tag() {
        use crate::model::Recurrence;
        let weekly = Recurrence::Weekly { weekdays: vec![1] };
        assert!(validate_recurrence_tag(None, None, &[]).is_ok()); // no schedule, no tag: fine
        assert!(validate_recurrence_tag(Some(&weekly), None, &["t_a".into()]).is_err()); // scheduled, none chosen
        assert!(
            validate_recurrence_tag(Some(&weekly), Some(&"t_b".to_string()), &["t_a".into()])
                .is_err()
        ); // not a template tag
        assert!(validate_recurrence_tag(
            Some(&weekly),
            Some(&"t_a".to_string()),
            &["t_a".into(), "t_b".into()]
        )
        .is_ok());
    }

    #[test]
    fn new_template_input_parses_recurrence_tag_id() {
        let v: NewTemplateInput = serde_json::from_str(
            r#"{"title":"t","recurrence":{"kind":"weekly","weekdays":[1]},"recurrence_tag_id":"t_ex"}"#,
        ).unwrap();
        assert_eq!(v.recurrence_tag_id.as_deref(), Some("t_ex"));
    }

    #[test]
    fn validate_offset_days_bounds() {
        assert!(validate_offset_days(None).is_ok());
        assert!(validate_offset_days(Some(0)).is_ok());
        assert!(validate_offset_days(Some(OFFSET_DAYS_MAX)).is_ok());
        assert!(validate_offset_days(Some(-1)).is_err());
        assert!(validate_offset_days(Some(OFFSET_DAYS_MAX + 1)).is_err());
    }

    #[test]
    fn due_date_from_offset_resolves_against_occurrence_date() {
        let occurrence = NaiveDate::from_ymd_opt(2026, 6, 8).unwrap();
        assert_eq!(due_date_from_offset(occurrence, None), None);
        assert_eq!(due_date_from_offset(occurrence, Some(0)), Some(occurrence));
        assert_eq!(
            due_date_from_offset(occurrence, Some(3)),
            Some(NaiveDate::from_ymd_opt(2026, 6, 11).unwrap()),
        );
    }

    #[test]
    fn spawn_recurring_task_input_parses_camel_case_keys() {
        // The JS api sends { templateId, occurrenceDate }.
        let v: SpawnRecurringTaskInput =
            serde_json::from_str(r#"{"templateId":"k_1","occurrenceDate":"2026-06-08"}"#).unwrap();
        assert_eq!(v.template_id, "k_1");
        assert_eq!(
            v.occurrence_date,
            NaiveDate::from_ymd_opt(2026, 6, 8).unwrap()
        );
    }
}
