//! HTTP/1.1 accept loop for the MCP endpoint with bounded timeouts.
//!
//! `axum::serve` exposes no header-read timeout, and its graceful shutdown waits for
//! every open connection indefinitely, so a client stuck mid-request (or a slowloris)
//! could hold shutdown forever. This loop serves each connection with hyper directly:
//! headers must arrive within `header_read_timeout`, bodies within `body_read_timeout`,
//! and shutdown drains in-flight requests for at most `shutdown_deadline` before
//! force-closing what is left.

use crate::mcp::auth::{ExpectedToken, bearer_auth, origin_gate};
use crate::mcp::jsonrpc_http::{
    MCP_MAX_REQUEST_BODY_BYTES, json_content_type_gate, rewrite_jsonrpc_http_errors,
    tools_call_shape_gate,
};
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::State,
    http::{Method, Request, StatusCode, header},
    middleware::{self, Next},
    response::Response,
};
use hyper_util::{
    rt::{TokioIo, TokioTimer},
    service::TowerToHyperService,
};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::task::{JoinHandle, JoinSet};
use tokio_util::sync::CancellationToken;

pub const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);
pub const BODY_READ_TIMEOUT: Duration = Duration::from_secs(30);
pub const SHUTDOWN_DEADLINE: Duration = Duration::from_millis(2500);

#[derive(Debug, Clone, Copy)]
pub struct ServeOptions {
    pub header_read_timeout: Duration,
    pub body_read_timeout: Duration,
    pub shutdown_deadline: Duration,
}

impl Default for ServeOptions {
    fn default() -> Self {
        Self {
            header_read_timeout: HEADER_READ_TIMEOUT,
            body_read_timeout: BODY_READ_TIMEOUT,
            shutdown_deadline: SHUTDOWN_DEADLINE,
        }
    }
}

/// Closed when shutdown starts. Write tools check it immediately before committing,
/// so a write either commits while its connection is still being drained (and gets
/// its response) or is refused without touching the store. A client retry is then
/// never a duplicate.
#[derive(Default)]
pub struct WriteGate(AtomicBool);

impl WriteGate {
    pub fn close(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_closed(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// The `/mcp` router with the auth, origin, and JSON-RPC gates.
pub fn mcp_router<S>(
    factory: impl Fn() -> Result<S, std::io::Error> + Send + Sync + 'static,
    token: &str,
    opts: &ServeOptions,
) -> Router
where
    S: rmcp::ServerHandler + Send + 'static,
{
    // No `with_cancellation_token`: rmcp answers every request still waiting on its
    // handler with HTTP 500 the moment that token fires, even when the tool already
    // committed. Shutdown is driven by the accept loop instead, which lets in-flight
    // requests finish.
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true);
    let service =
        StreamableHttpService::new(factory, LocalSessionManager::default().into(), config);
    Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn(rewrite_jsonrpc_http_errors))
        .layer(middleware::from_fn(tools_call_shape_gate))
        .layer(middleware::from_fn(json_content_type_gate))
        .layer(middleware::from_fn_with_state(
            opts.body_read_timeout,
            body_read_timeout_gate,
        ))
        .layer(middleware::from_fn_with_state(
            ExpectedToken::new(token),
            bearer_auth,
        ))
        .layer(middleware::from_fn(origin_gate))
        .layer(middleware::from_fn_with_state(
            opts.header_read_timeout,
            keep_alive_header,
        ))
}

/// Advertise the idle-connection timeout (hyper closes idle keep-alive connections after
/// `header_read_timeout`) on every response, including auth and origin rejections.
async fn keep_alive_header(State(idle): State<Duration>, req: Request<Body>, next: Next) -> Response {
    let mut res = next.run(req).await;
    let value = format!("timeout={}", idle.as_secs());
    if let Ok(value) = header::HeaderValue::from_str(&value) {
        res.headers_mut().insert("keep-alive", value);
    }
    res
}

fn jsonrpc_error_response(status: StatusCode, message: String) -> Response {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": null,
        "error": { "code": -32600, "message": message },
    });
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .expect("valid response")
}

