use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Shortened uuid (12 hex chars) with a type prefix. Stable across devices.
fn short_id(prefix: &str) -> String {
    let hex = Uuid::new_v4().simple().to_string();
    format!("{prefix}_{}", &hex[..12])
}

pub fn new_task_id() -> String {
    short_id("k")
}
pub fn new_tag_id() -> String {
    short_id("t")
}
pub fn new_time_entry_id() -> String {
    short_id("te")
}
pub fn new_attachment_id() -> String {
    short_id("att")
}

/// Epoch milliseconds. Used in memory for created_at/updated_at/last_modified and
/// for unique conflict-file names. UTC-based, so it's stable across devices and
/// timezone changes. On disk these stamps are written as ISO-8601 strings in the
/// writer's local time with an explicit offset, truncated to the second (see
/// `iso_secs`); the offset keeps the instant unambiguous and the in-memory value
/// keeps full millisecond resolution.
pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// True when a timestamp is the epoch-0 "unset" sentinel. Used by
/// `skip_serializing_if` so a never-edited document / pre-`updated_at` task omits
/// the key entirely rather than writing a misleading 1970 timestamp.
pub(crate) fn is_zero(ms: &i64) -> bool {
    *ms == 0
}

/// Serde for an `i64` epoch-millis field stored as an ISO-8601 local-time string
/// at second precision (e.g. `2026-06-01T20:34:56+08:00`). Deserialization accepts
/// either representation and any offset, so integer-millis files written by older
/// builds (or other devices, in their own timezones) keep loading — the model
/// stays backward compatible (AGENTS.md). Serialization always writes the ISO
/// string.
pub(crate) mod iso_secs {
    use chrono::{DateTime, Local, SecondsFormat, TimeZone};
    use serde::{Deserialize, Deserializer, Serializer};

    /// Epoch millis -> ISO-8601 in the machine's local time with an explicit offset,
    /// truncated to the second (e.g. `2026-06-01T20:34:56+08:00`). The offset keeps
    /// the instant unambiguous, so `from_iso` recovers the same `ms` regardless of
    /// where the file is later read. Falls back to the raw integer string for an
    /// out-of-range instant (chrono can't represent it), which still round-trips
    /// through the integer arm of `deserialize`.
    pub(crate) fn to_iso(ms: i64) -> String {
        match Local.timestamp_millis_opt(ms).single() {
            Some(dt) => dt.to_rfc3339_opts(SecondsFormat::Secs, false),
            None => ms.to_string(),
        }
    }

    /// ISO-8601 string -> epoch millis (any offset is normalized to UTC).
    pub(super) fn from_iso(s: &str) -> Option<i64> {
        DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.timestamp_millis())
    }

    /// Accept either a JSON integer (legacy epoch millis) or an ISO-8601 string.
    #[derive(Deserialize)]
    #[serde(untagged)]
    pub(super) enum IntOrIso {
        Int(i64),
        Iso(String),
    }

    impl IntOrIso {
        pub(super) fn into_ms<E: serde::de::Error>(self) -> Result<i64, E> {
            match self {
                IntOrIso::Int(ms) => Ok(ms),
                IntOrIso::Iso(s) => from_iso(&s)
                    .ok_or_else(|| E::custom(format!("invalid ISO-8601 timestamp: {s}"))),
            }
        }
    }

    pub fn serialize<S: Serializer>(ms: &i64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&to_iso(*ms))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
        IntOrIso::deserialize(d)?.into_ms()
    }
}

