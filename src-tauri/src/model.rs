use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Shortened uuid (12 hex chars) with a type prefix. Stable across devices.
fn short_id(prefix: &str) -> String {
    let hex = Uuid::new_v4().simple().to_string();
    format!("{prefix}_{}", &hex[..12])
}

pub fn new_task_id()    -> String { short_id("k") }
pub fn new_tag_id()     -> String { short_id("t") }

/// Epoch milliseconds. Used in memory for created_at/updated_at/last_modified and
/// for unique conflict-file names. UTC-based, so it's stable across devices and
/// timezone changes. On disk these stamps are written as ISO-8601 UTC strings
/// truncated to the second (see `iso_secs`); the in-memory value keeps full
/// millisecond resolution.
pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// True when a timestamp is the epoch-0 "unset" sentinel. Used by
/// `skip_serializing_if` so a never-edited document / pre-`updated_at` task omits
/// the key entirely rather than writing a misleading `1970-01-01T00:00:00Z`.
pub(crate) fn is_zero(ms: &i64) -> bool { *ms == 0 }

/// Serde for an `i64` epoch-millis field stored as an ISO-8601 UTC string at
/// second precision (e.g. `2026-06-01T12:34:56Z`). Deserialization accepts either
/// representation, so integer-millis files written by older builds (or other
/// devices still on the old format) keep loading — the model stays backward
/// compatible (AGENTS.md). Serialization always writes the ISO string.
pub(crate) mod iso_secs {
    use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
    use serde::{Deserialize, Deserializer, Serializer};

    /// Epoch millis -> ISO-8601 UTC, truncated to the second. Falls back to the
    /// raw integer string for an out-of-range instant (chrono can't represent it),
    /// which still round-trips through the integer arm of `deserialize`.
    pub(super) fn to_iso(ms: i64) -> String {
        match Utc.timestamp_millis_opt(ms).single() {
            Some(dt) => dt.to_rfc3339_opts(SecondsFormat::Secs, true),
            None      => ms.to_string(),
        }
    }

    /// ISO-8601 string -> epoch millis (any offset is normalized to UTC).
    pub(super) fn from_iso(s: &str) -> Option<i64> {
        DateTime::parse_from_rfc3339(s).ok().map(|dt| dt.timestamp_millis())
    }

    /// Accept either a JSON integer (legacy epoch millis) or an ISO-8601 string.
    #[derive(Deserialize)]
    #[serde(untagged)]
    pub(super) enum IntOrIso { Int(i64), Iso(String) }

