use crate::commands::{NewTaskInput, UpdateTaskInput};
use crate::config::ConfigState;
use crate::error::AppError;
use crate::mcp::server::WriteGate;
use crate::mcp::json::{
    DeleteTaskOutput, ListTagsOutput, ListTasksOutput, McpTask, tag_to_mcp_ref, task_to_mcp,
};
use crate::store::AppState;
use crate::store_notify;
use crate::task_ops::{
    add_task_record, delete_task_record, estimated_seconds_from_minutes, resolve_tag_names,
    set_task_done_record, update_task_record,
};
use crate::task_query::{
    ListTasksQuery, get_task as query_get_task, list_tags as query_list_tags,
    list_tasks as query_list_tasks,
};
use crate::commands::double_option;
use chrono::NaiveDate;
use rmcp::{
    ErrorData as McpError, Json, ServerHandler,
    handler::server::{
        router::tool::ToolRouter,
        wrapper::Parameters,
    },
    model::{Implementation, ServerCapabilities, ServerConfig},
    tool, tool_handler, tool_router,
};
use schemars::JsonSchema;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

fn mcp_err(e: AppError) -> McpError {
    McpError::invalid_params(e.to_string(), None)
}

#[derive(Clone)]
pub struct PansuthongMcp {
    app: AppHandle,
    gate: Arc<WriteGate>,
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl PansuthongMcp {
    pub fn new(app: AppHandle, gate: Arc<WriteGate>) -> Self {
        Self {
            app,
            gate,
            tool_router: Self::tool_router(),
        }
    }

    fn state(&self) -> tauri::State<'_, AppState> {
        self.app.state::<AppState>()
    }

    fn settings(&self) -> crate::config::Settings {
        self.app.state::<ConfigState>().settings()
    }

    /// Call immediately before a store write. Once the server starts stopping, writes
    /// are refused before they commit instead of risking a commit whose response is lost.
    fn ensure_writable(&self) -> Result<(), McpError> {
        if self.gate.is_closed() {
            return Err(McpError::internal_error(
                "MCP server is stopping; nothing was written. Retry once it is listening again.",
                None,
            ));
        }
        Ok(())
    }