/// `iso_secs` for an `Option<i64>` (e.g. `completed_at`). `None` serializes as
/// JSON null; combined with `skip_serializing_if = "Option::is_none"` it is simply
/// omitted. Deserialization accepts null, an integer, or an ISO-8601 string.
mod iso_secs_opt {
    use super::iso_secs::{self, IntOrIso};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(ms: &Option<i64>, s: S) -> Result<S::Ok, S::Error> {
        match ms {
            Some(v) => iso_secs::serialize(v, s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
        match Option::<IntOrIso>::deserialize(d)? {
            Some(v) => v.into_ms().map(Some),
            None => Ok(None),
        }
    }
}

/// One stretch of time worked on a task (#81). `start`/`end` are epoch millis in
/// memory, written as ISO-8601 local-time strings on disk (see `iso_secs`). An
/// `end` of `None` is the **running** timer — the open interval; closed entries
/// are finished sessions. Stored on the task, so it syncs like the rest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimeEntry {
    pub id: String,
    #[serde(with = "iso_secs")]
    pub start: i64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "iso_secs_opt"
    )]
    pub end: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
    /// Priority weight. A task's effective priority is the max weight among its
    /// tags (0 if it has none). `#[serde(default)]` = 0 for tags written before
    /// this field existed. Range enforced by the UI to -9999..=9999.
    #[serde(default)]
    pub priority: i64,
    /// Whether this tag is pinned to the sidebar's curated tag list (#78). The
    /// sidebar shows only pinned tags; the full set stays reachable on the Tags
    /// screen. `#[serde(default)]` = false for tags written before this field
    /// existed, so an upgrade hides every legacy tag until the user pins some.
    /// Synced like the rest of the tag, so a curated sidebar follows across devices.
    #[serde(default)]
    pub pinned: bool,
    /// Epoch millis of the last edit to this tag. Missing legacy values fall back
    /// to the containing document's `last_modified` during replica merges.
    #[serde(default, skip_serializing_if = "is_zero", with = "iso_secs")]
    pub updated_at: i64,
    /// Which Dashboard view this tag is pinned to (#dashboard): "heatmap" or
    /// "streak"; `None` = not on the Dashboard. Stored on the tag (not a
    /// template) so any tag — recurring or not — can be pinned, with its
    /// activity heatmap aggregated across every task carrying it. Synced like the
    /// rest of the tag, so the Dashboard layout follows across devices.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dashboard_view: Option<String>,
    /// User-defined order among pinned Dashboard tags (#171). Lower values appear
    /// first; `None` falls back to name sort among unordered cards. Synced like the
    /// rest of the tag via per-tag LWW.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dashboard_order: Option<i64>,
}

/// A delete marker used by per-device replica files. Without this, an older
/// replica that still contains an entity would resurrect it after another device
/// deleted it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tombstone {
    pub id: String,
    #[serde(with = "iso_secs")]
    pub deleted_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_by: Option<String>,
}

/// A fixed calendar date (month 1..=12 + day-of-month) within a year, used by the
/// yearly recurrence pattern (#9). Exact match, no clamp.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct YearlyDate {
    pub month: u8,
    pub day: u8,
}

/// A template's recurrence schedule (#9). The frontend projects "ghost" rows from
/// it into the date-based views; this type is just the stored rule. Weekday numbers
/// are ISO 1=Mon..7=Sun. Deserialized through `RecurrenceCompat` so the pre-multi-day
/// shapes (`monthly {day}`, `yearly {month,day}`) still load.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", from = "RecurrenceCompat")]
pub enum Recurrence {
    /// Fires on each listed weekday (ISO 1=Mon..7=Sun). The "Weekdays" preset is
    /// [1,2,3,4,5]. Validated non-empty with in-range days by the command layer.
    Weekly { weekdays: Vec<u8> },
    /// Fires on each listed day-of-month (1..=31); a day past the month's length
    /// clamps to the last day (handled where occurrences are computed).
    Monthly { days: Vec<u8> },
    /// Fires every day.
    Daily,
    /// Fires on each listed month+day each year. Exact match, no clamp: a Feb-29
    /// entry fires only in leap years and is simply skipped otherwise (handled where
    /// occurrences are computed).
    Yearly { dates: Vec<YearlyDate> },
}

/// Load-time compatibility shim for `Recurrence`. Accepts both the current
/// multi-day shapes (`days`, `dates`) and the original single-day shapes
/// (`monthly {day}` shipped in 0.2.0; `yearly {month,day}`), folding the latter
/// into the former so older documents load unchanged.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum RecurrenceCompat {
    Weekly {
        weekdays: Vec<u8>,
    },
    Monthly {
        #[serde(default)]
        day: Option<u8>,
        #[serde(default)]
        days: Option<Vec<u8>>,
    },
    Daily,
    Yearly {
        #[serde(default)]
        month: Option<u8>,
        #[serde(default)]
        day: Option<u8>,
        #[serde(default)]
        dates: Option<Vec<YearlyDate>>,
    },
}

