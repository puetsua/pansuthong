//! SQLite persistence for the synced `Document`.
//!
//! The document is stored blob-per-entity: each entity type gets a table shaped
//! `(seq, id, edit_stamp, data)` where `data` is the serde-JSON of the exact Rust
//! model entity and `edit_stamp` (the entity's `updated_at`) is promoted to a
//! column for indexed merge lookups. Tombstones live in their own table; the
//! document-level `last_modified` lives in `meta`, and the schema version is the
//! database's `PRAGMA user_version`.
//!
//! Storing entities as their serialized model shape means the model's
//! backward-compatibility (serde defaults/aliases) carries straight over: a new
//! optional field never needs a SQL migration, and there is no second schema that
//! can drift from `model.rs`.

use crate::error::{AppError, Result};
use crate::model::{Document, Tombstone, CURRENT_VERSION};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::path::Path;
use std::time::{Duration, Instant};

const TASKS: &str = "tasks";
const TAGS: &str = "tags";
const TEMPLATES: &str = "template_tasks";

/// How long writers wait for a lock held by a cloud-sync client (or a brief peer
/// open) before surfacing `database is locked`. Default SQLite busy timeout is 0
/// (fail immediately), which turns transient Drive/OneDrive contention into hard
/// update failures.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// Total wall-clock budget for riding out a lock held by another process before a
/// write gives up. `BUSY_TIMEOUT` alone is not enough: measured against a stand-in
/// sync client holding an exclusive lock, a 6s hold was ridden out but a 12s hold
/// failed, and real clients routinely hold one that long while uploading. The budget
/// is the trade-off between surviving an upload and appearing to hang — past this,
/// reporting back beats blocking the UI further, and the failure is now clean.
pub(crate) const LOCK_RETRY_BUDGET: Duration = Duration::from_secs(15);

/// Pause between attempts. Contention here is with a foreign process on a timescale of
/// seconds, and each attempt already blocks for up to `BUSY_TIMEOUT` inside SQLite, so
/// a short fixed pause is enough — exponential backoff would buy nothing.
const LOCK_RETRY_PAUSE: Duration = Duration::from_millis(250);

/// Shown to the user when the budget is exhausted. Names the likely cause and states
/// plainly that nothing was saved, so "try again" is understood as the next step.
const LOCKED_MESSAGE: &str = "The data file is locked by another program \
    (usually a cloud-sync client finishing an upload). Your change was not saved — \
    please try again in a moment.";

/// True for errors that mean "someone else holds the file", the only ones worth
/// retrying. A constraint violation, a corrupt database, or `SQLITE_CANTOPEN` on a
/// missing/invalid path will not improve with time, so those must surface immediately.
fn is_lock_contention(e: &AppError) -> bool {
    match e {
        AppError::Db(rusqlite::Error::SqliteFailure(inner, msg)) => {
            matches!(
                inner.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            ) || msg
                .as_deref()
                .is_some_and(|m| m.to_ascii_lowercase().contains("sharing violation"))
        }
        AppError::Io(io) => is_sharing_violation(io),
        _ => false,
    }
}

/// Windows `CreateFile` exclusive (`share_mode` 0) and Unix `EBUSY`/`EAGAIN` while
/// another process holds the replica. Not a generic permission or not-found error.
fn is_sharing_violation(e: &std::io::Error) -> bool {
    matches!(e.raw_os_error(), Some(32) | Some(33) | Some(11) | Some(16))
}

/// Open (or create) the database at `path` and ensure the schema. Uses rollback
/// (`DELETE`) journal mode with `synchronous=FULL` so exactly one file exists at
/// rest — no persistent `-wal`/`-shm` sidecars for a cloud-sync client to sync out
/// of step — and a committed transaction is durable. The brief `-journal` written
/// during a commit is removed when the transaction ends; peers guard against a torn
/// mid-commit read with `PRAGMA quick_check` (see `load_from_file`).
pub fn open(path: &Path) -> Result<Connection> {
    open_for_write(path, BUSY_TIMEOUT)
}

/// Open the replica with `busy` applied *before* any pragma or schema write, so a
/// lock held by another process is retried on our budget rather than SQLite's default
/// inner wait. [`persist_document`] uses this so tests can shrink the wait without
/// the production 5s timeout running first inside `init`.
fn open_for_write(path: &Path, busy: Duration) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(busy)?;
    conn.pragma_update(None, "journal_mode", "DELETE")?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    init(&conn)?;
    Ok(conn)
}