    impl IntOrIso {
        pub(super) fn into_ms<E: serde::de::Error>(self) -> Result<i64, E> {
            match self {
                IntOrIso::Int(ms) => Ok(ms),
                IntOrIso::Iso(s)  => from_iso(&s)
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
            None    => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
        match Option::<IntOrIso>::deserialize(d)? {
            Some(v) => v.into_ms().map(Some),
            None    => Ok(None),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id:    String,
    pub name:  String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(from = "TaskCompat")]
pub struct Task {
    pub id:    String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub due_date: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub scheduled_date: Option<NaiveDate>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(serialize_with = "iso_secs::serialize")]
    pub created_at:   i64,
    /// Epoch millis the task was completed. The **single source of truth** for
    /// completion *and* archival: `Some` = done and swept out of the active views
    /// (Today/Inbox/tag/Upcoming); `None` = active. The previously-separate
    /// `done`/`archived`/`archived_at` fields collapsed into this one and are now
    /// derived via `done()`/`archived()`/`archived_at()`. Legacy files that still
    /// carry those keys are folded in on load by `TaskCompat`.
    #[serde(skip_serializing_if = "Option::is_none", default, serialize_with = "iso_secs_opt::serialize")]
    pub completed_at: Option<i64>,
    /// Epoch millis of the last edit to this task. `#[serde(default)]` = 0 for
    /// tasks written before this field existed (UI falls back to created_at);
    /// `skip_serializing_if` then omits the key rather than writing a 1970 ISO date.
    #[serde(default, skip_serializing_if = "is_zero", serialize_with = "iso_secs::serialize")]
    pub updated_at:   i64,
    /// A template is a reusable blueprint, not real work to do. It lives in the
    /// `tasks` Vec (templates serve the task center rather than competing with it)
    /// but is excluded from every active view (Today/Inbox/tag/Upcoming) exactly
    /// like a completed task, and additionally from search (unlike completed tasks,
    /// which stay searchable). New tasks are spawned from it in the Templates view
    /// (the frontend resolves the offsets and creates an ordinary task via
    /// `add_task`). `#[serde(default)]` = false for older files.
    #[serde(default)]
    pub is_template: bool,
    /// Template only: the instantiated task's due date is today + this many days.
    /// `None` = the spawned task has no due date. Meaningless on non-template tasks.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub due_offset_days: Option<i64>,
    /// Template only: the instantiated task's scheduled date is today + this many
    /// days. `None` = the spawned task has no scheduled date.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub scheduled_offset_days: Option<i64>,
}

/// Deserialization shim that accepts the legacy `done`/`archived`/`archived_at`
/// keys and folds them into `completed_at`, so files written before those three
/// fields were merged still load (AGENTS.md: model changes stay backward
/// compatible). `completed_at` wins when present; otherwise a task flagged
/// `done` or `archived` is preserved as completed — using `archived_at`, or epoch
/// `0` as a "done, time unknown" sentinel. New files never write the legacy keys.
#[derive(Deserialize)]
struct TaskCompat {
    id:    String,
    title: String,
    #[serde(default)]
    done:  bool,
    #[serde(default)]
    due_date: Option<NaiveDate>,
    #[serde(default)]
    scheduled_date: Option<NaiveDate>,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    tag_ids: Vec<String>,
    #[serde(deserialize_with = "iso_secs::deserialize")]
    created_at: i64,
    #[serde(default, deserialize_with = "iso_secs_opt::deserialize")]
    completed_at: Option<i64>,
    #[serde(default, deserialize_with = "iso_secs::deserialize")]
    updated_at: i64,
    #[serde(default)]
    archived: bool,
    #[serde(default, deserialize_with = "iso_secs_opt::deserialize")]
    archived_at: Option<i64>,
    #[serde(default)]
    is_template: bool,
    #[serde(default)]
    due_offset_days: Option<i64>,
    #[serde(default)]
    scheduled_offset_days: Option<i64>,
}

impl From<TaskCompat> for Task {
    fn from(c: TaskCompat) -> Self {
        let completed_at = c.completed_at.or_else(|| {
            if c.done || c.archived { c.archived_at.or(Some(0)) } else { None }
        });
        Task {
            id: c.id,
            title: c.title,
            due_date: c.due_date,
            scheduled_date: c.scheduled_date,
            notes: c.notes,
            tag_ids: c.tag_ids,
            created_at: c.created_at,
            completed_at,
            updated_at: c.updated_at,
            is_template: c.is_template,
            due_offset_days: c.due_offset_days,
            scheduled_offset_days: c.scheduled_offset_days,
        }
    }
}

/// Bumped to 4 when on-disk timestamps switched from integer epoch-millis to
/// ISO-8601 UTC strings (`created_at`/`updated_at`/`completed_at`/`last_modified`).
/// A pre-4 build can't parse the ISO strings, so the higher version also lets
/// `parse_checked` reject the file with a clear "update the app" message where it
/// can. New builds still read old integer-millis files (see `iso_secs`).
pub const CURRENT_VERSION: u32 = 4;

/// Files written before `version` existed are assumed compatible with the
/// current schema (the model is additive/backward-compatible), so an absent
/// key loads as `CURRENT_VERSION` rather than 0 (which would downgrade the file
/// on the next write).
fn default_version() -> u32 {
    CURRENT_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    #[serde(default = "default_version")]
    pub version:  u32,
    /// Epoch millis of the last edit to the document (any task/tag change).
    /// Bumped by `AppState::write`. Shown as "Last synced"; identical on all
    /// devices when in sync. `#[serde(default)]` = 0 for pre-existing files;
    /// `skip_serializing_if` omits the key for a never-edited document so the UI
    /// shows an em dash rather than a 1970 ISO date.
    #[serde(default, skip_serializing_if = "is_zero", with = "iso_secs")]
    pub last_modified: i64,
    #[serde(default)]
    pub tags:     Vec<Tag>,
    #[serde(default)]
    pub tasks:    Vec<Task>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            version:  CURRENT_VERSION,
            last_modified: 0,
            tags:     Vec::new(),
            tasks:    Vec::new(),
        }
    }
}

impl Task {
    /// True if the task is completed. Since `done`/`archived`/`archived_at`
    /// merged into `completed_at`, "done" and "archived" are the same state: a
    /// completed task is swept out of the active views.
    pub fn done(&self) -> bool { self.completed_at.is_some() }

