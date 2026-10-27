//! Server lifecycle: shutdown never blocks the caller, slow clients are bounded, and
//! every committed write gets its success response across MCP restarts.

use super::generate_mcp_token;
use super::runtime::{
    McpController, McpDesired, McpListenConfig, McpStatus, McpStatusKind, RouterFactory,
    StatusSink,
};
use super::server::{ServeOptions, WriteGate, mcp_router, serve};
use crate::commands::NewTaskInput;
use crate::store::AppState;
use crate::task_ops::add_task_record;
use rmcp::{
    ErrorData as McpError, ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::CallToolResult,
    tool, tool_handler, tool_router,
};
use serde_json::json;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .unwrap()
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

#[derive(Clone)]
struct PingMcp {
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
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

#[derive(serde::Deserialize, schemars::JsonSchema)]
struct CreateArgs {
    title: String,
}

/// Mirrors the real write tools: gate check, then commit, then respond. The pause
/// after the commit widens the window in which a restart used to drop the response.
#[derive(Clone)]
struct CommitMcp {
    state: Arc<AppState>,
    gate: Arc<WriteGate>,
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl CommitMcp {
    fn new(state: Arc<AppState>, gate: Arc<WriteGate>) -> Self {
        Self {
            state,
            gate,
            tool_router: Self::tool_router(),
        }
    }

    #[tool(description = "create")]
    async fn create(
        &self,
        Parameters(args): Parameters<CreateArgs>,
    ) -> Result<CallToolResult, McpError> {
        if self.gate.is_closed() {
            return Err(McpError::internal_error("stopping", None));
        }
        add_task_record(
            &self.state,
            NewTaskInput {
                title: args.title,
                due_date: None,
                due_time: None,
                start_date: None,
                start_time: None,
                notes: String::new(),
                attachments: vec![],
                tag_ids: vec![],
                estimated_seconds: None,
            },
        )
        .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        tokio::time::sleep(Duration::from_millis(20)).await;
        Ok(CallToolResult::success(vec![]))
    }
}

#[tool_handler]
impl ServerHandler for CommitMcp {}

fn ping_router_factory() -> RouterFactory {
    Arc::new(|token, _gate| mcp_router(|| Ok(PingMcp::new()), token, &ServeOptions::default()))
}

fn noop_sink() -> StatusSink {
    Arc::new(|_: &McpStatus| {})
}

fn wait_for_status(ctl: &McpController, want: McpStatusKind) {
    let start = Instant::now();
    while ctl.status().status != want {
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "status never became {want:?}: {:?}",
            ctl.status()
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Partial request head, then nothing: the slowloris from QA N1.
fn slowloris(port: u16) -> TcpStream {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.write_all(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: appl")
        .unwrap();
    s
}

/// Seconds until the server closes `s` (EOF or reset), or None if still open at `limit`.
fn closed_within(s: &mut TcpStream, limit: Duration) -> Option<Duration> {
    let start = Instant::now();
    s.set_read_timeout(Some(Duration::from_millis(50))).unwrap();
    let mut buf = [0u8; 512];
    while start.elapsed() < limit {
        match s.read(&mut buf) {
            Ok(0) => return Some(start.elapsed()),
            Ok(_) => {}
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => return Some(start.elapsed()),
        }
    }
    None
}

#[test]
fn stop_with_slowloris_client_does_not_block_and_is_bounded() {
    let rt = runtime();
    let opts = ServeOptions::default();
    let (ctl, supervisor) = McpController::new(ping_router_factory(), noop_sink(), opts);
    rt.spawn(supervisor);
    let port = free_port();
    ctl.request(McpDesired::Listen(McpListenConfig {
        port,
        token: generate_mcp_token(),
    }));
    wait_for_status(&ctl, McpStatusKind::Listening);

    let mut slow = slowloris(port);
    std::thread::sleep(Duration::from_millis(100));

    // This thread stands in for the UI thread: the request must return at once.
    let t0 = Instant::now();
    ctl.request(McpDesired::Off);
    assert!(
        t0.elapsed() < Duration::from_millis(50),
        "request(Off) blocked the caller for {:?}",
        t0.elapsed()
    );
    assert_eq!(ctl.status().status, McpStatusKind::Off);

    // The port is released right away even though a request is still open.
    let start = Instant::now();
    while TcpStream::connect(("127.0.0.1", port)).is_ok() {
        assert!(start.elapsed() < Duration::from_secs(1), "listener still open");
        std::thread::sleep(Duration::from_millis(10));
    }

    // The slow connection is force-closed at the shutdown deadline, well before the
    // 10 s header timeout would have closed it.
    let closed = closed_within(&mut slow, opts.shutdown_deadline + Duration::from_secs(1))
        .expect("slowloris connection survived the shutdown deadline");
    assert!(closed < opts.shutdown_deadline + Duration::from_secs(1));
}

#[test]
fn header_read_timeout_closes_slow_clients() {
    let rt = runtime();
    let opts = ServeOptions {
        header_read_timeout: Duration::from_millis(300),
        ..ServeOptions::default()
    };
    let token = generate_mcp_token();
    let server = rt.block_on(async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let router = mcp_router(|| Ok(PingMcp::new()), &token, &opts);
        serve(listener, router, Arc::new(WriteGate::default()), opts).unwrap()
    });
    let mut slow = slowloris(server.local_addr().port());
    let closed = closed_within(&mut slow, Duration::from_secs(3))
        .expect("server kept a connection with incomplete headers open");
    assert!(closed >= Duration::from_millis(200), "closed too early: {closed:?}");
    rt.block_on(async { server.begin_shutdown().await.await.unwrap() });
}

#[test]
fn body_read_timeout_rejects_slow_uploads() {
    let rt = runtime();
    let opts = ServeOptions {
        body_read_timeout: Duration::from_millis(300),
        ..ServeOptions::default()
    };
    let token = generate_mcp_token();
    let server = rt.block_on(async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let router = mcp_router(|| Ok(PingMcp::new()), &token, &opts);
        serve(listener, router, Arc::new(WriteGate::default()), opts).unwrap()
    });
    let mut s = TcpStream::connect(server.local_addr()).unwrap();
    write!(
        s,
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\n\
         Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\n\
         Content-Length: 100\r\n\r\n{{\"jsonrpc\""
    )
    .unwrap();
    s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    let mut buf = vec![0u8; 4096];
    let n = s.read(&mut buf).unwrap();
    let text = String::from_utf8_lossy(&buf[..n]);
    assert!(text.starts_with("HTTP/1.1 408"), "{text}");
    assert!(text.contains("-32600"), "{text}");
    rt.block_on(async { server.begin_shutdown().await.await.unwrap() });
}

#[test]
fn shutdown_without_open_connections_is_not_forced() {
    let rt = runtime();
    let token = generate_mcp_token();
    let opts = ServeOptions::default();
    let report = rt.block_on(async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let router = mcp_router(|| Ok(PingMcp::new()), &token, &opts);
        let server = serve(listener, router, Arc::new(WriteGate::default()), opts).unwrap();
        server.begin_shutdown().await.await.unwrap()
    });
    assert_eq!(report.forced, 0);
}

enum Outcome {
    Ok,
    /// JSON-RPC error with HTTP 200: refused before commit.
    Refused,
    /// Connection refused or closed before a response: nothing reached the handler.
    Unreachable,
    /// Anything else (e.g. HTTP 500) — the B2 failure.
    Broken(String),
}

async fn create(client: &reqwest::Client, port: u16, token: &str, title: &str) -> Outcome {
    let res = client
        .post(format!("http://127.0.0.1:{port}/mcp"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json, text/event-stream")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": "create", "arguments": { "title": title } }
        }))
        .send()
        .await;
    let res = match res {
        Ok(r) => r,
        Err(_) => return Outcome::Unreachable,
    };
    let status = res.status();
    let body = match res.text().await {
        Ok(b) => b,
        Err(_) => return Outcome::Unreachable,
    };
    if status != 200 {
        return Outcome::Broken(format!("{status} {body}"));
    }
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return Outcome::Broken(body),
    };
    if v.get("result").is_some_and(|r| r.get("isError") != Some(&json!(true))) {
        Outcome::Ok
    } else if v.get("error").is_some() {
        Outcome::Refused
    } else {
        Outcome::Broken(body)
    }
}

#[test]
fn committed_writes_get_their_response_across_restarts() {
    let rt = runtime();
    let dir = tempfile::tempdir().unwrap();
    let state = Arc::new(AppState::open(dir.path().join("t.db")).unwrap());
    let for_router = state.clone();
    let make_router: RouterFactory = Arc::new(move |token, gate| {
        let state = for_router.clone();
        mcp_router(
            move || Ok(CommitMcp::new(state.clone(), gate.clone())),
            token,
            &ServeOptions::default(),
        )
    });
    let (ctl, supervisor) =
        McpController::new(make_router, noop_sink(), ServeOptions::default());
    rt.spawn(supervisor);
    let port = free_port();
    let token = generate_mcp_token();
    let listen = McpDesired::Listen(McpListenConfig {
        port,
        token: token.clone(),
    });
    ctl.request(listen.clone());
    wait_for_status(&ctl, McpStatusKind::Listening);

    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mut workers = Vec::new();
    for w in 0..8 {
        let token = token.clone();
        let stop = stop.clone();
        workers.push(rt.spawn(async move {
            let client = reqwest::Client::builder()
                .pool_max_idle_per_host(0)
                .build()
                .unwrap();
            let mut ok = Vec::new();
            let mut broken = Vec::new();
            let mut i = 0;
            while !stop.load(std::sync::atomic::Ordering::SeqCst) {
                let title = format!("w{w}-{i}");
                i += 1;
                match create(&client, port, &token, &title).await {
                    Outcome::Ok => ok.push(title),
                    Outcome::Refused => {}
                    Outcome::Unreachable => tokio::time::sleep(Duration::from_millis(5)).await,
                    Outcome::Broken(b) => broken.push(format!("{title}: {b}")),
                }
            }
            (ok, broken)
        }));
    }

    for _ in 0..6 {
        std::thread::sleep(Duration::from_millis(150));
        ctl.request(McpDesired::Off);
        std::thread::sleep(Duration::from_millis(40));
        ctl.request(listen.clone());
    }
    std::thread::sleep(Duration::from_millis(150));
    stop.store(true, std::sync::atomic::Ordering::SeqCst);

    let mut ok = HashSet::new();
    let mut broken = Vec::new();
    for w in workers {
        let (o, b) = rt.block_on(w).unwrap();
        ok.extend(o);
        broken.extend(b);
    }
    ctl.request(McpDesired::Off);

    assert!(broken.is_empty(), "non-JSON-RPC responses: {broken:?}");
    assert!(!ok.is_empty(), "no write succeeded");
    let committed: HashSet<String> =
        state.read(|doc| doc.tasks.iter().map(|t| t.title.clone()).collect());
    let committed_without_ok: Vec<_> = committed.difference(&ok).collect();
    assert!(
        committed_without_ok.is_empty(),
        "committed writes that got no success response: {committed_without_ok:?}"
    );
    assert_eq!(committed.len(), ok.len());
}