/// Open an in-memory database with the same schema. Used as a temporary stand-in
/// when the real data folder isn't available yet (e.g. Google Drive not mounted at
/// boot). The in-memory store is discarded once the real store opens.
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    init(&conn)?;
    Ok(conn)
}

/// Open a staged replica read-only. Prefer [`load_from_file`], which copies first
/// so SQLite never locks a live cloud-synced peer path. Direct opens still use
/// URI `immutable=1` so no lock is taken even if called on a shared path.
pub fn open_readonly(path: &Path) -> Result<Connection> {
    let uri = sqlite_immutable_uri(path)?;
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY
        | OpenFlags::SQLITE_OPEN_URI
        | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(&uri, flags)?;
    Ok(conn)
}

/// Build a `file:` URI with `mode=ro&immutable=1` so SQLite does not acquire a
/// shared lock (critical when the file lives in a cloud-sync folder, and so a
/// mistaken second open of our own replica cannot block the writer).
fn sqlite_immutable_uri(path: &Path) -> Result<String> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().map_err(AppError::Io)?.join(path)
    };
    let raw = abs.to_string_lossy();
    // SQLite URI paths use forward slashes; percent-encode characters that would
    // break the query string (`?`, `#`) or the path (`%`, space, non-ASCII).
    let mut encoded = String::with_capacity(raw.len() + 16);
    for b in raw.bytes() {
        match b {
            b'\\' => encoded.push('/'),
            b'%' => encoded.push_str("%25"),
            b'?' => encoded.push_str("%3F"),
            b'#' => encoded.push_str("%23"),
            b' ' => encoded.push_str("%20"),
            // Printable ASCII except the specials matched above.
            0x21..=0x7E => encoded.push(b as char),
            _ => encoded.push_str(&format!("%{b:02X}")),
        }
    }
    // Windows `C:/…` needs the `file:///C:/…` form; Unix paths already start with `/`.
    let body = if encoded.starts_with('/') {
        encoded
    } else {
        format!("/{encoded}")
    };
    Ok(format!("file://{body}?mode=ro&immutable=1"))
}

fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tasks (
            seq        INTEGER PRIMARY KEY AUTOINCREMENT,
            id         TEXT    NOT NULL UNIQUE,
            edit_stamp INTEGER NOT NULL,
            data       TEXT    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tags (
            seq        INTEGER PRIMARY KEY AUTOINCREMENT,
            id         TEXT    NOT NULL UNIQUE,
            edit_stamp INTEGER NOT NULL,
            data       TEXT    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS template_tasks (
            seq        INTEGER PRIMARY KEY AUTOINCREMENT,
            id         TEXT    NOT NULL UNIQUE,
            edit_stamp INTEGER NOT NULL,
            data       TEXT    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tombstones (
            kind       TEXT    NOT NULL,
            id         TEXT    NOT NULL,
            deleted_at INTEGER NOT NULL,
            data       TEXT    NOT NULL,
            PRIMARY KEY (kind, id)
        );
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )?;
    // A freshly created database reports user_version 0; stamp the current schema
    // version so the version gate has a value to compare against.
    if read_user_version(conn)? == 0 {
        set_user_version(conn, CURRENT_VERSION)?;
    }
    Ok(())
}

fn read_user_version(conn: &Connection) -> Result<u32> {
    let v: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    Ok(v as u32)
}

fn set_user_version(conn: &Connection, v: u32) -> Result<()> {
    // PRAGMA user_version does not accept a bound parameter.
    conn.execute_batch(&format!("PRAGMA user_version = {v}"))?;
    Ok(())
}

/// Persist the whole `Document` on an already-open connection, retrying while another
/// process holds the file. Prefer [`persist_document`] for a file-backed replica: that
/// path drops the handle between attempts so a Windows sync client can exclusive-open
/// the file. This entry point remains for the in-memory pending store and tests.
///
/// Each attempt is a complete DELETE-then-INSERT transaction, so re-running one is
/// idempotent — a retry cannot leave a half-applied document. Only lock contention is
/// retried; every other error returns at once.
pub fn write_document(conn: &mut Connection, doc: &Document) -> Result<()> {
    write_document_within(conn, doc, LOCK_RETRY_BUDGET)
}

/// [`write_document`] with an explicit budget, so tests can exercise exhaustion
/// without sleeping for the production budget.
pub(crate) fn write_document_within(
    conn: &mut Connection,
    doc: &Document,
    budget: Duration,
) -> Result<()> {
    retry_write(budget, || write_document_once(conn, doc))
}

/// Open the replica, persist `doc`, and drop the connection. File-backed stores must
/// use this rather than holding a live handle: a Windows cloud-sync client exclusive-
/// opens the file (`CreateFile` `share_mode` 0) and cannot finish while SQLite still
/// has it. Closing between attempts also lets that upload complete inside the retry
/// budget; a later persist in the same process then succeeds without restarting (#179).
pub fn persist_document(path: &Path, doc: &Document) -> Result<()> {
    persist_document_within(path, doc, LOCK_RETRY_BUDGET)
}

/// [`persist_document`] with an explicit budget, so tests can exercise exhaustion
/// without sleeping for the production budget.
pub(crate) fn persist_document_within(path: &Path, doc: &Document, budget: Duration) -> Result<()> {
    persist_with_timeouts(path, doc, budget, BUSY_TIMEOUT)
}

fn persist_with_timeouts(
    path: &Path,
    doc: &Document,
    budget: Duration,
    busy: Duration,
) -> Result<()> {
    retry_write(budget, || {
        let mut conn = open_for_write(path, busy)?;
        let result = write_document_once(&mut conn, doc);
        drop(conn);
        result
    })
}

#[cfg(test)]
pub(crate) fn persist_document_within_for_test(
    path: &Path,
    doc: &Document,
    budget: Duration,
    busy: Duration,
) -> Result<()> {
    persist_with_timeouts(path, doc, budget, busy)
}

fn retry_write(budget: Duration, mut attempt: impl FnMut() -> Result<()>) -> Result<()> {
    let deadline = Instant::now() + budget;
    loop {
        match attempt() {
            Err(e) if is_lock_contention(&e) => {
                if Instant::now() >= deadline {
                    return Err(AppError::Busy(LOCKED_MESSAGE.to_string()));
                }
                std::thread::sleep(LOCK_RETRY_PAUSE);
            }
            other => return other,
        }
    }
}

/// One attempt at persisting the whole `Document` in a single transaction. A crash
/// mid-write leaves either the fully committed state or the prior state, never a
/// partial row.
fn write_document_once(conn: &mut Connection, doc: &Document) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM tasks", [])?;
    tx.execute("DELETE FROM tags", [])?;
    tx.execute("DELETE FROM template_tasks", [])?;
    tx.execute("DELETE FROM tombstones", [])?;

    for t in &doc.tasks {
        tx.execute(
            "INSERT INTO tasks (id, edit_stamp, data) VALUES (?1, ?2, ?3)",
            params![t.id, t.updated_at, serde_json::to_string(t)?],
        )?;
    }
    for t in &doc.tags {
        tx.execute(
            "INSERT INTO tags (id, edit_stamp, data) VALUES (?1, ?2, ?3)",
            params![t.id, t.updated_at, serde_json::to_string(t)?],
        )?;
    }
    for t in &doc.template_tasks {
        tx.execute(
            "INSERT INTO template_tasks (id, edit_stamp, data) VALUES (?1, ?2, ?3)",
            params![t.id, t.updated_at, serde_json::to_string(t)?],
        )?;
    }
    insert_tombstones(&tx, "task", &doc.deleted_tasks)?;
    insert_tombstones(&tx, "tag", &doc.deleted_tags)?;
    insert_tombstones(&tx, "template", &doc.deleted_template_tasks)?;
    insert_tombstones(&tx, "attachment", &doc.deleted_attachments)?;

    tx.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_modified', ?1)",
        params![doc.last_modified.to_string()],
    )?;
    tx.commit()?;
    // user_version is a header field; set it outside the entity transaction.
    set_user_version(conn, doc.version)?;
    Ok(())
}

fn insert_tombstones(tx: &rusqlite::Transaction, kind: &str, tombs: &[Tombstone]) -> Result<()> {
    for ts in tombs {
        tx.execute(
            "INSERT INTO tombstones (kind, id, deleted_at, data) VALUES (?1, ?2, ?3, ?4)",
            params![kind, ts.id, ts.deleted_at, serde_json::to_string(ts)?],
        )?;
    }
    Ok(())
}

