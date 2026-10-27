//! HTTP integration: MCP initialize + tools/list + create/list over Streamable HTTP.

use super::generate_mcp_token;
use super::jsonrpc_http::MCP_MAX_REQUEST_BODY_BYTES;
use super::server::{RunningServer, ServeOptions, WriteGate, mcp_router, serve};
use crate::commands::NewTaskInput;
use crate::config::Settings;
use crate::store::AppState;
use crate::task_ops::add_task_record;
use crate::task_query::{ListTasksQuery, list_tasks as query_list_tasks};
use serde_json::json;
use std::sync::Arc;

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
fn mcp_http_large_tools_call_bodies() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        mcp_http_large_tools_call_bodies_async().await;
    });
}

async fn mcp_http_large_tools_call_bodies_async() {
    let token = generate_mcp_token();
    let (url, server) = spawn_ping_mcp_router(&token).await;
    let client = reqwest::Client::new();
    let accept = "application/json, text/event-stream";
    let auth = format!("Bearer {token}");

    // ~2 MiB payload must pass the shape gate and reach rmcp (under the 4 MiB server limit).
    let pad_len = 2 * 1024 * 1024;
    let pad = "x".repeat(pad_len);
    let large_ok = json!({
        "jsonrpc": "2.0",
        "id": 20,
        "method": "tools/call",
        "params": {
            "name": "ping",
            "arguments": { "pad": pad }
        }
    });
    let ok_res = client
        .post(&url)
        .header("Authorization", &auth)
        .header("Accept", accept)
        .json(&large_ok)
        .send()
        .await
        .unwrap();
    let ok_status = ok_res.status();
    let ok_body = ok_res.text().await.unwrap();
    assert!(
        ok_status.is_success(),
        "2 MiB tools/call should succeed, got {ok_status} {ok_body}"
    );

    // 5 MiB exceeds MCP_MAX_REQUEST_BODY_BYTES → 413 / -32600 at the gate.
    let oversize = 5 * 1024 * 1024;
    let mut huge_body = Vec::with_capacity(oversize + 256);
    huge_body.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":21,\"method\":\"tools/call\",\"params\":{\"name\":\"ping\",\"arguments\":{\"pad\":\"");
    huge_body.extend(std::iter::repeat_n(b'z', oversize));
    huge_body.extend_from_slice(b"\"}}}");
    assert!(
        huge_body.len() > MCP_MAX_REQUEST_BODY_BYTES,
        "test body must exceed server limit"
    );
    let too_large = client
        .post(&url)
        .header("Authorization", &auth)
        .header("Accept", accept)
        .header("Content-Type", "application/json")
        .body(huge_body)
        .send()
        .await
        .unwrap();
    assert_eq!(too_large.status(), 413);
    let text = too_large.text().await.unwrap();
    assert!(text.contains("-32600"), "413 must be JSON-RPC invalid request: {text}");
    assert!(text.contains("\"id\":null"), "413 body must include id null: {text}");

    server.begin_shutdown().await.await.unwrap();
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
    let (url, server) = spawn_ping_mcp_router(&token).await;
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
        assert_eq!(res.status(), 200, "known-id gate errors are in-band for {body}");
        let text = res.text().await.unwrap();
        assert!(
            text.contains("-32602"),
            "expected invalid params for {body}, got: {text}"
        );
        assert!(
            text.contains("\"id\":9"),
            "gate errors must echo the request id, got: {text}"
        );
    }

    // Bad list_tasks limit/offset values are rejected at the gate with the id echoed.
    // (The ping router has no list_tasks tool; the gate runs before dispatch.)
    let bad_args = [
        json!({"limit": 0}),
        json!({"limit": -1}),
        json!({"limit": 501}),
        json!({"limit": 1.5}),
        json!({"limit": "5"}),
        json!({"limit": null}),
        json!({"limit": true}),
        json!({"limit": 4294967296u64}),
        json!({"limit": 1e20}),
        json!({"offset": -1}),
        json!({"offset": "5"}),
        json!({"offset": 1.5}),
        json!({"offset": null}),
        json!({"offset": 4294967296u64}),
        json!({"offset": 1e20}),
    ];
    for args in bad_args {
        let body = json!({
            "jsonrpc": "2.0",
            "id": 18,
            "method": "tools/call",
            "params": { "name": "list_tasks", "arguments": args }
        });
        let res = client
            .post(&url)
            .header("Authorization", &auth)
            .header("Accept", accept)
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200, "{body}");
        let v: serde_json::Value = res.json().await.unwrap();
        assert_eq!(v["id"], 18, "{v}");
        assert_eq!(v["error"]["code"], -32602, "{v}");
    }

    // Batches and wrong `jsonrpc` versions are Invalid Request (-32600), not parse errors.
    let batch = client
        .post(&url)
        .header("Authorization", &auth)
        .header("Accept", accept)
        .json(&json!([{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}]))
        .send()
        .await
        .unwrap();
    assert_eq!(batch.status(), 400);
    let v: serde_json::Value = batch.json().await.unwrap();
    assert_eq!(v["error"]["code"], -32600, "{v}");
    assert_eq!(v["id"], serde_json::Value::Null, "{v}");

    let wrong_version = client
        .post(&url)
        .header("Authorization", &auth)
        .header("Accept", accept)
        .json(&json!({"jsonrpc": "1.0", "id": "abc", "method": "tools/list"}))
        .send()
        .await
        .unwrap();
    assert_eq!(wrong_version.status(), 200);
    let v: serde_json::Value = wrong_version.json().await.unwrap();
    assert_eq!(v["error"]["code"], -32600, "{v}");
    assert_eq!(v["id"], "abc", "{v}");

    // Content-Type must be exactly application/json (parameters allowed).
    for (ct_header, ok) in [
        ("application/jsonx", false),
        ("application/json; charset=utf-8", true),
    ] {
        let res = client
            .post(&url)
            .header("Authorization", &auth)
            .header("Accept", accept)
            .header("Content-Type", ct_header)
            .body(r#"{"jsonrpc":"2.0","id":5,"method":"tools/list","params":{}}"#)
            .send()
            .await
            .unwrap();
        if ok {
            assert!(res.status().is_success(), "{ct_header}: {}", res.status());
        } else {
            assert_eq!(res.status(), 415, "{ct_header}");
            let v: serde_json::Value = res.json().await.unwrap();
            assert_eq!(v["error"]["code"], -32600, "{v}");
            assert_eq!(v["id"], serde_json::Value::Null, "{v}");
        }
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

    server.begin_shutdown().await.await.unwrap();
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
) -> (String, RunningServer) {
    use rmcp::{ErrorData as McpError, ServerHandler, model::CallToolResult, tool, tool_handler, tool_router};

    #[derive(Clone)]
    struct PingMcp {
        #[allow(dead_code)]
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

    // The production router and accept loop, so these tests cover the real gates.
    let opts = ServeOptions::default();
    let router = mcp_router(|| Ok(PingMcp::new()), token, &opts);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server = serve(listener, router, Arc::new(WriteGate::default()), opts).unwrap();
    (format!("http://{}/mcp", server.local_addr()), server)
}

async fn mcp_http_initialize_tools_list_and_auth_async() {
    let token = generate_mcp_token();
    let (url, server) = spawn_ping_mcp_router(&token).await;

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

    server.begin_shutdown().await.await.unwrap();
}
