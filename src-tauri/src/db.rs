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
use serde::Serialize;
use std::collections::{HashMap, HashSet};
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
/// inner wait, without the production 5s timeout running first inside `init`.
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
/// the file. This entry point remains for the in-memory pending store.
///
/// Each attempt is a complete DELETE-then-INSERT transaction, so re-running one is
/// idempotent — a retry cannot leave a half-applied document. Only lock contention is
/// retried; every other error returns at once.
pub fn write_document(conn: &mut Connection, doc: &Document) -> Result<()> {
    retry_write(LOCK_RETRY_BUDGET, || write_document_once(conn, None, doc))
}

/// [`write_document`] for a connection that currently holds `prev`: only the rows
/// that changed are written (see [`write_delta`]).
pub fn write_document_since(conn: &mut Connection, prev: &Document, doc: &Document) -> Result<()> {
    retry_write(LOCK_RETRY_BUDGET, || write_document_once(conn, Some(prev), doc))
}

/// Open the replica, persist `doc`, and drop the connection. File-backed stores must
/// use this rather than holding a live handle: a Windows cloud-sync client exclusive-
/// opens the file (`CreateFile` `share_mode` 0) and cannot finish while SQLite still
/// has it. Closing between attempts also lets that upload complete inside the retry
/// budget; a later persist in the same process then succeeds without restarting (#179).
pub fn persist_document(path: &Path, doc: &Document) -> Result<()> {
    persist_with_timeouts(path, None, doc, LOCK_RETRY_BUDGET, BUSY_TIMEOUT)
}

/// [`persist_document`] for a replica that currently holds `prev` (the store's last
/// committed document): only the rows that changed are written. Rewriting every
/// row made each write O(document) while holding the store lock (#249 N5).
pub fn persist_document_since(path: &Path, prev: &Document, doc: &Document) -> Result<()> {
    persist_with_timeouts(path, Some(prev), doc, LOCK_RETRY_BUDGET, BUSY_TIMEOUT)
}

fn persist_with_timeouts(
    path: &Path,
    prev: Option<&Document>,
    doc: &Document,
    budget: Duration,
    busy: Duration,
) -> Result<()> {
    retry_write(budget, || {
        let mut conn = open_for_write(path, busy)?;
        let result = write_document_once(&mut conn, prev, doc);
        drop(conn);
        result
    })
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
/// partial row. With `prev`, only the difference is written when possible; either
/// way the transaction ends with the database holding exactly `doc`.
fn write_document_once(conn: &mut Connection, prev: Option<&Document>, doc: &Document) -> Result<()> {
    let tx = conn.transaction()?;
    let applied = match prev {
        Some(prev) => write_delta(&tx, prev, doc)?,
        None => false,
    };
    if !applied {
        write_all_rows(&tx, doc)?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_modified', ?1)",
        params![doc.last_modified.to_string()],
    )?;
    tx.commit()?;
    // user_version is a header field; set it outside the entity transaction.
    set_user_version(conn, doc.version)?;
    Ok(())
}

/// Replace every entity and tombstone row with `doc`'s.
fn write_all_rows(tx: &rusqlite::Transaction, doc: &Document) -> Result<()> {
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
    insert_tombstones(tx, "task", &doc.deleted_tasks)?;
    insert_tombstones(tx, "tag", &doc.deleted_tags)?;
    insert_tombstones(tx, "template", &doc.deleted_template_tasks)?;
    insert_tombstones(tx, "attachment", &doc.deleted_attachments)?;
    Ok(())
}

/// Turn the rows for `prev` into the rows for `doc` by deleting, updating in place,
/// and appending only what changed. Returns `false` when that cannot reproduce
/// `doc` — entities were reordered, or the file does not hold `prev` (a row the
/// update expected is missing, or the ids read back differ from `doc`'s) — and the caller rewrites
/// every row in the same transaction instead.
fn write_delta(tx: &rusqlite::Transaction, prev: &Document, doc: &Document) -> Result<bool> {
    let entity = |table: &'static str| RowSql {
        delete: format!("DELETE FROM {table} WHERE id = ?1"),
        update: format!("UPDATE {table} SET edit_stamp = ?2, data = ?3 WHERE id = ?1"),
        insert: format!("INSERT OR IGNORE INTO {table} (id, edit_stamp, data) VALUES (?1, ?2, ?3)"),
        ids: format!("SELECT id FROM {table} ORDER BY seq"),
    };
    // `kind` is a fixed internal constant, never user input.
    let tombstone = |kind: &'static str| RowSql {
        delete: format!("DELETE FROM tombstones WHERE kind = '{kind}' AND id = ?1"),
        update: format!(
            "UPDATE tombstones SET deleted_at = ?2, data = ?3 WHERE kind = '{kind}' AND id = ?1"
        ),
        insert: format!(
            "INSERT OR IGNORE INTO tombstones (kind, id, deleted_at, data) VALUES ('{kind}', ?1, ?2, ?3)"
        ),
        ids: format!("SELECT id FROM tombstones WHERE kind = '{kind}' ORDER BY rowid"),
    };
    fn tomb_id(t: &Tombstone) -> &str {
        &t.id
    }
    fn tomb_stamp(t: &Tombstone) -> i64 {
        t.deleted_at
    }
    Ok(rows_delta(tx, &entity(TASKS), &prev.tasks, &doc.tasks, |t| &t.id, |t| t.updated_at)?
        && rows_delta(tx, &entity(TAGS), &prev.tags, &doc.tags, |t| &t.id, |t| t.updated_at)?
        && rows_delta(
            tx,
            &entity(TEMPLATES),
            &prev.template_tasks,
            &doc.template_tasks,
            |t| &t.id,
            |t| t.updated_at,
        )?
        && rows_delta(tx, &tombstone("task"), &prev.deleted_tasks, &doc.deleted_tasks, tomb_id, tomb_stamp)?
        && rows_delta(tx, &tombstone("tag"), &prev.deleted_tags, &doc.deleted_tags, tomb_id, tomb_stamp)?
        && rows_delta(
            tx,
            &tombstone("template"),
            &prev.deleted_template_tasks,
            &doc.deleted_template_tasks,
            tomb_id,
            tomb_stamp,
        )?
        && rows_delta(
            tx,
            &tombstone("attachment"),
            &prev.deleted_attachments,
            &doc.deleted_attachments,
            tomb_id,
            tomb_stamp,
        )?)
}