/// Read the whole `Document`, refusing a database whose schema version is newer
/// than this build supports (so an older build never drops unknown data).
pub fn read_document(conn: &Connection) -> Result<Document> {
    let version = read_user_version(conn)?;
    if version > CURRENT_VERSION {
        return Err(AppError::Invalid(format!(
            "data file version {version} is newer than this app supports (max {CURRENT_VERSION}); update the app"
        )));
    }
    let doc = Document {
        version,
        last_modified: read_meta_i64(conn, "last_modified")?.unwrap_or(0),
        tags: read_entities(conn, TAGS)?,
        tasks: read_entities(conn, TASKS)?,
        template_tasks: read_entities(conn, TEMPLATES)?,
        deleted_tasks: read_tombstones(conn, "task")?,
        deleted_tags: read_tombstones(conn, "tag")?,
        deleted_template_tasks: read_tombstones(conn, "template")?,
        deleted_attachments: read_tombstones(conn, "attachment")?,
    };
    Ok(doc)
}

fn read_entities<T: serde::de::DeserializeOwned>(conn: &Connection, table: &str) -> Result<Vec<T>> {
    // `table` is a fixed internal constant, never user input.
    let mut stmt = conn.prepare(&format!("SELECT data FROM {table} ORDER BY seq"))?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(serde_json::from_str(&row?)?);
    }
    Ok(out)
}

fn read_tombstones(conn: &Connection, kind: &str) -> Result<Vec<Tombstone>> {
    let mut stmt = conn.prepare("SELECT data FROM tombstones WHERE kind = ?1 ORDER BY rowid")?;
    let rows = stmt.query_map([kind], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(serde_json::from_str(&row?)?);
    }
    Ok(out)
}

/// Load a `Document` from a replica `.db` file. Bytes are staged to a temp file
/// before SQLite opens them so we never take a lock on a live cloud-synced path
/// (Drive/OneDrive mid-upload, or our own writer connection). Applies the version
/// gate and `quick_check` integrity pre-check.
pub fn load_from_file(path: &Path) -> Result<Document> {
    let bytes = std::fs::read(path)?;
    load_from_bytes(&bytes)
}