impl From<RecurrenceCompat> for Recurrence {
    fn from(c: RecurrenceCompat) -> Self {
        match c {
            RecurrenceCompat::Weekly { weekdays } => Recurrence::Weekly { weekdays },
            RecurrenceCompat::Daily => Recurrence::Daily,
            RecurrenceCompat::Monthly { day, days } => {
                let mut days = days.unwrap_or_default();
                if days.is_empty() {
                    if let Some(d) = day {
                        days.push(d);
                    }
                }
                Recurrence::Monthly { days }
            }
            RecurrenceCompat::Yearly { month, day, dates } => {
                let mut dates = dates.unwrap_or_default();
                if dates.is_empty() {
                    if let (Some(month), Some(day)) = (month, day) {
                        dates.push(YearlyDate { month, day });
                    }
                }
                Recurrence::Yearly { dates }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(with = "iso_secs")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(from = "TaskCompat")]
pub struct Task {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub due_date: Option<NaiveDate>,
    /// Optional time-of-day for `due_date`, "HH:MM" local wall-clock. `None` =
    /// all-day (the only state before #93); only meaningful when `due_date` is set.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub due_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub start_date: Option<NaiveDate>,
    /// Optional time-of-day for `start_date`, "HH:MM" local wall-clock (#93).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    /// Estimated effort in whole seconds. Missing means no estimate, so older
    /// task files keep loading and tasks without estimates still omit the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_seconds: Option<i64>,
    #[serde(serialize_with = "iso_secs::serialize")]
    pub created_at: i64,
    /// Epoch millis the task was completed. The **single source of truth** for
    /// completion *and* archival: `Some` = done and swept out of the active views
    /// (Today/Inbox/tag/Upcoming); `None` = active. The previously-separate
    /// `done`/`archived`/`archived_at` fields collapsed into this one and are now
    /// derived via `done()`/`archived()`/`archived_at()`. Legacy files that still
    /// carry those keys are folded in on load by `TaskCompat`.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        serialize_with = "iso_secs_opt::serialize"
    )]
    pub completed_at: Option<i64>,
    /// Epoch millis of the last edit to this task. `#[serde(default)]` = 0 for
    /// tasks written before this field existed (UI falls back to created_at);
    /// `skip_serializing_if` then omits the key rather than writing a 1970 ISO date.
    #[serde(
        default,
        skip_serializing_if = "is_zero",
        serialize_with = "iso_secs::serialize"
    )]
    pub updated_at: i64,
    /// Recorded time-tracking sessions (#81). An entry with no `end` is the running
    /// timer. `#[serde(default)]` = empty for tasks written before this field
    /// existed; `skip_serializing_if` then omits the key entirely so untracked
    /// tasks serialize byte-for-byte as before.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub time_entries: Vec<TimeEntry>,
}

/// A reusable blueprint, not real work to do (#71). Lives in its own
/// `Document::template_tasks` list — separate from active `tasks` (v5+) — so a
/// template never competes with the task center or shows up in any active view or
/// search. New ordinary tasks are spawned from it in the Templates view (the
/// frontend resolves the relative offsets to absolute dates and creates a task via
/// `add_task`). Carries only blueprint fields: no completion/dates of its own.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TemplateTask {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(with = "iso_secs")]
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "is_zero", with = "iso_secs")]
    pub updated_at: i64,
    /// The spawned task's due date is today + this many days. `None` = no due date.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub due_offset_days: Option<i64>,
    /// The spawned task's start date is today + this many days. `None` = none.
    /// Legacy files wrote `scheduled_offset_days`; the alias keeps them loading (#renamed).
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        alias = "scheduled_offset_days"
    )]
    pub start_offset_days: Option<i64>,
    /// The spawned task's estimated effort in whole seconds. `None` = no estimate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_seconds: Option<i64>,
    /// Optional recurrence schedule (#9). `None` = a manual-only template (the
    /// pre-#9 behavior). `#[serde(default)]` so older files load; `skip_serializing_if`
    /// keeps a manual template serializing byte-for-byte as before.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<Recurrence>,
    /// Which tag the recurrence is keyed to (#9). Must be one of `tag_ids`. Only
    /// meaningful when `recurrence` is set; ghost suppression checks this tag alone,
    /// so a template can carry other tags for organization. `None` for non-recurring
    /// templates and older files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence_tag_id: Option<String>,
    /// Earliest date (YYYY-MM-DD) the recurrence schedule takes effect. Days before
    /// this date do not spawn ghost rows or show in the heatmap, even if the
    /// recurrence rule would otherwise fire. `None` = no bound (backward compat).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence_start_date: Option<String>,
    /// Dashboard pin + view (#dashboard). `None` = not pinned to the Dashboard;
    /// `Some("heatmap")` / `Some("streak")` = pinned, rendered in that view. Only
    /// meaningful for recurring templates. `#[serde(default)]` so older files load.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dashboard_view: Option<String>,
}