/// Buffer POST bodies under a deadline so a slow upload cannot pin a connection.
async fn body_read_timeout_gate(
    State(limit): State<Duration>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if req.method() != Method::POST {
        return next.run(req).await;
    }
    let (parts, body) = req.into_parts();
    match tokio::time::timeout(limit, to_bytes(body, MCP_MAX_REQUEST_BODY_BYTES)).await {
        Ok(Ok(bytes)) => next.run(Request::from_parts(parts, Body::from(bytes))).await,
        Ok(Err(_)) => jsonrpc_error_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "Payload Too Large: request body exceeds {} bytes",
                MCP_MAX_REQUEST_BODY_BYTES
            ),
        ),
        Err(_) => jsonrpc_error_response(
            StatusCode::REQUEST_TIMEOUT,
            format!(
                "Request Timeout: body not received within {} ms",
                limit.as_millis()
            ),
        ),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShutdownReport {
    /// Connections still open at the deadline and closed without finishing.
    pub forced: usize,
}

pub struct RunningServer {
    addr: SocketAddr,
    shutdown: CancellationToken,
    gate: Arc<WriteGate>,
    listener_closed: oneshot::Receiver<()>,
    task: JoinHandle<ShutdownReport>,
}

impl RunningServer {
    pub fn local_addr(&self) -> SocketAddr {
        self.addr
    }

    /// Refuse new writes, stop accepting, and start draining. Resolves as soon as the
    /// port is released; the returned handle resolves once every connection finished
    /// or was force-closed at the deadline.
    pub async fn begin_shutdown(self) -> JoinHandle<ShutdownReport> {
        self.gate.close();
        self.shutdown.cancel();
        let _ = self.listener_closed.await;
        self.task
    }
}

/// Serve `router` on `listener` until [`RunningServer::begin_shutdown`].
pub fn serve(
    listener: TcpListener,
    router: Router,
    gate: Arc<WriteGate>,
    opts: ServeOptions,
) -> std::io::Result<RunningServer> {
    let addr = listener.local_addr()?;
    let shutdown = CancellationToken::new();
    let (closed_tx, closed_rx) = oneshot::channel();
    let task = tokio::spawn(accept_loop(
        listener,
        router,
        opts,
        shutdown.clone(),
        closed_tx,
    ));
    Ok(RunningServer {
        addr,
        shutdown,
        gate,
        listener_closed: closed_rx,
        task,
    })
}

async fn accept_loop(
    listener: TcpListener,
    router: Router,
    opts: ServeOptions,
    shutdown: CancellationToken,
    listener_closed: oneshot::Sender<()>,
) -> ShutdownReport {
    let mut conns = JoinSet::new();
    loop {
        tokio::select! {
            _ = shutdown.cancelled() => break,
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    conns.spawn(serve_connection(
                        stream,
                        router.clone(),
                        opts.header_read_timeout,
                        shutdown.clone(),
                    ));
                }
                // Transient (e.g. EMFILE); back off instead of spinning.
                Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
            },
            Some(_) = conns.join_next(), if !conns.is_empty() => {}
        }
    }
    drop(listener);
    let _ = listener_closed.send(());

    let drain = async { while conns.join_next().await.is_some() {} };
    if tokio::time::timeout(opts.shutdown_deadline, drain).await.is_ok() {
        return ShutdownReport { forced: 0 };
    }
    let forced = conns.len();
    conns.shutdown().await;
    ShutdownReport { forced }
}

async fn serve_connection(
    stream: TcpStream,
    router: Router,
    header_read_timeout: Duration,
    shutdown: CancellationToken,
) {
    let mut builder = hyper::server::conn::http1::Builder::new();
    builder
        .timer(TokioTimer::new())
        .header_read_timeout(header_read_timeout);
    let conn = builder.serve_connection(TokioIo::new(stream), TowerToHyperService::new(router));
    tokio::pin!(conn);
    tokio::select! {
        _ = conn.as_mut() => return,
        _ = shutdown.cancelled() => {}
    }
    // Finish the request in progress (if any), then close; idle connections close now.
    conn.as_mut().graceful_shutdown();
    let _ = conn.await;
}