/// Decode a `Document` from raw `.db` file bytes (e.g. a replica pulled over SAF).
/// The bytes are staged to a temp file because SQLite opens paths, not buffers.
pub fn load_from_bytes(bytes: &[u8]) -> Result<Document> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut tmp = std::env::temp_dir();
    tmp.push(format!(
        "pansuthong-replica-{}-{}.db",
        crate::model::now_ms(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&tmp, bytes)?;
    let result = (|| {
        let conn = open_readonly(&tmp)?;
        // A partially-synced file may fail an integrity check; surface it as an
        // error so the caller can skip this replica for now.
        let ok: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if ok != "ok" {
            return Err(AppError::Invalid(format!(
                "replica failed integrity check: {ok}"
            )));
        }
        read_document(&conn)
    })();
    let _ = std::fs::remove_file(&tmp);
    result
}

fn read_meta_i64(conn: &Connection, key: &str) -> Result<Option<i64>> {
    let value: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()?;
    Ok(value.and_then(|s| s.parse().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Task;

    fn in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn
    }

    /// Smoke test (task 1.2): the bundled SQLite links and a connection opens.
    #[test]
    fn opens_in_memory() {
        let conn = in_memory();
        assert_eq!(read_user_version(&conn).unwrap(), CURRENT_VERSION);
    }

    fn sample_task(id: &str, updated_at: i64) -> Task {
        Task {
            id: id.into(),
            title: id.into(),
            due_date: None,
            due_time: None,
            start_date: None,
            start_time: None,
            notes: String::new(),
            attachments: Vec::new(),
            tag_ids: Vec::new(),
            estimated_seconds: None,
            created_at: 0,
            completed_at: None,
            updated_at,
            time_entries: Vec::new(),
        }
    }

    #[test]
    fn document_round_trips() {
        let mut conn = in_memory();
        let mut doc = Document::default();
        doc.last_modified = 1_700_000_000_000;
        doc.tasks.push(sample_task("k_a", 1_000));
        doc.tasks.push(sample_task("k_b", 2_000));
        doc.deleted_tasks.push(Tombstone {
            id: "k_gone".into(),
            deleted_at: 5_000,
            deleted_by: Some("dev".into()),
        });

        write_document(&mut conn, &doc).unwrap();
        let back = read_document(&conn).unwrap();

        // The SQLite store must be equivalent to the JSON store: compare the DB
        // round-trip against a JSON round-trip of the same document (both normalize
        // timestamps to the on-disk second precision). The model derives no
        // PartialEq, so compare serialized form.
        let via_json: Document =
            serde_json::from_slice(&serde_json::to_vec(&doc).unwrap()).unwrap();
        assert_eq!(
            serde_json::to_value(&via_json).unwrap(),
            serde_json::to_value(&back).unwrap()
        );
    }

    #[test]
    fn insertion_order_is_preserved() {
        let mut conn = in_memory();
        let mut doc = Document::default();
        for id in ["k_c", "k_a", "k_b"] {
            doc.tasks.push(sample_task(id, 0));
        }
        write_document(&mut conn, &doc).unwrap();
        let back = read_document(&conn).unwrap();
        let ids: Vec<_> = back.tasks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["k_c", "k_a", "k_b"]);
    }

    #[test]
    fn version_gate_rejects_newer() {
        let mut conn = in_memory();
        write_document(&mut conn, &Document::default()).unwrap();
        // Simulate a replica written by a future build.
        set_user_version(&conn, CURRENT_VERSION + 1).unwrap();
        assert!(
            read_document(&conn).is_err(),
            "a database newer than this build must be refused"
        );
    }

    #[test]
    fn rewrite_replaces_prior_state() {
        let mut conn = in_memory();
        let mut doc = Document::default();
        doc.tasks.push(sample_task("k_a", 0));
        write_document(&mut conn, &doc).unwrap();

        let mut doc2 = Document::default();
        doc2.tasks.push(sample_task("k_b", 0));
        write_document(&mut conn, &doc2).unwrap();

        let back = read_document(&conn).unwrap();
        let ids: Vec<_> = back.tasks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["k_b"], "a rewrite fully replaces the prior document");
    }

    #[test]
    fn load_from_file_does_not_block_live_writer() {
        use std::sync::{Arc, Barrier};
        use std::thread;
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let mut conn = open(&path).unwrap();
        let mut doc = Document::default();
        doc.tasks.push(sample_task("k_a", 1));
        write_document(&mut conn, &doc).unwrap();

        // Concurrent peer-style loads must not take a lock on the live file, or
        // the writer's next transaction fails with "database is locked".
        let barrier = Arc::new(Barrier::new(2));
        let path_bg = path.clone();
        let barrier_bg = Arc::clone(&barrier);
        let loader = thread::spawn(move || {
            barrier_bg.wait();
            for _ in 0..20 {
                load_from_file(&path_bg).unwrap();
            }
        });

        barrier.wait();
        for i in 0..20 {
            doc.tasks[0].updated_at = i;
            write_document(&mut conn, &doc).expect("writer must not see database is locked");
        }
        loader.join().unwrap();
    }

    /// Hold an exclusive lock on `path` for `hold`, standing in for a sync client
    /// mid-upload. Returns once the lock is actually taken; join the handle to wait
    /// for the release.
    fn hold_exclusive_lock(path: &Path, hold: Duration) -> std::thread::JoinHandle<()> {
        use std::sync::mpsc;

        let (taken_tx, taken_rx) = mpsc::channel();
        let path = path.to_path_buf();
        let handle = std::thread::spawn(move || {
            let conn = open(&path).unwrap();
            conn.execute_batch("BEGIN EXCLUSIVE").unwrap();
            taken_tx.send(()).unwrap();
            std::thread::sleep(hold);
            conn.execute_batch("COMMIT").unwrap();
        });
        taken_rx.recv().unwrap();
        handle
    }

    #[test]
    fn exhausted_budget_reports_busy_not_a_raw_sqlite_error() {
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let mut conn = open(&path).unwrap();
        // Shrink SQLite's own wait so budget exhaustion is reached in test time; the
        // retry contract under test is the outer loop, not the inner timeout.
        conn.busy_timeout(Duration::from_millis(50)).unwrap();

        let holder = hold_exclusive_lock(&path, Duration::from_secs(2));
        let result =
            write_document_within(&mut conn, &Document::default(), Duration::from_millis(300));
        holder.join().unwrap();

        match result {
            Err(AppError::Busy(msg)) => {
                assert!(
                    msg.contains("not saved"),
                    "the message must say the change was not saved: {msg}",
                );
                assert!(
                    !msg.contains("database is locked"),
                    "the raw SQLite string must not reach the user: {msg}",
                );
            }
            other => panic!("expected AppError::Busy, got {other:?}"),
        }
    }

    #[test]
    fn a_non_lock_error_is_not_retried() {
        let mut conn = in_memory();
        // A document one version ahead is refused by the version gate on read; here we
        // force a write failure that is not contention by dropping a table the write
        // depends on. It must return immediately rather than burn the budget.
        conn.execute_batch("DROP TABLE tasks").unwrap();

        let started = Instant::now();
        let result =
            write_document_within(&mut conn, &Document::default(), Duration::from_secs(30));

        assert!(result.is_err(), "a missing table must fail the write");
        assert!(
            !matches!(result, Err(AppError::Busy(_))),
            "a non-lock failure must not be reported as contention",
        );
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "a non-lock failure must not consume the retry budget",
        );
    }

    fn persist_busy_assert(result: Result<()>) {
        match result {
            Err(AppError::Busy(msg)) => {
                assert!(
                    msg.contains("not saved"),
                    "the message must say the change was not saved: {msg}",
                );
                assert!(
                    !msg.contains("database is locked"),
                    "the raw SQLite string must not reach the user: {msg}",
                );
            }
            other => panic!("expected AppError::Busy, got {other:?}"),
        }
    }

    #[test]
    fn persist_document_exhausted_budget_reports_busy() {
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        persist_document(&path, &Document::default()).unwrap();

        let holder = hold_exclusive_lock(&path, Duration::from_secs(2));
        let result = persist_document_within_for_test(
            &path,
            &Document::default(),
            Duration::from_millis(300),
            Duration::from_millis(50),
        );
        holder.join().unwrap();
        persist_busy_assert(result);
    }

    #[test]
    fn persist_document_recovers_in_the_same_session_after_the_lock_clears() {
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        persist_document(&path, &Document::default()).unwrap();

        let holder = hold_exclusive_lock(&path, Duration::from_secs(2));
        let first = persist_document_within_for_test(
            &path,
            &Document::default(),
            Duration::from_millis(300),
            Duration::from_millis(50),
        );
        persist_busy_assert(first);
        holder.join().unwrap();

        persist_document(&path, &Document::default())
            .expect("the next persist in this process must succeed once the lock is gone");
    }

    #[test]
    fn persist_document_does_not_retry_a_corrupt_replica() {
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        persist_document(&path, &Document::default()).unwrap();
        std::fs::write(&path, b"not a sqlite database").unwrap();

        let started = Instant::now();
        let result = persist_document_within(&path, &Document::default(), Duration::from_secs(30));

        assert!(result.is_err(), "garbage bytes must fail the persist");
        assert!(
            !matches!(result, Err(AppError::Busy(_))),
            "a corrupt file must not be reported as contention",
        );
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "a corrupt file must not consume the retry budget",
        );
    }

    #[cfg(unix)]
    #[test]
    fn persist_document_releases_the_replica_file() {
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        persist_document(&path, &Document::default()).unwrap();
        assert!(
            open_fds_to(&path).is_empty(),
            "persist must drop the replica handle: {:?}",
            open_fds_to(&path),
        );
    }

    #[cfg(unix)]
    fn open_fds_to(path: &Path) -> Vec<std::path::PathBuf> {
        let Ok(canon) = path.canonicalize() else {
            return Vec::new();
        };
        let Ok(dir) = std::fs::read_dir("/proc/self/fd") else {
            return Vec::new();
        };
        dir.flatten()
            .filter_map(|entry| std::fs::read_link(entry.path()).ok())
            .filter(|target| target == &canon)
            .collect()
    }

    #[test]
    fn immutable_uri_opens_windows_style_paths() {
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let path = dir.path().join("tasks_dev.db");
        let mut conn = open(&path).unwrap();
        write_document(&mut conn, &Document::default()).unwrap();
        drop(conn);

        let uri = sqlite_immutable_uri(&path).unwrap();
        assert!(uri.starts_with("file://"), "uri={uri}");
        assert!(uri.contains("mode=ro&immutable=1"), "uri={uri}");
        assert!(!uri.contains('\\'), "uri must use forward slashes: {uri}");

        let back = load_from_file(&path).unwrap();
        assert_eq!(back.version, CURRENT_VERSION);
    }
}