impl TemplateTask {
    /// Build a template from a legacy `is_template` task carried in the old `tasks`
    /// list, so v<5 files migrate cleanly. Completion/absolute-date fields a
    /// template never had are simply dropped.
    fn from_legacy(c: TaskCompat) -> Self {
        TemplateTask {
            id: c.id,
            title: c.title,
            notes: c.notes,
            attachments: c.attachments,
            tag_ids: c.tag_ids,
            created_at: c.created_at,
            updated_at: c.updated_at,
            due_offset_days: c.due_offset_days,
            start_offset_days: c.start_offset_days,
            estimated_seconds: c
                .estimated_seconds
                .or_else(|| c.estimated_minutes.map(|m| m * 60)),
            recurrence: None,
            recurrence_tag_id: None,
            recurrence_start_date: None,
            dashboard_view: None,
        }
    }
}

/// Deserialization shim that accepts the legacy `done`/`archived`/`archived_at`
/// keys and folds them into `completed_at`, so files written before those three
/// fields were merged still load (AGENTS.md: model changes stay backward
/// compatible). `completed_at` wins when present; otherwise a task flagged
/// `done` or `archived` is preserved as completed — using `archived_at`, or epoch
/// `0` as a "done, time unknown" sentinel. New files never write the legacy keys.
#[derive(Deserialize)]
struct TaskCompat {
    id: String,
    title: String,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    due_date: Option<NaiveDate>,
    #[serde(default)]
    due_time: Option<String>,
    // Legacy files wrote `scheduled_date`/`scheduled_time`; aliases keep them loading (#renamed).
    #[serde(default, alias = "scheduled_date")]
    start_date: Option<NaiveDate>,
    #[serde(default, alias = "scheduled_time")]
    start_time: Option<String>,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    attachments: Vec<Attachment>,
    #[serde(default)]
    tag_ids: Vec<String>,
    #[serde(default)]
    estimated_seconds: Option<i64>,
    #[serde(default)]
    estimated_minutes: Option<i64>,
    #[serde(deserialize_with = "iso_secs::deserialize")]
    created_at: i64,
    #[serde(default, deserialize_with = "iso_secs_opt::deserialize")]
    completed_at: Option<i64>,
    #[serde(default, deserialize_with = "iso_secs::deserialize")]
    updated_at: i64,
    #[serde(default)]
    time_entries: Vec<TimeEntry>,
    #[serde(default)]
    archived: bool,
    #[serde(default, deserialize_with = "iso_secs_opt::deserialize")]
    archived_at: Option<i64>,
    #[serde(default)]
    is_template: bool,
    #[serde(default)]
    due_offset_days: Option<i64>,
    #[serde(default, alias = "scheduled_offset_days")]
    start_offset_days: Option<i64>,
}

impl From<TaskCompat> for Task {
    fn from(c: TaskCompat) -> Self {
        let completed_at = c.completed_at.or_else(|| {
            if c.done || c.archived {
                c.archived_at.or(Some(0))
            } else {
                None
            }
        });
        Task {
            id: c.id,
            title: c.title,
            due_date: c.due_date,
            due_time: c.due_time,
            start_date: c.start_date,
            start_time: c.start_time,
            notes: c.notes,
            attachments: c.attachments,
            tag_ids: c.tag_ids,
            estimated_seconds: c
                .estimated_seconds
                .or_else(|| c.estimated_minutes.map(|m| m * 60)),
            created_at: c.created_at,
            completed_at,
            updated_at: c.updated_at,
            time_entries: c.time_entries,
        }
    }
}

