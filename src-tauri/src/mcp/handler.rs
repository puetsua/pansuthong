use crate::commands::{NewTaskInput, UpdateTaskInput};
use crate::config::ConfigState;
use crate::error::AppError;
use crate::mcp::json::{McpTask, task_to_mcp};
use crate::store::AppState;
use crate::task_ops::{
    add_task_record, delete_task_record, estimated_seconds_from_minutes, resolve_tag_names,
    set_task_done_record, update_task_record,
};
use crate::task_query::{
    ListTasksQuery, get_task as query_get_task, list_tags as query_list_tags,
    list_tasks as query_list_tasks,
};
use chrono::NaiveDate;
use rmcp::{
    ErrorData as McpError, Json, ServerHandler,
    handler::server::{
        router::tool::ToolRouter,
        wrapper::Parameters,
    },
    model::{CallToolResult, ContentBlock},
    tool, tool_handler, tool_router,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};

const STORE_CHANGED: &str = "store-changed";

fn mcp_err(e: AppError) -> McpError {
    McpError::invalid_params(e.to_string(), None)
}

#[derive(Clone)]
pub struct PansuthongMcp {
    app: AppHandle,
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl PansuthongMcp {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            tool_router: Self::tool_router(),
        }
    }

    fn state(&self) -> tauri::State<'_, AppState> {
        self.app.state::<AppState>()
    }

    fn settings(&self) -> crate::config::Settings {
        self.app.state::<ConfigState>().settings()
    }

    fn emit_changed(&self) {
        let _ = self.app.emit(STORE_CHANGED, ());
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
    /// Maximum rows to return (default 50).
    pub limit: Option<u32>,
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
    pub title: Option<String>,
    pub notes: Option<Option<String>>,
    pub due_date: Option<Option<NaiveDate>>,
    pub due_time: Option<Option<String>>,
    pub start_date: Option<Option<NaiveDate>>,
    pub start_time: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
    pub estimated_minutes: Option<Option<i64>>,
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

#[derive(Debug, Serialize, JsonSchema)]
struct McpTagRef {
    id: String,
    name: String,
    color: String,
    priority: i64,
}

#[tool_router]
impl PansuthongMcp {
    #[tool(description = "List tasks with optional view and filters.")]
    async fn list_tasks(
        &self,
        Parameters(args): Parameters<ListTasksArgs>,
    ) -> Result<Json<Vec<McpTask>>, McpError> {
        let state = self.state();
        let settings = self.settings();
        let tasks = query_list_tasks(
            state.inner(),
            &settings,
            ListTasksQuery {
                view: args.view,
                tag: args.tag,
                due_before: args.due_before,
                due_after: args.due_after,
                query: args.query,
                limit: args.limit,
            },
        );
        let tags = query_list_tags(state.inner());
        let tags_by_id: HashMap<&str, &crate::model::Tag> = tags
            .iter()
            .map(|t| (t.id.as_str(), t))
            .collect();
        let out = tasks
            .iter()
            .map(|t| task_to_mcp(t, &tags_by_id))
            .collect();
        Ok(Json(out))
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
    async fn list_tags(&self) -> Result<Json<Vec<McpTagRef>>, McpError> {
        let state = self.state();
        let out = query_list_tags(state.inner())
            .into_iter()
            .map(|t| McpTagRef {
                id: t.id,
                name: t.name,
                color: t.color,
                priority: t.priority,
            })
            .collect();
        Ok(Json(out))
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
        let task = add_task_record(state.inner(), input).map_err(mcp_err)?;
        self.emit_changed();
        let tags = query_list_tags(state.inner());
        let tags_by_id: HashMap<&str, &crate::model::Tag> = tags
            .iter()
            .map(|t| (t.id.as_str(), t))
            .collect();
        Ok(Json(task_to_mcp(&task, &tags_by_id)))
    }

    #[tool(description = "Update a task. Pass null to clear an optional field.")]
    async fn update_task(
        &self,
        Parameters(args): Parameters<UpdateTaskArgs>,
    ) -> Result<Json<McpTask>, McpError> {
        let state = self.state();
        let tag_ids = if let Some(names) = args.tags {
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
        let notes = args.notes.map(|n| n.unwrap_or_default());
        let input = UpdateTaskInput {
            id: args.id,
            title: args.title,
            due_date: args.due_date,
            due_time: args.due_time,
            start_date: args.start_date,
            start_time: args.start_time,
            notes,
            attachments: None,
            tag_ids,
            estimated_seconds,
        };
        let task = update_task_record(state.inner(), input).map_err(mcp_err)?;
        self.emit_changed();
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
        let task = set_task_done_record(state.inner(), &args.id, args.done).map_err(mcp_err)?;
        self.emit_changed();
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
    ) -> Result<CallToolResult, McpError> {
        let state = self.state();
        let orphaned = delete_task_record(state.inner(), &args.id).map_err(mcp_err)?;
        crate::commands::gc_attachment_files(state.inner(), &orphaned);
        self.emit_changed();
        Ok(CallToolResult::success(vec![ContentBlock::text("ok")]))
    }
}

#[tool_handler]
impl ServerHandler for PansuthongMcp {}
