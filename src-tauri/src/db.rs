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

const TASKS: &str = "tasks";
const TAGS: &str = "tags";
const TEMPLATES: &str = "template_tasks";

/// Open (or create) the working database at `path` in WAL mode and ensure the
/// schema. WAL gives fast, transactional writes; the working DB is app-private and
/// never synced (a checkpointed snapshot is exported for sync instead).
pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    init(&conn)?;
    Ok(conn)
}

/// Open a peer replica read-only and immutable (it lives in the synced folder and
/// may be mid-upload). Does not initialize schema — a peer DB is never written.
#[allow(dead_code)] // consumed by the multi-device merge (tasks group 5)
pub fn open_readonly(path: &Path) -> Result<Connection> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags)?;
    Ok(conn)
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

/// Persist the whole `Document` in a single transaction. A crash mid-write leaves
/// either the fully committed state or the prior state, never a partial row.
pub fn write_document(conn: &mut Connection, doc: &Document) -> Result<()> {
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
    let mut stmt =
        conn.prepare("SELECT data FROM tombstones WHERE kind = ?1 ORDER BY rowid")?;
    let rows = stmt.query_map([kind], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(serde_json::from_str(&row?)?);
    }
    Ok(out)
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
}