/// Bumped to 4 when on-disk timestamps switched from integer epoch-millis to
/// ISO-8601 local-time strings (`created_at`/`updated_at`/`completed_at`/`last_modified`),
/// to 5 when reusable templates moved out of the `tasks` list into a separate
/// `template_tasks` list (legacy `is_template` tasks are migrated on load by
/// `DocumentCompat`), and to 6 when tasks gained per-task time-tracking entries
/// (`time_entries`, #81). A pre-N build can't parse the newer shape, so the higher
/// version lets `parse_checked` reject the file with a clear "update the app"
/// message where it can — crucially, an older build would otherwise drop the
/// newer fields (losing every template, or every recorded time entry) on its next
/// write. New builds still read old files (integer-millis timestamps via
/// `iso_secs`; `is_template` tasks via `DocumentCompat`; absent `time_entries`
/// defaults to empty), and to 7 when templates gained an optional recurrence
/// schedule (`recurrence`, #9; absent on older files, where it defaults to none).
/// Bumped to 8 when the recurrence patterns went multi-day (`monthly {day}` →
/// `monthly {days}`, `yearly {month,day}` → `yearly {dates}`, #9): new builds still
/// read the old single-day shapes via `RecurrenceCompat`, but a 0.2.0 build can't
/// parse the new `days`/`dates` keys, so the higher version flags the mismatch.
/// Bumped to 9 when per-device replica merging added tag `updated_at` and delete
/// tombstones; older builds would silently drop tombstones and resurrect deletes.
/// Bumped to 10 when task/template notes gained managed file attachments; older
/// builds would silently drop attachment metadata on their next write.
pub const CURRENT_VERSION: u32 = 10;

/// Files written before `version` existed are assumed compatible with the
/// current schema (the model is additive/backward-compatible), so an absent
/// key loads as `CURRENT_VERSION` rather than 0 (which would downgrade the file
/// on the next write).
fn default_version() -> u32 {
    CURRENT_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(from = "DocumentCompat")]
pub struct Document {
    pub version: u32,
    /// Epoch millis of the last edit to the document (any task/tag change).
    /// Bumped by `AppState::write`. Shown as "Last synced"; identical on all
    /// devices when in sync. `#[serde(default)]` = 0 for pre-existing files;
    /// `skip_serializing_if` omits the key for a never-edited document so the UI
    /// shows an em dash rather than a 1970 ISO date.
    #[serde(default, skip_serializing_if = "is_zero", with = "iso_secs")]
    pub last_modified: i64,
    #[serde(default)]
    pub tags: Vec<Tag>,
    #[serde(default)]
    pub tasks: Vec<Task>,
    /// Reusable blueprints, kept separate from active `tasks` (v5+). Older files
    /// have none here; their `is_template` tasks are lifted in by `DocumentCompat`.
    #[serde(default)]
    pub template_tasks: Vec<TemplateTask>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_tasks: Vec<Tombstone>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_tags: Vec<Tombstone>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_template_tasks: Vec<Tombstone>,
    /// Attachment deletes across replicas. Same semantics as entity tombstones:
    /// suppress a live attachment when `deleted_at >= created_at`; a recreate with
    /// a newer `created_at` survives.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_attachments: Vec<Tombstone>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            last_modified: 0,
            tags: Vec::new(),
            tasks: Vec::new(),
            template_tasks: Vec::new(),
            deleted_tasks: Vec::new(),
            deleted_tags: Vec::new(),
            deleted_template_tasks: Vec::new(),
            deleted_attachments: Vec::new(),
        }
    }
}

/// Deserialization shim that migrates legacy files (AGENTS.md: model changes stay
/// backward compatible). It reads `tasks` as raw `TaskCompat` *before* the
/// `TaskCompat -> Task` conversion drops the template fields, so any task flagged
/// `is_template` is lifted out into `template_tasks` rather than silently becoming
/// an ordinary (always-hidden) task. Files already in the v5 shape pass through:
/// their explicit `template_tasks` are kept and concatenated after any migrated
/// ones. An absent `version` loads as `CURRENT_VERSION` (the model is additive, so
/// a missing version shouldn't downgrade the file on the next write).
#[derive(Deserialize)]
struct DocumentCompat {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default, deserialize_with = "iso_secs::deserialize")]
    last_modified: i64,
    #[serde(default)]
    tags: Vec<Tag>,
    #[serde(default)]
    tasks: Vec<TaskCompat>,
    #[serde(default)]
    template_tasks: Vec<TemplateTask>,
    #[serde(default)]
    deleted_tasks: Vec<Tombstone>,
    #[serde(default)]
    deleted_tags: Vec<Tombstone>,
    #[serde(default)]
    deleted_template_tasks: Vec<Tombstone>,
    #[serde(default)]
    deleted_attachments: Vec<Tombstone>,
}