    /// Same notification path as Tauri commands after a document mutation.
    fn notify_document_changed(&self) {
        store_notify::emit_store_changed(&self.app);
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListTasksArgs {
    /// View filter: today, inbox, upcoming, completed, or all.
    pub view: Option<String>,
    /// Filter to tasks carrying this tag name (case-insensitive).
    pub tag: Option<String>,
    pub due_before: Option<NaiveDate>,
    pub due_after: Option<NaiveDate>,
    /// Case-insensitive substring match in title or notes.
    pub query: Option<String>,
    /// Maximum rows to return (1..=500). Omit to use the server default cap (500).
    #[serde(default)]
    #[schemars(with = "u32", range(min = 1, max = 500))]
    pub limit: Option<u32>,
    /// Skip this many rows before applying `limit`.
    #[serde(default)]
    #[schemars(with = "u32", range(min = 0))]
    pub offset: Option<u32>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetTaskArgs {
    pub id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateTaskArgs {
    pub title: String,
    pub notes: Option<String>,
    pub due_date: Option<NaiveDate>,
    pub due_time: Option<String>,
    pub start_date: Option<NaiveDate>,
    pub start_time: Option<String>,
    pub tags: Option<Vec<String>>,
    pub estimated_minutes: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateTaskArgs {
    pub id: String,
    /// New title. Omit to leave unchanged; null is rejected (a task always has a title).
    #[serde(default, deserialize_with = "double_option")]
    #[schemars(with = "String")]
    pub title: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub notes: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_time: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub start_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")]
    pub start_time: Option<Option<String>>,
    /// Replace the tag set with these tag names. Omit to leave unchanged; null clears all tags.
    #[serde(default, deserialize_with = "double_option")]
    pub tags: Option<Option<Vec<String>>>,
    #[serde(default, deserialize_with = "double_option")]
    pub estimated_minutes: Option<Option<i64>>,
}

/// `title: null` is invalid (-32602); absent leaves the title unchanged.
fn update_title_arg(title: Option<Option<String>>) -> Result<Option<String>, McpError> {
    match title {
        None => Ok(None),
        Some(None) => Err(McpError::invalid_params("title cannot be null", None)),
        Some(Some(t)) => Ok(Some(t)),
    }
}

/// `tags: null` clears all tags (empty list); absent leaves tags unchanged.
fn update_tag_names_arg(tags: Option<Option<Vec<String>>>) -> Option<Vec<String>> {
    tags.map(Option::unwrap_or_default)
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CompleteTaskArgs {
    pub id: String,
    #[serde(default = "default_true")]
    pub done: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeleteTaskArgs {
    pub id: String,
}

#[tool_router]
impl PansuthongMcp {
    #[tool(
        description = "List tasks with optional view and filters. view=all returns active (non-archived) tasks and excludes completed/archived ones; use view=completed for finished tasks. Returns at most 500 tasks per call (set limit 1..=500; larger values are rejected); truncated is true when more matches exist."
    )]
    async fn list_tasks(
        &self,
        Parameters(args): Parameters<ListTasksArgs>,
    ) -> Result<Json<ListTasksOutput>, McpError> {
        if args.limit == Some(0) {
            return Err(McpError::invalid_params(
                "limit must be at least 1",
                None,
            ));
        }
        let state = self.state();
        let settings = self.settings();
        let listed = query_list_tasks(
            state.inner(),
            &settings,
            ListTasksQuery {
                view: args.view,
                tag: args.tag,
                due_before: args.due_before,
                due_after: args.due_after,
                query: args.query,
                limit: args.limit,
                offset: args.offset,
            },
        )
        .map_err(mcp_err)?;
        let tags = query_list_tags(state.inner());
        let tags_by_id: HashMap<&str, &crate::model::Tag> = tags
            .iter()
            .map(|t| (t.id.as_str(), t))
            .collect();
        let out = listed
            .tasks
            .iter()
            .map(|t| task_to_mcp(t, &tags_by_id))
            .collect();
        Ok(Json(ListTasksOutput {
            tasks: out,
            truncated: listed.truncated,
        }))
    }

    #[tool(description = "Fetch one task by id.")]
    async fn get_task(
        &self,
        Parameters(args): Parameters<GetTaskArgs>,
    ) -> Result<Json<McpTask>, McpError> {
        let state = self.state();
        let task = query_get_task(state.inner(), &args.id).ok_or_else(|| {
            McpError::invalid_params(format!("task not found: {}", args.id), None)
        })?;
        let tags = query_list_tags(state.inner());
        let tags_by_id: HashMap<&str, &crate::model::Tag> = tags
            .iter()
            .map(|t| (t.id.as_str(), t))
            .collect();
        Ok(Json(task_to_mcp(&task, &tags_by_id)))
    }

    #[tool(description = "List all tags (id and name).")]
    async fn list_tags(&self) -> Result<Json<ListTagsOutput>, McpError> {
        let state = self.state();
        let out = query_list_tags(state.inner())
            .into_iter()
            .map(|t| tag_to_mcp_ref(&t))
            .collect();
        Ok(Json(ListTagsOutput { tags: out }))
    }

    #[tool(description = "Create a task. Tag names must already exist.")]
    async fn create_task(
        &self,
        Parameters(args): Parameters<CreateTaskArgs>,
    ) -> Result<Json<McpTask>, McpError> {
        let state = self.state();
        let tag_ids = if let Some(names) = args.tags {
            let tags = query_list_tags(state.inner());
            resolve_tag_names(&names, &tags).map_err(mcp_err)?
        } else {
            vec![]
        };
        let estimated_seconds = estimated_seconds_from_minutes(args.estimated_minutes).map_err(mcp_err)?;
        let input = NewTaskInput {
            title: args.title,
            due_date: args.due_date,
            due_time: args.due_time,
            start_date: args.start_date,
            start_time: args.start_time,
            notes: args.notes.unwrap_or_default(),
            attachments: vec![],
            tag_ids,
            estimated_seconds,
        };
        self.ensure_writable()?;
        let task = add_task_record(state.inner(), input).map_err(mcp_err)?;
        self.notify_document_changed();
        let tags = query_list_tags(state.inner());
        let tags_by_id: HashMap<&str, &crate::model::Tag> = tags
            .iter()
            .map(|t| (t.id.as_str(), t))
            .collect();
        Ok(Json(task_to_mcp(&task, &tags_by_id)))
    }

    #[tool(
        description = "Update a task. Pass null to clear an optional field; tags: null clears all tags. title cannot be null."
    )]
    async fn update_task(
        &self,
        Parameters(args): Parameters<UpdateTaskArgs>,
    ) -> Result<Json<McpTask>, McpError> {
        let title = update_title_arg(args.title)?;
        let state = self.state();
        let tag_ids = if let Some(names) = update_tag_names_arg(args.tags) {
            let tags = query_list_tags(state.inner());
            Some(resolve_tag_names(&names, &tags).map_err(mcp_err)?)
        } else {
            None
        };
        let estimated_seconds: Option<Option<i64>> = match args.estimated_minutes {
            None => None,
            Some(None) => Some(None),
            Some(Some(m)) => Some(Some(
                estimated_seconds_from_minutes(Some(m)).map_err(mcp_err)?.unwrap_or(0),
            )),
        };
        let input = UpdateTaskInput {
            id: args.id,
            title,
            due_date: args.due_date,
            due_time: args.due_time,
            start_date: args.start_date,
            start_time: args.start_time,
            notes: args.notes,
            attachments: None,
            tag_ids,
            estimated_seconds,
        };
        self.ensure_writable()?;
        let task = update_task_record(state.inner(), input).map_err(mcp_err)?;
        self.notify_document_changed();
        let tags = query_list_tags(state.inner());
        let tags_by_id: HashMap<&str, &crate::model::Tag> = tags
            .iter()
            .map(|t| (t.id.as_str(), t))
            .collect();
        Ok(Json(task_to_mcp(&task, &tags_by_id)))
    }

    #[tool(description = "Mark a task done or reopen it (done=false).")]
    async fn complete_task(
        &self,
        Parameters(args): Parameters<CompleteTaskArgs>,
    ) -> Result<Json<McpTask>, McpError> {
        let state = self.state();
        self.ensure_writable()?;
        let task = set_task_done_record(state.inner(), &args.id, args.done).map_err(mcp_err)?;
        self.notify_document_changed();
        let tags = query_list_tags(state.inner());
        let tags_by_id: HashMap<&str, &crate::model::Tag> = tags
            .iter()
            .map(|t| (t.id.as_str(), t))
            .collect();
        Ok(Json(task_to_mcp(&task, &tags_by_id)))
    }

    #[tool(description = "Delete a task permanently.")]
    async fn delete_task(
        &self,
        Parameters(args): Parameters<DeleteTaskArgs>,
    ) -> Result<Json<DeleteTaskOutput>, McpError> {
        let id = args.id;
        let state = self.state();
        self.ensure_writable()?;
        let orphaned = delete_task_record(state.inner(), &id).map_err(mcp_err)?;
        crate::commands::gc_attachment_files(state.inner(), &orphaned);
        self.notify_document_changed();
        Ok(Json(DeleteTaskOutput {
            deleted: true,
            id,
        }))
    }
}

#[tool_handler]
impl ServerHandler for PansuthongMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "pansuthong",
                env!("CARGO_PKG_VERSION"),
            ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn list_tasks_schema() -> Value {
        serde_json::to_value(schemars::schema_for!(ListTasksArgs)).unwrap()
    }

    fn update_args(json: Value) -> UpdateTaskArgs {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn update_task_title_null_is_invalid_params() {
        let absent = update_args(serde_json::json!({"id": "t"}));
        assert_eq!(update_title_arg(absent.title).unwrap(), None);
        let set = update_args(serde_json::json!({"id": "t", "title": "x"}));
        assert_eq!(update_title_arg(set.title).unwrap(), Some("x".into()));
        let null = update_args(serde_json::json!({"id": "t", "title": null}));
        let err = update_title_arg(null.title).unwrap_err();
        assert_eq!(err.code, McpError::invalid_params("", None).code);
    }

    #[test]
    fn update_task_tags_null_clears_all_tags() {
        let absent = update_args(serde_json::json!({"id": "t"}));
        assert_eq!(update_tag_names_arg(absent.tags), None);
        let null = update_args(serde_json::json!({"id": "t", "tags": null}));
        assert_eq!(update_tag_names_arg(null.tags), Some(vec![]));
        let set = update_args(serde_json::json!({"id": "t", "tags": ["a"]}));
        assert_eq!(update_tag_names_arg(set.tags), Some(vec!["a".to_string()]));
    }

    #[test]
    fn update_task_schema_keeps_title_non_nullable() {
        let schema = serde_json::to_value(schemars::schema_for!(UpdateTaskArgs)).unwrap();
        assert_eq!(schema["properties"]["title"]["type"], "string", "{schema}");
        let required = schema["required"].as_array().unwrap();
        assert!(!required.iter().any(|v| v == "title"), "{required:?}");
    }

    #[test]
    fn list_tasks_schema_advertises_limit_and_offset_bounds() {
        let schema = list_tasks_schema();
        let props = &schema["properties"];
        assert_eq!(props["limit"]["type"], "integer", "{props}");
        assert_eq!(props["limit"]["minimum"], 1);
        assert_eq!(props["limit"]["maximum"], 500);
        assert_eq!(props["offset"]["type"], "integer", "{props}");
        assert_eq!(props["offset"]["minimum"], 0);
        let required = schema.get("required").and_then(Value::as_array);
        for f in ["limit", "offset"] {
            assert!(
                !required.is_some_and(|r| r.iter().any(|v| v == f)),
                "{f} must be optional"
            );
        }
    }
}

