use crate::commands::{NewTaskInput, UpdateTaskInput};
use crate::config::ConfigState;
use crate::error::AppError;
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
use tauri::{AppHandle, Manager};

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
    pub limit: Option<u32>,
    /// Skip this many rows before applying `limit`.
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
    pub title: Option<String>,
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
    pub tags: Option<Vec<String>>,
    #[serde(default, deserialize_with = "double_option")]
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

#[tool_router]
impl PansuthongMcp {
    #[tool(
        description = "List tasks with optional view and filters. view=all returns active (non-archived) tasks and excludes completed/archived ones; use view=completed for finished tasks. Returns at most 500 tasks per call (set limit 1..500); truncated is true when more matches exist."
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
        let task = add_task_record(state.inner(), input).map_err(mcp_err)?;
        self.notify_document_changed();
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
        let input = UpdateTaskInput {
            id: args.id,
            title: args.title,
            due_date: args.due_date,
            due_time: args.due_time,
            start_date: args.start_date,
            start_time: args.start_time,
            notes: args.notes,
            attachments: None,
            tag_ids,
            estimated_seconds,
        };
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

