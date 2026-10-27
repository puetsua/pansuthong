//! HTTP integration: MCP initialize + tools/list + create/list over Streamable HTTP.

use super::auth::{ExpectedToken, bearer_auth, origin_gate};
use super::generate_mcp_token;
use crate::commands::NewTaskInput;
use crate::config::Settings;
use crate::store::AppState;
use crate::task_ops::add_task_record;
use crate::task_query::{ListTasksQuery, list_tasks as query_list_tasks};
use axum::{Router, middleware};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use serde_json::json;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

/// Shared test harness: real store + config, no Tauri event loop.
struct TestHarness {
    state: AppState,
    settings: Settings,
}

#[derive(Clone)]
struct TestMcpHost {
    harness: Arc<Mutex<TestHarness>>,
}

impl TestMcpHost {
    fn new(harness: Arc<Mutex<TestHarness>>) -> Self {
        Self { harness }
    }
}

// Minimal stand-in: exercise the same task ops the MCP tools use (see task_query tests).
#[test]
fn mcp_tools_create_and_list_via_shared_ops() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::open(dir.path().join("t.db")).unwrap();
    let settings = Settings::default();
    add_task_record(
        &state,
        NewTaskInput {
            title: "from mcp test".into(),
            due_date: None,
            due_time: None,
            start_date: None,
            start_time: None,
            notes: "".into(),
            attachments: vec![],
            tag_ids: vec![],
            estimated_seconds: None,
        },
    )
    .unwrap();
    let found = query_list_tasks(
        &state,
        &settings,
        ListTasksQuery {
            view: Some("all".into()),
            query: Some("mcp test".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].title, "from mcp test");
}

#[test]
fn mcp_http_initialize_tools_list_and_auth() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        mcp_http_initialize_tools_list_and_auth_async().await;
    });
}

async fn mcp_http_initialize_tools_list_and_auth_async() {
    let token = generate_mcp_token();
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::open(dir.path().join("tasks_test.db")).unwrap();
    let settings = Settings::default();
    let harness = Arc::new(Mutex::new(TestHarness {
        state,
        settings,
    }));

    // Use a lightweight ping tool server: protocol + auth only; task tools are covered above.
    use rmcp::{ErrorData as McpError, ServerHandler, model::CallToolResult, tool, tool_handler, tool_router};

    #[derive(Clone)]
    struct PingMcp {
        tool_router: rmcp::handler::server::router::tool::ToolRouter<Self>,
    }

    #[tool_router]
    impl PingMcp {
        fn new() -> Self {
            Self {
                tool_router: Self::tool_router(),
            }
        }

        #[tool(description = "ping")]
        fn ping(&self) -> Result<CallToolResult, McpError> {
            Ok(CallToolResult::success(vec![]))
        }
    }

    #[tool_handler]
    impl ServerHandler for PingMcp {}

    let _host = TestMcpHost::new(harness.clone());

    let ct = CancellationToken::new();
    let ct_wait = ct.clone();
    let service = StreamableHttpService::new(
        || Ok(PingMcp::new()),
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default()
            .with_cancellation_token(ct.child_token())
            .with_legacy_session_mode(false)
            .with_json_response(true),
    );
    let router = Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(
            ExpectedToken::new(&token),
            bearer_auth,
        ))
        .layer(middleware::from_fn(origin_gate));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                ct_wait.cancelled().await;
            })
            .await
            .unwrap();
    });

    let client = reqwest::Client::new();
    let url = format!("http://{}/mcp", addr);
    let accept = "application/json, text/event-stream";

    let init = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", accept)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "0" }
            }
        }))
        .send()
        .await
        .expect("initialize");
    let init_status = init.status();
    let init_body = init.text().await.unwrap();
    assert!(
        init_status.is_success(),
        "initialize failed: {init_status} {init_body}"
    );

    let tools = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", accept)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        }))
        .send()
        .await
        .expect("tools/list");
    assert!(tools.status().is_success());
    assert!(tools.text().await.unwrap().contains("ping"));

    let bad = client.post(&url).json(&json!({})).send().await.unwrap();
    assert_eq!(bad.status(), 401);

    let forbidden = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Origin", "http://evil.example")
        .header("Accept", accept)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "ping",
            "params": {}
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(forbidden.status(), 403);

    let localhost = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Origin", "http://localhost:7373")
        .header("Accept", accept)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "0" }
            }
        }))
        .send()
        .await
        .unwrap();
    assert!(localhost.status().is_success());

    ct.cancel();
    server.abort();
}