impl From<DocumentCompat> for Document {
    fn from(c: DocumentCompat) -> Self {
        let mut tasks = Vec::with_capacity(c.tasks.len());
        // Migrated templates come first (document order), then any already stored
        // in the v5 `template_tasks` list.
        let mut template_tasks = Vec::new();
        for tc in c.tasks {
            if tc.is_template {
                template_tasks.push(TemplateTask::from_legacy(tc));
            } else {
                tasks.push(Task::from(tc));
            }
        }
        template_tasks.extend(c.template_tasks);
        Document {
            version: c.version,
            last_modified: c.last_modified,
            tags: c.tags,
            tasks,
            template_tasks,
            deleted_tasks: c.deleted_tasks,
            deleted_tags: c.deleted_tags,
            deleted_template_tasks: c.deleted_template_tasks,
            deleted_attachments: c.deleted_attachments,
        }
    }
}

impl Task {
    /// True if the task is completed. Since `done`/`archived`/`archived_at`
    /// merged into `completed_at`, "done" and "archived" are the same state: a
    /// completed task is swept out of the active views.
    pub fn done(&self) -> bool {
        self.completed_at.is_some()
    }

    /// True if the task is archived — identical to `done()` now that completion
    /// and archival are one state. Kept as a named accessor so call sites that
    /// mean "hidden from active views" stay readable.
    pub fn archived(&self) -> bool {
        self.completed_at.is_some()
    }

    /// Epoch millis the task was archived (= completed), or `None` if active.
    pub fn archived_at(&self) -> Option<i64> {
        self.completed_at
    }

    /// Set or clear completion. Completing sweeps the task out of the active
    /// views (Today/Inbox/tag); reopening restores it. `completed_at` is the
    /// single field encoding both.
    pub fn set_done(&mut self, done: bool, ts: i64) {
        self.completed_at = if done { Some(ts) } else { None };
        // Finishing a task stops its clock; you're no longer working on it (#81).
        if done {
            self.stop_timer(ts);
        }
        self.updated_at = ts;
    }

    /// The running time entry (the open interval with no `end`), if any (#81).
    pub fn running_entry(&self) -> Option<&TimeEntry> {
        self.time_entries.iter().find(|e| e.end.is_none())
    }

    /// Close any open interval at `ts`, returning whether one was running. `end` is
    /// clamped to at least `start` so a backwards clock can't record negative time.
    pub fn stop_timer(&mut self, ts: i64) -> bool {
        let mut stopped = false;
        for e in self.time_entries.iter_mut().filter(|e| e.end.is_none()) {
            e.end = Some(ts.max(e.start));
            stopped = true;
        }
        stopped
    }

    /// Discard the AFK tail of a running interval: close it at `afk_start`, or drop
    /// the entry when it started at or after that instant (no zero-length row).
    /// Returns whether a running interval was changed. Closed entries are untouched.
    pub fn discard_running_afk(&mut self, afk_start: i64) -> bool {
        let mut changed = false;
        let mut i = 0;
        while i < self.time_entries.len() {
            if self.time_entries[i].end.is_some() {
                i += 1;
                continue;
            }
            changed = true;
            if self.time_entries[i].start >= afk_start {
                self.time_entries.remove(i);
            } else {
                self.time_entries[i].end = Some(afk_start);
                i += 1;
            }
        }
        changed
    }

    /// True if the half-open interval `[start, end)` overlaps any existing entry,
    /// skipping the entry whose id equals `except` (the one being edited). An open
    /// `end` (`None`, a running timer) extends to `+∞`. Intervals that merely touch
    /// at an endpoint (one's `end` == the other's `start`) do not overlap, so
    /// back-to-back sessions are allowed (#81).
    pub fn time_entry_overlaps(&self, start: i64, end: Option<i64>, except: Option<&str>) -> bool {
        let a_end = end.unwrap_or(i64::MAX);
        self.time_entries.iter().any(|e| {
            if except == Some(e.id.as_str()) {
                return false;
            }
            let b_end = e.end.unwrap_or(i64::MAX);
            start < b_end && e.start < a_end
        })
    }
}

impl Document {
    /// True if the task belongs in Inbox: none of its tags are pinned, so no
    /// pinned-tag sidebar view surfaces it. Untagged tasks qualify trivially; a
    /// task tagged only with unpinned tags lands here too (otherwise it would be
    /// invisible). An unknown tag id counts as unpinned, matching its
    /// "behaves as untagged" handling.
    pub fn task_in_inbox(&self, task: &Task) -> bool {
        !task
            .tag_ids
            .iter()
            .any(|id| self.tags.iter().any(|t| t.id == *id && t.pinned))
    }