/// Statements for one group of rows, each taking `(?1 id, ?2 stamp, ?3 data)`.
struct RowSql {
    delete: String,
    update: String,
    insert: String,
    /// Ids in read-back order, to confirm the result matches `next` row for row.
    ids: String,
}

/// Apply `prev` → `next` for one group of rows. Rows are read back in insertion
/// order, so this only applies when surviving items keep their relative order and
/// new items come after all of them (an append); otherwise it returns `false`.
fn rows_delta<T: Serialize + PartialEq>(
    tx: &rusqlite::Transaction,
    sql: &RowSql,
    prev: &[T],
    next: &[T],
    id: impl Fn(&T) -> &str,
    stamp: impl Fn(&T) -> i64,
) -> Result<bool> {
    if prev == next {
        return Ok(true);
    }
    let prev_at: HashMap<&str, (usize, &T)> =
        prev.iter().enumerate().map(|(i, t)| (id(t), (i, t))).collect();
    let mut updates = Vec::new();
    let mut inserts = Vec::new();
    let mut last_kept: Option<usize> = None;
    for item in next {
        match prev_at.get(id(item)) {
            Some(&(i, old)) => {
                if !inserts.is_empty() || last_kept.is_some_and(|l| i <= l) {
                    return Ok(false);
                }
                last_kept = Some(i);
                if old != item {
                    updates.push(item);
                }
            }
            None => inserts.push(item),
        }
    }
    let next_ids: HashSet<&str> = next.iter().map(&id).collect();
    for old in prev.iter().filter(|t| !next_ids.contains(id(t))) {
        if tx.prepare_cached(&sql.delete)?.execute(params![id(old)])? != 1 {
            return Ok(false);
        }
    }
    for item in updates {
        let data = serde_json::to_string(item)?;
        if tx.prepare_cached(&sql.update)?.execute(params![id(item), stamp(item), data])? != 1 {
            return Ok(false);
        }
    }
    for item in inserts {
        let data = serde_json::to_string(item)?;
        if tx.prepare_cached(&sql.insert)?.execute(params![id(item), stamp(item), data])? != 1 {
            return Ok(false);
        }
    }
    let mut stmt = tx.prepare_cached(&sql.ids)?;
    let mut rows = stmt.query([])?;
    let mut expected = next.iter().map(&id);
    while let Some(row) = rows.next()? {
        let got: String = row.get(0)?;
        if expected.next() != Some(got.as_str()) {
            return Ok(false);
        }
    }
    Ok(expected.next().is_none())
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
