use crate::model::{Document, Task};

/// Case-insensitive substring search over title and notes.
/// Empty/whitespace query returns empty.
pub fn search<'a>(doc: &'a Document, query: &str) -> Vec<&'a Task> {
    let q = query.trim().to_lowercase();
    if q.is_empty() { return Vec::new(); }
    doc.tasks.iter()
        .filter(|t| t.title.to_lowercase().contains(&q) || t.notes.to_lowercase().contains(&q))
        .collect()
}