    /// Today: starting today, OR (due < today AND !done), OR due == today.
    /// Archived tasks never appear in active views. (Templates live in their own
    /// list, so `tasks` no longer contains any.)
    pub fn tasks_today(&self, today: NaiveDate) -> Vec<&Task> {
        self.tasks
            .iter()
            .filter(|t| {
                if t.archived() {
                    return false;
                }
                if t.start_date == Some(today) {
                    return true;
                }
                if let Some(due) = t.due_date {
                    if due == today {
                        return true;
                    }
                    if due < today && !t.done() {
                        return true;
                    }
                }
                false
            })
            .collect()
    }

    pub fn tasks_inbox(&self) -> Vec<&Task> {
        self.tasks
            .iter()
            .filter(|t| !t.archived() && self.task_in_inbox(t))
            .collect()
    }

    pub fn tasks_for_tag(&self, tag_id: &str) -> Vec<&Task> {
        self.tasks
            .iter()
            .filter(|t| !t.archived() && t.tag_ids.iter().any(|id| id == tag_id))
            .collect()
    }

    /// Templates (reusable blueprints) in document order — the only place
    /// templates surface. They live in their own list, never in `tasks`.
    pub fn tasks_templates(&self) -> &[TemplateTask] {
        &self.template_tasks
    }
}

fn latest_tombstones(
    tombstones: impl IntoIterator<Item = Tombstone>,
) -> HashMap<String, Tombstone> {
    let mut out = HashMap::new();
    for tombstone in tombstones {
        out.entry(tombstone.id.clone())
            .and_modify(|existing: &mut Tombstone| {
                if tombstone.deleted_at > existing.deleted_at {
                    *existing = tombstone.clone();
                }
            })
            .or_insert(tombstone);
    }
    out
}

fn task_stamp(task: &Task) -> i64 {
    task.updated_at.max(task.created_at)
}

fn template_stamp(template: &TemplateTask) -> i64 {
    template.updated_at.max(template.created_at)
}

fn tag_stamp(tag: &Tag, doc_last_modified: i64) -> i64 {
    // A real per-tag edit always decides the winner. Only legacy tags written
    // before `updated_at` existed (the zero sentinel) fall back to the document's
    // last_modified, so an unrelated edit elsewhere can't make an untouched tag
    // win over another replica's genuinely newer tag edit.
    if is_zero(&tag.updated_at) {
        doc_last_modified
    } else {
        tag.updated_at
    }
}

fn merge_time_entries(into: &mut Task, from: &Task) {
    let mut seen: HashSet<String> = into
        .time_entries
        .iter()
        .map(|entry| entry.id.clone())
        .collect();
    for entry in &from.time_entries {
        if seen.insert(entry.id.clone()) {
            into.time_entries.push(entry.clone());
        }
    }
    into.time_entries
        .sort_by_key(|entry| (entry.start, entry.id.clone()));
}

/// Union attachments by id, then the caller applies attachment tombstones.
fn merge_attachments(into: &mut Task, from: &Task) {
    let mut seen: HashSet<String> = into
        .attachments
        .iter()
        .map(|att| att.id.clone())
        .collect();
    for att in &from.attachments {
        if seen.insert(att.id.clone()) {
            into.attachments.push(att.clone());
        }
    }
    into.attachments
        .sort_by_key(|att| (att.created_at, att.id.clone()));
}

fn apply_attachment_tombstones(attachments: &mut Vec<Attachment>, tombs: &HashMap<String, Tombstone>) {
    attachments.retain(|att| {
        tombs
            .get(&att.id)
            .is_none_or(|t| t.deleted_at < att.created_at)
    });
}