    /// True if the task is archived — identical to `done()` now that completion
    /// and archival are one state. Kept as a named accessor so call sites that
    /// mean "hidden from active views" stay readable.
    pub fn archived(&self) -> bool { self.completed_at.is_some() }

    /// Epoch millis the task was archived (= completed), or `None` if active.
    pub fn archived_at(&self) -> Option<i64> { self.completed_at }

    /// Set or clear completion. Completing sweeps the task out of the active
    /// views (Today/Inbox/tag); reopening restores it. `completed_at` is the
    /// single field encoding both.
    pub fn set_done(&mut self, done: bool, ts: i64) {
        self.completed_at = if done { Some(ts) } else { None };
        self.updated_at = ts;
    }
}

impl Document {
    /// True if the task is in Inbox (has no tags).
    pub fn task_in_inbox(&self, task: &Task) -> bool {
        task.tag_ids.is_empty()
    }

    /// Today: scheduled today, OR (due < today AND !done), OR due == today.
    /// Archived tasks never appear in active views.
    pub fn tasks_today(&self, today: NaiveDate) -> Vec<&Task> {
        self.tasks.iter().filter(|t| {
            if t.archived() || t.is_template { return false; }
            if t.scheduled_date == Some(today) { return true; }
            if let Some(due) = t.due_date {
                if due == today { return true; }
                if due < today && !t.done() { return true; }
            }
            false
        }).collect()
    }

    pub fn tasks_inbox(&self) -> Vec<&Task> {
        self.tasks.iter().filter(|t| !t.archived() && !t.is_template && self.task_in_inbox(t)).collect()
    }

    pub fn tasks_for_tag(&self, tag_id: &str) -> Vec<&Task> {
        self.tasks.iter()
            .filter(|t| !t.archived() && !t.is_template && t.tag_ids.iter().any(|id| id == tag_id))
            .collect()
    }

