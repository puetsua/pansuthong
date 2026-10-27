//! Lifecycle for the desktop MCP HTTP server.

use crate::config::ConfigState;
use crate::mcp::handler::PansuthongMcp;
use crate::mcp::server::{RunningServer, ServeOptions, WriteGate, mcp_router, serve};
use axum::Router;
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

pub use crate::config::MCP_PORT_DEFAULT;

/// Event the settings UI listens for; payload is [`McpStatus`].
pub const MCP_STATUS_CHANGED: &str = "mcp-status-changed";

pub fn generate_mcp_token() -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("getrandom");
    URL_SAFE_NO_PAD.encode(bytes)
}
pub const MCP_PORT_MIN: u32 = 1024;
pub const MCP_PORT_MAX: u32 = 65535;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpStatusKind {
    Off,
    Listening,
    PortInUse,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct McpStatus {
    pub status: McpStatusKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl Default for McpStatus {
    fn default() -> Self {
        Self {
            status: McpStatusKind::Off,
            message: None,
        }
    }
}

impl McpStatus {
    fn new(status: McpStatusKind, message: Option<String>) -> Self {
        Self { status, message }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpListenConfig {
    pub port: u16,
    pub token: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpDesired {
    Off,
    Listen(McpListenConfig),
    Invalid(String),
}

/// Builds the `/mcp` router for a token; the gate is closed when that server stops.
pub type RouterFactory = Arc<dyn Fn(&str, Arc<WriteGate>) -> Router + Send + Sync>;
pub type StatusSink = Arc<dyn Fn(&McpStatus) + Send + Sync>;

/// Thread-safe handle to the MCP server supervisor.
///
/// [`McpController::request`] only records the desired state and returns at once, so
/// it is safe to call from the UI thread. A single supervisor task applies requests
/// in order: stopping releases the port immediately and drains in-flight requests in
/// the background (bounded by [`ServeOptions::shutdown_deadline`]).
pub struct McpController {
    desired: watch::Sender<McpDesired>,
    status: Arc<Mutex<McpStatus>>,
    sink: StatusSink,
}

impl McpController {
    /// Returns the controller and the supervisor future the caller must spawn.
    pub fn new(
        make_router: RouterFactory,
        sink: StatusSink,
        opts: ServeOptions,
    ) -> (Self, impl Future<Output = ()> + Send + 'static) {
        let (desired, rx) = watch::channel(McpDesired::Off);
        let status = Arc::new(Mutex::new(McpStatus::default()));
        let supervisor = supervise(rx, make_router, opts, status.clone(), sink.clone());
        (
            Self {
                desired,
                status,
                sink,
            },
            supervisor,
        )
    }

    pub fn request(&self, desired: McpDesired) {
        if desired == McpDesired::Off {
            // The listener closes as soon as the supervisor sees this; report it now
            // so a status read right after the toggle is already accurate.
            publish(&self.status, &self.sink, McpStatus::default());
        }
        // `send_replace` notifies even when the value is unchanged, so re-sending the
        // same config retries a bind that failed (e.g. the port was in use).
        self.desired.send_replace(desired);
    }

    pub fn status(&self) -> McpStatus {
        self.status.lock().unwrap().clone()
    }
}

fn publish(status: &Mutex<McpStatus>, sink: &StatusSink, next: McpStatus) {
    let mut cur = status.lock().unwrap();
    if *cur != next {
        *cur = next.clone();
        drop(cur);
        sink(&next);
    }
}

async fn supervise(
    mut rx: watch::Receiver<McpDesired>,
    make_router: RouterFactory,
    opts: ServeOptions,
    status: Arc<Mutex<McpStatus>>,
    sink: StatusSink,
) {
    let mut current: Option<(McpListenConfig, RunningServer)> = None;
    loop {
        let desired = rx.borrow_and_update().clone();
        let unchanged = matches!(
            (&current, &desired),
            (Some((running, _)), McpDesired::Listen(want)) if running == want
        );
        if unchanged {
            // A coalesced Off→On with the same config: still running, but `request(Off)`
            // already reported Off.
            publish(&status, &sink, McpStatus::new(McpStatusKind::Listening, None));
        } else {
            if let Some((_, server)) = current.take() {
                // Detach the drain: the next server can bind while old requests finish.
                drop(server.begin_shutdown().await);
            }
            let next = match desired {
                McpDesired::Off => McpStatus::default(),
                McpDesired::Invalid(message) => {
                    McpStatus::new(McpStatusKind::Error, Some(message))
                }
                McpDesired::Listen(cfg) => match start(&cfg, &make_router, opts).await {
                    Ok(server) => {
                        current = Some((cfg, server));
                        McpStatus::new(McpStatusKind::Listening, None)
                    }
                    Err(e) => {
                        let kind = if e.kind() == std::io::ErrorKind::AddrInUse {
                            McpStatusKind::PortInUse
                        } else {
                            McpStatusKind::Error
                        };
                        McpStatus::new(kind, Some(e.to_string()))
                    }
                },
            };
            publish(&status, &sink, next);
        }
        if rx.changed().await.is_err() {
            break;
        }
    }
    if let Some((_, server)) = current.take() {
        drop(server.begin_shutdown().await);
    }
}

async fn start(
    cfg: &McpListenConfig,
    make_router: &RouterFactory,
    opts: ServeOptions,
) -> std::io::Result<RunningServer> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", cfg.port)).await?;
    let gate = Arc::new(WriteGate::default());
    let router = make_router(&cfg.token, gate.clone());
    serve(listener, router, gate, opts)
}

/// Tauri-managed MCP lifecycle; the supervisor starts on first use.
#[derive(Default)]
pub struct McpRuntime {
    controller: OnceLock<McpController>,
}

impl McpRuntime {
    pub fn status(&self) -> McpStatus {
        self.controller
            .get()
            .map(McpController::status)
            .unwrap_or_default()
    }

    fn controller(&self, app: &AppHandle) -> &McpController {
        self.controller.get_or_init(|| {
            let for_router = app.clone();
            let make_router: RouterFactory = Arc::new(move |token, gate| {
                let app = for_router.clone();
                let opts = ServeOptions::default();
                mcp_router(
                    move || Ok(PansuthongMcp::new(app.clone(), gate.clone())),
                    token,
                    &opts,
                )
            });
            let for_sink = app.clone();
            // Like `store_notify`: the supervisor runs on Tokio, and WebKitGTK only
            // delivers reliably when the emit is scheduled on the main thread.
            let sink: StatusSink = Arc::new(move |status| {
                let app = for_sink.clone();
                let status = status.clone();
                let _ = for_sink.run_on_main_thread(move || {
                    let _ = app.emit(MCP_STATUS_CHANGED, status);
                });
            });
            let (controller, supervisor) =
                McpController::new(make_router, sink, ServeOptions::default());
            tauri::async_runtime::spawn(supervisor);
            controller
        })
    }

    /// Apply current settings: stop when disabled, otherwise (re)start on the configured
    /// port. Never blocks on the server; status changes arrive via [`MCP_STATUS_CHANGED`].
    pub fn sync_from_settings(&self, app: &AppHandle, config: &ConfigState) {
        let settings = config.settings();
        let controller = self.controller(app);
        if !settings.mcp_enabled {
            controller.request(McpDesired::Off);
            return;
        }
        let token = match settings.mcp_token.as_deref() {
            Some(t) if !t.is_empty() => t.to_string(),
            _ => {
                let generated = generate_mcp_token();
                let _ = config.update_settings(|s| {
                    s.mcp_token = Some(generated.clone());
                    Ok(())
                });
                generated
            }
        };
        let desired = match validate_mcp_port(settings.mcp_port) {
            Ok(()) => McpDesired::Listen(McpListenConfig {
                port: settings.mcp_port as u16,
                token,
            }),
            Err(_) => McpDesired::Invalid(format!(
                "port must be {}..={}",
                MCP_PORT_MIN, MCP_PORT_MAX
            )),
        };
        controller.request(desired);
    }
}

pub fn validate_mcp_port(port: u32) -> Result<(), String> {
    if (MCP_PORT_MIN..=MCP_PORT_MAX).contains(&port) {
        Ok(())
    } else {
        Err(format!(
            "mcp_port must be {}..={}, got {}",
            MCP_PORT_MIN,
            MCP_PORT_MAX,
            port
        ))
    }
}

/// True when a settings patch touches MCP listen configuration.
pub fn settings_patch_affects_mcp(input: &crate::commands::UpdateSettingsInput) -> bool {
    input.mcp_enabled.is_some() || input.mcp_port.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::UpdateSettingsInput;

    #[test]
    fn settings_patch_affects_mcp_only_when_mcp_fields_present() {
        let unrelated = UpdateSettingsInput {
            sound_on_complete: Some(false),
            ..UpdateSettingsInput::default()
        };
        assert!(!settings_patch_affects_mcp(&unrelated));
        let port = UpdateSettingsInput {
            mcp_port: Some(7373),
            ..UpdateSettingsInput::default()
        };
        assert!(settings_patch_affects_mcp(&port));
    }
}