/// Merge per-device replica documents into one computed document. Entity-level
/// latest-write-wins keeps different devices from fighting over one physical
/// cloud file; tombstones prevent deletes from being resurrected by stale replicas.
///
/// LIMITATION — silent loss on concurrent edits: when two replicas edit the *same*
/// entity, the lower-stamped edit is discarded with no conflict file (only time-entry
/// *additions* survive both sides, since they union by id). Peer-merge reload appends
/// history for changes that *win* into the live Document (with dedup); discarded LWW
/// losers are still not surfaced. External cloud conflict copies (`*.sync-conflict*`)
/// are still mirrored into the conflict UI; Android SAF pull no longer stashes a
/// whole-document `.conflict-local-*` loser (it merges like desktop instead).
pub fn merge_documents(replicas: Vec<Document>) -> Document {
    let mut merged = Document::default();
    let mut tasks: HashMap<String, (i64, Task)> = HashMap::new();
    let mut tags: HashMap<String, (i64, Tag)> = HashMap::new();
    let mut templates: HashMap<String, (i64, TemplateTask)> = HashMap::new();
    let mut deleted_tasks = Vec::new();
    let mut deleted_tags = Vec::new();
    let mut deleted_templates = Vec::new();
    let mut deleted_attachments = Vec::new();

    for doc in replicas {
        merged.version = merged.version.max(doc.version);
        merged.last_modified = merged.last_modified.max(doc.last_modified);
        deleted_tasks.extend(doc.deleted_tasks.clone());
        deleted_tags.extend(doc.deleted_tags.clone());
        deleted_templates.extend(doc.deleted_template_tasks.clone());
        deleted_attachments.extend(doc.deleted_attachments.clone());

        for task in doc.tasks {
            let stamp = task_stamp(&task);
            tasks
                .entry(task.id.clone())
                .and_modify(|(existing_stamp, existing)| {
                    if stamp > *existing_stamp {
                        // Newer replica wins the fields; fold the older copy's
                        // time entries and attachments into the winner so a
                        // concurrent add on the losing side isn't lost.
                        let mut winner = task.clone();
                        merge_time_entries(&mut winner, existing);
                        merge_attachments(&mut winner, existing);
                        *existing_stamp = stamp;
                        *existing = winner;
                    } else {
                        // Older/equal replica loses the fields but still
                        // contributes any time entries and attachments the
                        // winner lacks.
                        merge_time_entries(existing, &task);
                        merge_attachments(existing, &task);
                    }
                })
                .or_insert((stamp, task));
        }

        for tag in doc.tags {
            let stamp = tag_stamp(&tag, doc.last_modified);
            tags.entry(tag.id.clone())
                .and_modify(|(existing_stamp, existing)| {
                    if stamp > *existing_stamp {
                        *existing_stamp = stamp;
                        *existing = tag.clone();
                    }
                })
                .or_insert((stamp, tag));
        }

        for template in doc.template_tasks {
            let stamp = template_stamp(&template);
            templates
                .entry(template.id.clone())
                .and_modify(|(existing_stamp, existing)| {
                    if stamp > *existing_stamp {
                        *existing_stamp = stamp;
                        *existing = template.clone();
                    }
                })
                .or_insert((stamp, template));
        }
    }

    let task_tombs = latest_tombstones(deleted_tasks);
    let tag_tombs = latest_tombstones(deleted_tags);
    let template_tombs = latest_tombstones(deleted_templates);
    let attachment_tombs = latest_tombstones(deleted_attachments);

    merged.tags = tags
        .into_values()
        .filter(|(stamp, tag)| {
            tag_tombs
                .get(&tag.id)
                .is_none_or(|t| t.deleted_at < *stamp)
        })
        .map(|(_, tag)| tag)
        .collect();
    merged.tags.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    let live_tag_ids: HashSet<String> = merged.tags.iter().map(|tag| tag.id.clone()).collect();

    merged.tasks = tasks
        .into_values()
        .filter(|(stamp, task)| {
            task_tombs
                .get(&task.id)
                .is_none_or(|t| t.deleted_at < *stamp)
        })
        .map(|(_, mut task)| {
            task.tag_ids.retain(|id| live_tag_ids.contains(id));
            apply_attachment_tombstones(&mut task.attachments, &attachment_tombs);
            task
        })
        .collect();
    merged
        .tasks
        .sort_by_key(|task| (task.created_at, task.id.clone()));

    merged.template_tasks = templates
        .into_values()
        .filter(|(stamp, template)| {
            template_tombs
                .get(&template.id)
                .is_none_or(|t| t.deleted_at < *stamp)
        })
        .map(|(_, mut template)| {
            template.tag_ids.retain(|id| live_tag_ids.contains(id));
            if !template
                .recurrence_tag_id
                .as_ref()
                .is_some_and(|id| live_tag_ids.contains(id))
            {
                template.recurrence_tag_id = None;
            }
            apply_attachment_tombstones(&mut template.attachments, &attachment_tombs);
            template
        })
        .collect();
    merged
        .template_tasks
        .sort_by_key(|template| (template.created_at, template.id.clone()));

    merged.deleted_tasks = task_tombs.into_values().collect();
    merged.deleted_tags = tag_tombs.into_values().collect();
    merged.deleted_template_tasks = template_tombs.into_values().collect();
    merged.deleted_attachments = attachment_tombs.into_values().collect();
    merged
}
