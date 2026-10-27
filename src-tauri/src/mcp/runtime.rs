//! Lifecycle for the desktop MCP HTTP server.

use crate::config::ConfigState;
use crate::mcp::auth::{ExpectedToken, bearer_auth, origin_gate};
use crate::mcp::handler::PansuthongMcp;
use axum::{Router, middleware};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

pub use crate::config::MCP_PORT_DEFAULT;

pub fn generate_mcp_token() -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("getrandom");
    URL_SAFE_NO_PAD.encode(bytes)
}
pub const MCP_PORT_MIN: u32 = 1024;
pub const MCP_PORT_MAX: u32 = 65535;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpStatusKind {
    Off,
    Listening,
    PortInUse,
    Error,
}

#[derive(Debug, Clone, serde::Serialize)]
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

#[derive(Default)]
pub struct McpRuntime {
    cancel: Mutex<Option<CancellationToken>>,
    status: Mutex<McpStatus>,
}

impl McpRuntime {
    pub fn status(&self) -> McpStatus {
        self.status.lock().unwrap().clone()
    }

    fn set_status(&self, status: McpStatus) {
        *self.status.lock().unwrap() = status;
    }

    pub fn stop(&self) {
        if let Some(ct) = self.cancel.lock().unwrap().take() {
            ct.cancel();
        }
        self.set_status(McpStatus {
            status: McpStatusKind::Off,
            message: None,
        });
    }

    /// Apply current settings: stop when disabled, otherwise (re)start on the configured port.
    pub fn sync_from_settings(&self, app: &AppHandle, config: &ConfigState) {
        let settings = config.settings();
        if !settings.mcp_enabled {
            self.stop();
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
        let port = settings.mcp_port;
        if !(MCP_PORT_MIN..=MCP_PORT_MAX).contains(&port) {
            self.stop();
            self.set_status(McpStatus {
                status: McpStatusKind::Error,
                message: Some(format!(
                    "port must be {}..={}",
                    MCP_PORT_MIN,
                    MCP_PORT_MAX
                )),
            });
            return;
        }

        self.stop();

        let ct = CancellationToken::new();
        *self.cancel.lock().unwrap() = Some(ct.clone());
        let app_handle = app.clone();
        let app_for_factory = app_handle.clone();
        let expected = ExpectedToken::new(&token);

        tauri::async_runtime::spawn(async move {
            let config = StreamableHttpServerConfig::default()
                .with_cancellation_token(ct.clone())
                .with_legacy_session_mode(false)
                .with_json_response(true);

            let service = StreamableHttpService::new(
                move || Ok(PansuthongMcp::new(app_for_factory.clone())),
                LocalSessionManager::default().into(),
                config,
            );

            let router = Router::new()
                .nest_service("/mcp", service)
                .layer(middleware::from_fn_with_state(expected, bearer_auth))
                .layer(middleware::from_fn(origin_gate));

            let addr = format!("127.0.0.1:{port}");
            let listener = match tokio::net::TcpListener::bind(&addr).await {
                Ok(l) => l,
                Err(e) => {
                    let runtime = app_handle.state::<McpRuntime>();
                    let kind = if e.kind() == std::io::ErrorKind::AddrInUse {
                        McpStatusKind::PortInUse
                    } else {
                        McpStatusKind::Error
                    };
                    runtime.set_status(McpStatus {
                        status: kind,
                        message: Some(e.to_string()),
                    });
                    return;
                }
            };

            {
                let runtime = app_handle.state::<McpRuntime>();
                runtime.set_status(McpStatus {
                    status: McpStatusKind::Listening,
                    message: None,
                });
            }

            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    ct.cancelled().await;
                })
                .await;
        });
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