    /// Templates (reusable blueprints). The complement of the active views above —
    /// these are the only place templates surface.
    pub fn tasks_templates(&self) -> Vec<&Task> {
        self.tasks.iter().filter(|t| t.is_template).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task() -> Task {
        Task {
            id: "k_1".into(),
            title: "t".into(),
            due_date: None,
            scheduled_date: None,
            notes: String::new(),
            tag_ids: Vec::new(),
            created_at: 0,
            completed_at: None,
            updated_at: 0,
            is_template: false,
            due_offset_days: None,
            scheduled_offset_days: None,
        }
    }

    #[test]
    fn tag_pinned_defaults_to_false_for_legacy_data() {
        // A tag written before `pinned` existed (no key) must load as unpinned,
        // so an upgrade keeps legacy tags out of the curated sidebar rather than
        // failing the parse.
        let t: Tag = serde_json::from_str(r##"{"id":"t_1","name":"work","color":"#000"}"##).unwrap();
        assert!(!t.pinned);
        // And a present value round-trips.
        let pinned: Tag =
            serde_json::from_str(r##"{"id":"t_2","name":"home","color":"#111","pinned":true}"##).unwrap();
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
        assert!(!t.archived(), "reopening a task restores it to the active views");
        assert_eq!(t.archived_at(), None);
        assert_eq!(t.updated_at, 200);
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
            serde_json::from_str(r##"{"id":"k_2","title":"t","done":true,"created_at":0}"##).unwrap();
        assert_eq!(no_ts.completed_at, Some(0));
        assert!(no_ts.done());

        // A legacy active task stays active.
        let active: Task =
            serde_json::from_str(r##"{"id":"k_3","title":"t","done":false,"created_at":0,"archived":false}"##).unwrap();
        assert_eq!(active.completed_at, None);
        assert!(!active.done());
    }

    #[test]
    fn completed_task_serializes_without_legacy_keys() {
        let mut t = task();
        // 2026-06-01T12:34:56Z in epoch millis (whole second, so it round-trips
        // losslessly through the second-precision ISO form).
        t.set_done(true, 1_780_317_296_000);
        let json = serde_json::to_string(&t).unwrap();
        assert!(json.contains("\"completed_at\":\"2026-06-01T12:34:56Z\""), "{json}");
        assert!(!json.contains("\"done\""), "no legacy done key: {json}");
        assert!(!json.contains("\"archived\""), "no legacy archived key: {json}");
        assert!(!json.contains("archived_at"), "no legacy archived_at key: {json}");
    }

    #[test]
    fn timestamps_serialize_as_iso_utc_seconds() {
        let mut t = task();
        t.created_at = 1_780_317_296_000; // 2026-06-01T12:34:56Z
        t.updated_at = 1_780_317_296_000;
        let json = serde_json::to_string(&t).unwrap();
        assert!(json.contains("\"created_at\":\"2026-06-01T12:34:56Z\""), "{json}");
        assert!(json.contains("\"updated_at\":\"2026-06-01T12:34:56Z\""), "{json}");

        // updated_at == 0 (the "never edited" sentinel) is omitted, not written as 1970.
        t.updated_at = 0;
        let json = serde_json::to_string(&t).unwrap();
        assert!(!json.contains("updated_at"), "zero updated_at is skipped: {json}");

        // Document.last_modified == 0 is likewise omitted, but a real stamp is ISO.
        let mut doc = Document::default();
        assert!(!serde_json::to_string(&doc).unwrap().contains("last_modified"));
        doc.last_modified = 1_780_317_296_000;
        assert!(serde_json::to_string(&doc).unwrap()
            .contains("\"last_modified\":\"2026-06-01T12:34:56Z\""));
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

    #[test]
    fn templates_are_excluded_from_every_active_view() {
        let today = NaiveDate::from_ymd_opt(2026, 5, 31).unwrap();
        let mut doc = Document::default();
        // A template that — were it a normal task — would show in Today (scheduled
        // today), Inbox (untagged), and a tag view.
        let mut tmpl = task();
        tmpl.id = "k_tmpl".into();
        tmpl.is_template = true;
        tmpl.scheduled_date = Some(today);
        tmpl.tag_ids = vec!["t_work".into()];
        // A normal task sharing the same shape, to prove the views aren't simply empty.
        let mut real = task();
        real.id = "k_real".into();
        real.scheduled_date = Some(today);
        real.tag_ids = vec!["t_work".into()];
        doc.tasks.push(tmpl);
        doc.tasks.push(real);

        let ids = |v: Vec<&Task>| v.into_iter().map(|t| t.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(doc.tasks_today(today)), ["k_real"]);
        assert_eq!(ids(doc.tasks_for_tag("t_work")), ["k_real"]);
        // The template has a tag, but a tagged template must still not count as Inbox
        // material either way — confirm an untagged template is kept out of Inbox.
        let mut untagged_tmpl = task();
        untagged_tmpl.id = "k_tmpl2".into();
        untagged_tmpl.is_template = true;
        doc.tasks.push(untagged_tmpl);
        assert!(ids(doc.tasks_inbox()).is_empty());
        // ...and templates are the only thing tasks_templates surfaces.
        assert_eq!(ids(doc.tasks_templates()), ["k_tmpl", "k_tmpl2"]);
    }
}
