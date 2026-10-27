//! HTTP integration: MCP initialize + tools/list + create/list over Streamable HTTP.

use super::auth::{ExpectedToken, bearer_auth, origin_gate};
use super::jsonrpc_http::{
    json_content_type_gate, rewrite_jsonrpc_http_errors, tools_call_shape_gate,
};
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
    assert_eq!(found.tasks.len(), 1);
    assert_eq!(found.tasks[0].title, "from mcp test");
}

#[test]
fn mcp_http_tools_call_invalid_params_and_transport_gates() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        mcp_http_tools_call_invalid_params_and_transport_gates_async().await;
    });
}

async fn mcp_http_tools_call_invalid_params_and_transport_gates_async() {
    let token = generate_mcp_token();
    let (url, ct, server) = spawn_ping_mcp_router(&token).await;
    let client = reqwest::Client::new();
    let accept = "application/json, text/event-stream";
    let auth = format!("Bearer {token}");

    let malformed = [
        json!({"jsonrpc": "2.0", "id": 9, "method": "tools/call"}),
        json!({"jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": null}),
        json!({"jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": {}}),
        json!({
            "jsonrpc": "2.0",
            "id": 9,
            "method": "tools/call",
            "params": { "name": "ping", "arguments": "x" }
        }),
    ];
    for body in malformed {
        let res = client
            .post(&url)
            .header("Authorization", &auth)
            .header("Accept", accept)
            .json(&body)
            .send()
            .await
            .unwrap();
        let text = res.text().await.unwrap();
        assert!(
            text.contains("-32602"),
            "expected invalid params for {body}, got: {text}"
        );
        assert!(
            text.contains("\"id\":null"),
            "gate errors must include id null, got: {text}"
        );
    }

    let not_acceptable = client
        .post(&url)
        .header("Authorization", &auth)
        .header("Content-Type", "application/json")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 10,
            "method": "tools/list",
            "params": {}
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(not_acceptable.status(), 406);
    let body406 = not_acceptable.text().await.unwrap();
    assert!(body406.contains("-32600"), "406 must map to invalid request: {body406}");
    assert!(body406.contains("\"id\":null"), "406 body must include id null: {body406}");

    ct.cancel();
    server.abort();
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

async fn spawn_ping_mcp_router(
    token: &str,
) -> (String, CancellationToken, tokio::task::JoinHandle<()>) {
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
        .layer(middleware::from_fn(rewrite_jsonrpc_http_errors))
        .layer(middleware::from_fn(tools_call_shape_gate))
        .layer(middleware::from_fn(json_content_type_gate))
        .layer(middleware::from_fn_with_state(
            ExpectedToken::new(token),
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
    (format!("http://{}/mcp", addr), ct, server)
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
    let _host = TestMcpHost::new(harness.clone());

    let (url, ct, server) = spawn_ping_mcp_router(&token).await;

    let client = reqwest::Client::new();
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
    assert!(
        init_body.contains("\"tools\""),
        "initialize must advertise tools capability: {init_body}"
    );

    let bad_json = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("Accept", accept)
        .body("not-json")
        .send()
        .await
        .unwrap();
    let bad_body = bad_json.text().await.unwrap();
    assert!(
        bad_body.contains("jsonrpc") && bad_body.contains("-32700"),
        "malformed JSON should return JSON-RPC parse error, got: {bad_body}"
    );
    assert!(
        bad_body.contains("\"id\":null"),
        "parse error body must include id null, got: {bad_body}"
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
