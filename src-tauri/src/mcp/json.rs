//! Compact JSON shapes returned by MCP tools.

use crate::model::{Tag, Task};
use schemars::JsonSchema;
use serde::Serialize;

#[derive(Serialize, JsonSchema)]
pub struct ListTasksOutput {
    pub tasks: Vec<McpTask>,
    /// True when a `limit` was applied and more tasks matched the filters.
    pub truncated: bool,
}

#[derive(Serialize, JsonSchema)]
pub struct ListTagsOutput {
    pub tags: Vec<McpTagRef>,
}

#[derive(Serialize, JsonSchema)]
pub struct McpTagRef {
    pub id: String,
    pub name: String,
    pub color: String,
    pub priority: i64,
}

#[derive(Serialize, JsonSchema)]
pub struct DeleteTaskOutput {
    pub deleted: bool,
    pub id: String,
}

#[derive(Serialize, JsonSchema)]
pub struct McpTask {
    pub id: String,
    pub title: String,
    pub notes: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    pub tags: Vec<String>,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_minutes: Option<i64>,
}

pub fn tag_to_mcp_ref(tag: &Tag) -> McpTagRef {
    McpTagRef {
        id: tag.id.clone(),
        name: tag.name.clone(),
        color: tag.color.clone(),
        priority: tag.priority,
    }
}

pub fn task_to_mcp(task: &Task, tags_by_id: &std::collections::HashMap<&str, &Tag>) -> McpTask {
    let tag_names: Vec<String> = task
        .tag_ids
        .iter()
        .filter_map(|id| tags_by_id.get(id.as_str()).map(|t| t.name.clone()))
        .collect();
    McpTask {
        id: task.id.clone(),
        title: task.title.clone(),
        notes: task.notes.clone(),
        due_date: task.due_date.map(|d| d.to_string()),
        due_time: task.due_time.clone(),
        start_date: task.start_date.map(|d| d.to_string()),
        start_time: task.start_time.clone(),
        tags: tag_names,
        done: task.done(),
        completed_at: task
            .completed_at
            .map(crate::model::iso_secs::to_iso),
        estimated_minutes: task
            .estimated_seconds
            .map(|s| s / 60),
    }
}
