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
    pub(super) fn to_iso(ms: i64) -> String {
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

/// A delete marker used by per-device replica files. Without this, an older
/// replica that still contains an entity would resurrect it after another device
/// deleted it.
#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateTask {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
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
pub const CURRENT_VERSION: u32 = 9;

/// Files written before `version` existed are assumed compatible with the
/// current schema (the model is additive/backward-compatible), so an absent
/// key loads as `CURRENT_VERSION` rather than 0 (which would downgrade the file
/// on the next write).
fn default_version() -> u32 {
    CURRENT_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    tag.updated_at.max(doc_last_modified)
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

/// Merge per-device replica documents into one computed document. Entity-level
/// latest-write-wins keeps different devices from fighting over one physical
/// cloud file; tombstones prevent deletes from being resurrected by stale replicas.
pub fn merge_documents(replicas: Vec<Document>) -> Document {
    let mut merged = Document::default();
    let mut tasks: HashMap<String, (i64, Task)> = HashMap::new();
    let mut tags: HashMap<String, (i64, Tag)> = HashMap::new();
    let mut templates: HashMap<String, (i64, TemplateTask)> = HashMap::new();
    let mut deleted_tasks = Vec::new();
    let mut deleted_tags = Vec::new();
    let mut deleted_templates = Vec::new();

    for doc in replicas {
        merged.version = merged.version.max(doc.version);
        merged.last_modified = merged.last_modified.max(doc.last_modified);
        deleted_tasks.extend(doc.deleted_tasks.clone());
        deleted_tags.extend(doc.deleted_tags.clone());
        deleted_templates.extend(doc.deleted_template_tasks.clone());

        for task in doc.tasks {
            let stamp = task_stamp(&task);
            tasks
                .entry(task.id.clone())
                .and_modify(|(_, existing)| merge_time_entries(existing, &task))
                .or_insert_with(|| (stamp, task.clone()));
            if let Some((existing_stamp, existing)) = tasks.get_mut(&task.id) {
                if stamp > *existing_stamp {
                    let mut winner = task;
                    merge_time_entries(&mut winner, existing);
                    *existing_stamp = stamp;
                    *existing = winner;
                }
            }
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

    merged.tags = tags
        .into_values()
        .filter(|(stamp, tag)| {
            tag_tombs
                .get(&tag.id)
                .map_or(true, |t| t.deleted_at < *stamp)
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
                .map_or(true, |t| t.deleted_at < *stamp)
        })
        .map(|(_, mut task)| {
            task.tag_ids.retain(|id| live_tag_ids.contains(id));
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
                .map_or(true, |t| t.deleted_at < *stamp)
        })
        .map(|(_, mut template)| {
            template.tag_ids.retain(|id| live_tag_ids.contains(id));
            if !template
                .recurrence_tag_id
                .as_ref()
                .map_or(false, |id| live_tag_ids.contains(id))
            {
                template.recurrence_tag_id = None;
            }
            template
        })
        .collect();
    merged
        .template_tasks
        .sort_by_key(|template| (template.created_at, template.id.clone()));

    merged.deleted_tasks = task_tombs.into_values().collect();
    merged.deleted_tags = tag_tombs.into_values().collect();
    merged.deleted_template_tasks = template_tombs.into_values().collect();
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task() -> Task {
        Task {
            id: "k_1".into(),
            title: "t".into(),
            due_date: None,
            due_time: None,
            start_date: None,
            start_time: None,
            notes: String::new(),
            tag_ids: Vec::new(),
            estimated_seconds: None,
            created_at: 0,
            completed_at: None,
            updated_at: 0,
            time_entries: Vec::new(),
        }
    }

    #[test]
    fn tag_pinned_defaults_to_false_for_legacy_data() {
        // A tag written before `pinned` existed (no key) must load as unpinned,
        // so an upgrade keeps legacy tags out of the curated sidebar rather than
        // failing the parse.
        let t: Tag =
            serde_json::from_str(r##"{"id":"t_1","name":"work","color":"#000"}"##).unwrap();
        assert!(!t.pinned);
        // And a present value round-trips.
        let pinned: Tag =
            serde_json::from_str(r##"{"id":"t_2","name":"home","color":"#111","pinned":true}"##)
                .unwrap();
        assert!(pinned.pinned);
    }

    #[test]
    fn completing_a_task_archives_it() {
        let mut t = task();
        t.set_done(true, 100);
        assert!(t.done());
        assert_eq!(t.completed_at, Some(100));
        assert!(t.archived(), "finishing a task sends it to the archive");
        assert_eq!(t.archived_at(), Some(100));
        assert_eq!(t.updated_at, 100);
    }

    #[test]
    fn uncompleting_a_task_unarchives_it() {
        let mut t = task();
        t.set_done(true, 100);
        t.set_done(false, 200);
        assert!(!t.done());
        assert_eq!(t.completed_at, None);
        assert!(
            !t.archived(),
            "reopening a task restores it to the active views"
        );
        assert_eq!(t.archived_at(), None);
        assert_eq!(t.updated_at, 200);
    }

    #[test]
    fn stop_timer_closes_the_open_interval_and_clamps_end() {
        let mut t = task();
        t.time_entries.push(TimeEntry {
            id: "te_1".into(),
            start: 1_000,
            end: None,
        });
        assert!(t.running_entry().is_some());
        assert!(t.stop_timer(5_000));
        assert_eq!(t.time_entries[0].end, Some(5_000));
        assert!(t.running_entry().is_none());
        // A second stop with nothing running is a no-op.
        assert!(!t.stop_timer(9_000));
        // A backwards clock can't record negative time: end is clamped to start.
        t.time_entries.push(TimeEntry {
            id: "te_2".into(),
            start: 8_000,
            end: None,
        });
        assert!(t.stop_timer(2_000));
        assert_eq!(t.time_entries[1].end, Some(8_000));
    }

    #[test]
    fn time_entry_overlaps_detects_clashes_and_allows_touching() {
        let mut t = task();
        // An existing closed session 1000..2000.
        t.time_entries.push(TimeEntry {
            id: "te_1".into(),
            start: 1_000,
            end: Some(2_000),
        });

        // A candidate landing inside / straddling it overlaps.
        assert!(t.time_entry_overlaps(1_500, Some(2_500), None));
        assert!(t.time_entry_overlaps(500, Some(1_500), None));
        assert!(t.time_entry_overlaps(500, Some(2_500), None)); // fully contains it
        assert!(t.time_entry_overlaps(1_200, Some(1_800), None)); // contained within

        // Back-to-back (touching at an endpoint) is allowed, not an overlap.
        assert!(!t.time_entry_overlaps(2_000, Some(3_000), None));
        assert!(!t.time_entry_overlaps(0, Some(1_000), None));

        // `except` skips the entry being edited (so an in-place edit can't clash with itself).
        assert!(!t.time_entry_overlaps(1_000, Some(2_000), Some("te_1")));

        // An open candidate (running timer, end = None) extends to +∞.
        assert!(t.time_entry_overlaps(1_500, None, None));
        assert!(!t.time_entry_overlaps(2_000, None, None)); // starts exactly at the existing end

        // An existing open entry also extends to +∞ and clashes with anything after its start.
        t.time_entries.push(TimeEntry {
            id: "te_2".into(),
            start: 5_000,
            end: None,
        });
        assert!(t.time_entry_overlaps(6_000, Some(7_000), None));
        assert!(!t.time_entry_overlaps(4_000, Some(5_000), None)); // ends exactly at the open start
    }

    #[test]
    fn completing_a_task_stops_its_running_timer() {
        let mut t = task();
        t.time_entries.push(TimeEntry {
            id: "te_1".into(),
            start: 1_000,
            end: None,
        });
        t.set_done(true, 4_000);
        assert!(t.done());
        assert_eq!(
            t.time_entries[0].end,
            Some(4_000),
            "finishing the task closes the open interval"
        );
        assert!(t.running_entry().is_none());
    }

    #[test]
    fn time_entries_round_trip_and_omit_when_empty() {
        // Empty: the key is omitted entirely (untracked tasks serialize as before).
        let bare = task();
        let json = serde_json::to_string(&bare).unwrap();
        assert!(
            !json.contains("time_entries"),
            "empty time_entries must not be written"
        );

        // Open + closed entries round-trip; the open one omits `end`.
        let mut t = task();
        t.time_entries.push(TimeEntry {
            id: "te_1".into(),
            start: 1_000,
            end: Some(2_000),
        });
        t.time_entries.push(TimeEntry {
            id: "te_2".into(),
            start: 3_000,
            end: None,
        });
        let json = serde_json::to_string(&t).unwrap();
        let back: Task = serde_json::from_str(&json).unwrap();
        assert_eq!(back.time_entries.len(), 2);
        assert_eq!(back.time_entries[0].end, Some(2_000));
        assert_eq!(back.time_entries[1].end, None);
    }

    #[test]
    fn task_without_time_entries_loads_with_empty_list() {
        // A file written before #81 has no `time_entries` key; it must default to
        // empty rather than failing the parse.
        let t: Task = serde_json::from_str(r##"{"id":"k_1","title":"t","created_at":0}"##).unwrap();
        assert!(t.time_entries.is_empty());
    }

    #[test]
    fn estimated_seconds_round_trip_and_omit_when_absent() {
        let bare = task();
        let json = serde_json::to_string(&bare).unwrap();
        assert!(
            !json.contains("estimated_seconds"),
            "absent estimate must not be written"
        );

        let with_estimate: Task = serde_json::from_str(
            r##"{"id":"k_1","title":"t","created_at":0,"estimated_seconds":50}"##,
        )
        .unwrap();
        assert_eq!(with_estimate.estimated_seconds, Some(50));
        assert!(serde_json::to_string(&with_estimate)
            .unwrap()
            .contains("\"estimated_seconds\":50"));

        let legacy_minutes: Task = serde_json::from_str(
            r##"{"id":"k_1","title":"t","created_at":0,"estimated_minutes":45}"##,
        )
        .unwrap();
        assert_eq!(legacy_minutes.estimated_seconds, Some(45 * 60));
    }

    #[test]
    fn legacy_done_archived_keys_fold_into_completed_at() {
        // A task written before the merge: `completed_at` is absent but the
        // legacy `done`/`archived`/`archived_at` keys mark it complete. It must
        // load as completed (archived_at supplies the timestamp).
        let t: Task = serde_json::from_str(
            r##"{"id":"k_1","title":"t","done":true,"created_at":0,"archived":true,"archived_at":123}"##,
        ).unwrap();
        assert_eq!(t.completed_at, Some(123));
        assert!(t.done());
        assert!(t.archived());

        // Legacy done task with neither completed_at nor archived_at → preserved
        // as completed with the epoch-0 "time unknown" sentinel, not un-completed.
        let no_ts: Task =
            serde_json::from_str(r##"{"id":"k_2","title":"t","done":true,"created_at":0}"##)
                .unwrap();
        assert_eq!(no_ts.completed_at, Some(0));
        assert!(no_ts.done());

        // A legacy active task stays active.
        let active: Task = serde_json::from_str(
            r##"{"id":"k_3","title":"t","done":false,"created_at":0,"archived":false}"##,
        )
        .unwrap();
        assert_eq!(active.completed_at, None);
        assert!(!active.done());
    }

    #[test]
    fn legacy_scheduled_keys_load_into_start_fields_and_serialize_renamed() {
        // A task written before the scheduled->start rename: the legacy
        // `scheduled_date`/`scheduled_time` keys must load into start_date/start_time
        // via the serde alias, and re-serialize under the new names (no migration).
        let t: Task = serde_json::from_str(
            r##"{"id":"k_1","title":"t","created_at":0,"scheduled_date":"2026-06-05","scheduled_time":"09:30"}"##,
        ).unwrap();
        assert_eq!(t.start_date, NaiveDate::from_ymd_opt(2026, 6, 5));
        assert_eq!(t.start_time.as_deref(), Some("09:30"));

        let json = serde_json::to_string(&t).unwrap();
        assert!(json.contains("\"start_date\":\"2026-06-05\""), "{json}");
        assert!(json.contains("\"start_time\":\"09:30\""), "{json}");
        assert!(
            !json.contains("scheduled_date"),
            "no legacy key written: {json}"
        );
        assert!(
            !json.contains("scheduled_time"),
            "no legacy key written: {json}"
        );
    }

    #[test]
    fn completed_task_serializes_without_legacy_keys() {
        let mut t = task();
        // 2026-06-01T12:34:56Z in epoch millis (whole second, so it round-trips
        // losslessly through the second-precision ISO form).
        t.set_done(true, 1_780_317_296_000);
        let json = serde_json::to_string(&t).unwrap();
        // completed_at is present as an ISO string for the same instant (rendered in
        // local time — see timestamps_serialize_as_iso_local_seconds); this test
        // guards only that the legacy keys are gone.
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let completed = v["completed_at"]
            .as_str()
            .expect("completed_at is an ISO string");
        assert_eq!(
            chrono::DateTime::parse_from_rfc3339(completed)
                .unwrap()
                .timestamp_millis(),
            1_780_317_296_000,
        );
        assert!(!json.contains("\"done\""), "no legacy done key: {json}");
        assert!(
            !json.contains("\"archived\""),
            "no legacy archived key: {json}"
        );
        assert!(
            !json.contains("archived_at"),
            "no legacy archived_at key: {json}"
        );
    }

    #[test]
    fn timestamps_serialize_as_iso_local_seconds() {
        use chrono::{DateTime, Local, SecondsFormat, TimeZone};
        let ms = 1_780_317_296_000; // 2026-06-01T12:34:56Z
                                    // The instant rendered in the machine's local time, e.g. 2026-06-01T20:34:56+08:00.
        let expect = |ms: i64| {
            Local
                .timestamp_millis_opt(ms)
                .single()
                .unwrap()
                .to_rfc3339_opts(SecondsFormat::Secs, false)
        };

        let mut t = task();
        t.created_at = ms;
        t.updated_at = ms;
        let json = serde_json::to_string(&t).unwrap();
        assert!(
            json.contains(&format!("\"created_at\":\"{}\"", expect(ms))),
            "{json}"
        );
        assert!(
            json.contains(&format!("\"updated_at\":\"{}\"", expect(ms))),
            "{json}"
        );

        // Whatever offset is written, the string round-trips to the same instant.
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let created = v["created_at"].as_str().unwrap();
        assert_eq!(
            DateTime::parse_from_rfc3339(created)
                .unwrap()
                .timestamp_millis(),
            ms
        );

        // updated_at == 0 (the "never edited" sentinel) is omitted, not written as 1970.
        t.updated_at = 0;
        let json = serde_json::to_string(&t).unwrap();
        assert!(
            !json.contains("updated_at"),
            "zero updated_at is skipped: {json}"
        );

        // Document.last_modified == 0 is likewise omitted, but a real stamp is ISO local.
        let mut doc = Document::default();
        assert!(!serde_json::to_string(&doc)
            .unwrap()
            .contains("last_modified"));
        doc.last_modified = ms;
        assert!(serde_json::to_string(&doc)
            .unwrap()
            .contains(&format!("\"last_modified\":\"{}\"", expect(ms))));
    }

    #[test]
    fn timestamps_load_from_integer_or_iso() {
        // Legacy integer epoch-millis still parse (backward compatible).
        let from_int: Task = serde_json::from_str(
            r##"{"id":"k_1","title":"t","created_at":1780317296000,"updated_at":1780317296000,"completed_at":1780317296000}"##,
        ).unwrap();
        assert_eq!(from_int.created_at, 1_780_317_296_000);
        assert_eq!(from_int.updated_at, 1_780_317_296_000);
        assert_eq!(from_int.completed_at, Some(1_780_317_296_000));

        // ISO-8601 strings parse to the same instant. A non-UTC offset is honored.
        let from_iso: Task = serde_json::from_str(
            r##"{"id":"k_2","title":"t","created_at":"2026-06-01T12:34:56Z","completed_at":"2026-06-01T21:34:56+09:00"}"##,
        ).unwrap();
        assert_eq!(from_iso.created_at, 1_780_317_296_000);
        assert_eq!(from_iso.completed_at, Some(1_780_317_296_000));

        // Legacy archived_at as an ISO string still folds into completed_at.
        let legacy: Task = serde_json::from_str(
            r##"{"id":"k_3","title":"t","done":true,"created_at":0,"archived":true,"archived_at":"2026-06-01T12:34:56Z"}"##,
        ).unwrap();
        assert_eq!(legacy.completed_at, Some(1_780_317_296_000));
    }

    fn template(id: &str) -> TemplateTask {
        TemplateTask {
            id: id.into(),
            title: id.into(),
            notes: String::new(),
            tag_ids: Vec::new(),
            created_at: 0,
            updated_at: 0,
            due_offset_days: None,
            start_offset_days: None,
            estimated_seconds: None,
            recurrence: None,
            recurrence_tag_id: None,
        }
    }

    #[test]
    fn merge_documents_uses_latest_entity_by_id() {
        let mut old = Document::default();
        let mut old_task = task();
        old_task.id = "k_shared".into();
        old_task.title = "old".into();
        old_task.created_at = 1;
        old_task.updated_at = 10;
        old.tasks.push(old_task);

        let mut new = Document::default();
        let mut new_task = task();
        new_task.id = "k_shared".into();
        new_task.title = "new".into();
        new_task.created_at = 1;
        new_task.updated_at = 20;
        new.tasks.push(new_task);

        let merged = merge_documents(vec![old, new]);
        assert_eq!(merged.tasks.len(), 1);
        assert_eq!(merged.tasks[0].title, "new");
    }

    #[test]
    fn merge_documents_tombstone_suppresses_older_entity() {
        let mut stale = Document::default();
        let mut stale_task = task();
        stale_task.id = "k_deleted".into();
        stale_task.title = "stale".into();
        stale_task.created_at = 1;
        stale_task.updated_at = 10;
        stale.tasks.push(stale_task);

        let mut deleting = Document::default();
        deleting.deleted_tasks.push(Tombstone {
            id: "k_deleted".into(),
            deleted_at: 20,
            deleted_by: Some("desktop".into()),
        });

        let merged = merge_documents(vec![stale, deleting]);
        assert!(merged.tasks.is_empty());
        assert_eq!(merged.deleted_tasks.len(), 1);
    }

    #[test]
    fn merge_documents_unions_time_entries_on_same_task() {
        let mut left = Document::default();
        let mut left_task = task();
        left_task.id = "k_shared".into();
        left_task.updated_at = 10;
        left_task.time_entries.push(TimeEntry {
            id: "te_left".into(),
            start: 1,
            end: Some(2),
        });
        left.tasks.push(left_task);

        let mut right = Document::default();
        let mut right_task = task();
        right_task.id = "k_shared".into();
        right_task.updated_at = 20;
        right_task.time_entries.push(TimeEntry {
            id: "te_right".into(),
            start: 3,
            end: Some(4),
        });
        right.tasks.push(right_task);

        let merged = merge_documents(vec![left, right]);
        let ids: Vec<_> = merged.tasks[0]
            .time_entries
            .iter()
            .map(|entry| entry.id.as_str())
            .collect();
        assert_eq!(ids, ["te_left", "te_right"]);
    }

    #[test]
    fn templates_live_in_their_own_list_and_never_in_active_views() {
        let today = NaiveDate::from_ymd_opt(2026, 5, 31).unwrap();
        let mut doc = Document::default();
        // A pinned tag, so the real task below is surfaced in its tag view and
        // stays out of Inbox (Inbox now catches tasks with no pinned tag).
        doc.tags.push(Tag {
            id: "t_work".into(),
            name: "work".into(),
            color: "#000".into(),
            priority: 0,
            pinned: true,
            updated_at: 1,
        });
        // Templates carry tags/offsets but live in `template_tasks`, so they can't
        // land in Today/Inbox/tag views no matter what they reference.
        let mut tmpl = template("k_tmpl");
        tmpl.tag_ids = vec!["t_work".into()];
        tmpl.start_offset_days = Some(0);
        doc.template_tasks.push(tmpl);
        doc.template_tasks.push(template("k_tmpl2"));
        // A normal task sharing the same scheduled date + tag, to prove the views
        // aren't simply empty.
        let mut real = task();
        real.id = "k_real".into();
        real.start_date = Some(today);
        real.tag_ids = vec!["t_work".into()];
        doc.tasks.push(real);

        let ids = |v: Vec<&Task>| v.into_iter().map(|t| t.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(doc.tasks_today(today)), ["k_real"]);
        assert_eq!(ids(doc.tasks_for_tag("t_work")), ["k_real"]);
        // The real task has a pinned tag, so Inbox is empty — and the untagged
        // template must not leak into Inbox either.
        assert!(ids(doc.tasks_inbox()).is_empty());
        // ...and templates surface only through tasks_templates, in document order.
        let tmpl_ids: Vec<_> = doc.tasks_templates().iter().map(|t| t.id.clone()).collect();
        assert_eq!(tmpl_ids, ["k_tmpl", "k_tmpl2"]);
    }

    #[test]
    fn legacy_is_template_tasks_migrate_into_template_tasks() {
        // A v4 file: the template lives in `tasks` with is_template=true and its
        // offset fields; the ordinary task sits beside it. On load the template is
        // lifted into `template_tasks`, leaving `tasks` with only real work.
        let doc: Document = serde_json::from_str(
            r##"{
                "version": 4,
                "tasks": [
                    {"id":"k_tmpl","title":"Weekly review","created_at":0,
                     "is_template":true,"due_offset_days":3,"scheduled_offset_days":0,
                     "tag_ids":["t_work"],"notes":"check inbox","estimated_seconds":50},
                    {"id":"k_real","title":"real","created_at":0}
                ]
            }"##,
        )
        .unwrap();

        assert_eq!(
            doc.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
            ["k_real"]
        );
        assert_eq!(doc.template_tasks.len(), 1);
        let t = &doc.template_tasks[0];
        assert_eq!(t.id, "k_tmpl");
        assert_eq!(t.title, "Weekly review");
        assert_eq!(t.notes, "check inbox");
        assert_eq!(t.tag_ids, ["t_work"]);
        assert_eq!(t.due_offset_days, Some(3));
        // Legacy v4 key `scheduled_offset_days` loads via the serde alias (#renamed).
        assert_eq!(t.start_offset_days, Some(0));
        assert_eq!(t.estimated_seconds, Some(50));
    }

    #[test]
    fn v5_document_round_trips_template_tasks_without_is_template() {
        let mut doc = Document::default();
        doc.tasks.push({
            let mut t = task();
            t.id = "k_real".into();
            t
        });
        let mut tmpl = template("k_tmpl");
        tmpl.due_offset_days = Some(2);
        tmpl.estimated_seconds = Some(50);
        doc.template_tasks.push(tmpl);

        let json = serde_json::to_string(&doc).unwrap();
        // Templates serialize under template_tasks; a task never carries is_template.
        assert!(json.contains("\"template_tasks\""), "{json}");
        assert!(
            !json.contains("is_template"),
            "no legacy is_template key: {json}"
        );
        assert!(json.contains("\"estimated_seconds\":50"), "{json}");

        let back: Document = serde_json::from_str(&json).unwrap();
        assert_eq!(
            back.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
            ["k_real"]
        );
        assert_eq!(back.template_tasks.len(), 1);
        assert_eq!(back.template_tasks[0].due_offset_days, Some(2));
        assert_eq!(back.template_tasks[0].estimated_seconds, Some(50));
    }

    #[test]
    fn recurrence_round_trips_weekly_and_monthly() {
        let weekly: Recurrence =
            serde_json::from_str(r#"{"kind":"weekly","weekdays":[1,3,5]}"#).unwrap();
        assert_eq!(
            weekly,
            Recurrence::Weekly {
                weekdays: vec![1, 3, 5]
            }
        );
        let monthly: Recurrence =
            serde_json::from_str(r#"{"kind":"monthly","days":[1,15]}"#).unwrap();
        assert_eq!(monthly, Recurrence::Monthly { days: vec![1, 15] });

        // Serializes back to the same tagged shape.
        let json = serde_json::to_string(&Recurrence::Monthly { days: vec![1] }).unwrap();
        assert_eq!(json, r#"{"kind":"monthly","days":[1]}"#);
    }

    #[test]
    fn recurrence_round_trips_daily_and_yearly() {
        let daily: Recurrence = serde_json::from_str(r#"{"kind":"daily"}"#).unwrap();
        assert_eq!(daily, Recurrence::Daily);
        assert_eq!(
            serde_json::to_string(&Recurrence::Daily).unwrap(),
            r#"{"kind":"daily"}"#
        );

        let yearly: Recurrence = serde_json::from_str(
            r#"{"kind":"yearly","dates":[{"month":3,"day":15},{"month":12,"day":25}]}"#,
        )
        .unwrap();
        assert_eq!(
            yearly,
            Recurrence::Yearly {
                dates: vec![
                    YearlyDate { month: 3, day: 15 },
                    YearlyDate { month: 12, day: 25 }
                ],
            }
        );
        let json = serde_json::to_string(&Recurrence::Yearly {
            dates: vec![YearlyDate { month: 12, day: 25 }],
        })
        .unwrap();
        assert_eq!(json, r#"{"kind":"yearly","dates":[{"month":12,"day":25}]}"#);
    }

    #[test]
    fn recurrence_reads_legacy_single_day_shapes() {
        // 0.2.0 wrote `monthly {day}`; the pre-multi-day build wrote `yearly {month,day}`.
        // Both must fold into the multi-day shapes on load.
        let monthly: Recurrence = serde_json::from_str(r#"{"kind":"monthly","day":15}"#).unwrap();
        assert_eq!(monthly, Recurrence::Monthly { days: vec![15] });
        let yearly: Recurrence =
            serde_json::from_str(r#"{"kind":"yearly","month":3,"day":15}"#).unwrap();
        assert_eq!(
            yearly,
            Recurrence::Yearly {
                dates: vec![YearlyDate { month: 3, day: 15 }]
            }
        );
    }

    #[test]
    fn template_without_recurrence_loads_and_omits_the_key() {
        // A template written before #9 has no `recurrence` key: it must load as None
        // and re-serialize without the key (backward compatible).
        let t: TemplateTask =
            serde_json::from_str(r#"{"id":"k_1","title":"t","created_at":0}"#).unwrap();
        assert!(t.recurrence.is_none());
        let json = serde_json::to_string(&t).unwrap();
        assert!(
            !json.contains("recurrence"),
            "absent recurrence must not be written: {json}"
        );

        // A present schedule round-trips.
        let mut sched = template("k_2");
        sched.recurrence = Some(Recurrence::Weekly {
            weekdays: vec![1, 2, 3, 4, 5],
        });
        let back: TemplateTask =
            serde_json::from_str(&serde_json::to_string(&sched).unwrap()).unwrap();
        assert_eq!(
            back.recurrence,
            Some(Recurrence::Weekly {
                weekdays: vec![1, 2, 3, 4, 5]
            })
        );
    }

    #[test]
    fn template_recurrence_tag_id_round_trips_and_omits_when_absent() {
        // Absent -> None, omitted on write (backward compatible).
        let t: TemplateTask =
            serde_json::from_str(r#"{"id":"k_1","title":"t","created_at":0}"#).unwrap();
        assert!(t.recurrence_tag_id.is_none());
        assert!(!serde_json::to_string(&t)
            .unwrap()
            .contains("recurrence_tag_id"));
        // Present value round-trips.
        let mut s = template("k_2");
        s.recurrence_tag_id = Some("t_ex".into());
        let back: TemplateTask = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back.recurrence_tag_id.as_deref(), Some("t_ex"));
    }
}
