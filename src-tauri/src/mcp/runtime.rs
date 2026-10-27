//! Lifecycle for the desktop MCP HTTP server.

use crate::config::ConfigState;
use crate::mcp::auth::{ExpectedToken, bearer_auth, origin_gate};
use crate::mcp::handler::PansuthongMcp;
use crate::mcp::jsonrpc_http::{json_content_type_gate, rewrite_jsonrpc_http_errors};
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

#[derive(Clone, PartialEq, Eq)]
struct McpListenConfig {
    port: u32,
    token: String,
}

#[derive(Default)]
pub struct McpRuntime {
    cancel: Mutex<Option<CancellationToken>>,
    server: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    active: Mutex<Option<McpListenConfig>>,
    status: Mutex<McpStatus>,
}

impl McpRuntime {
    pub fn status(&self) -> McpStatus {
        self.status.lock().unwrap().clone()
    }

    fn set_status(&self, status: McpStatus) {
        *self.status.lock().unwrap() = status;
    }

    fn stop_and_wait(&self) {
        if let Some(ct) = self.cancel.lock().unwrap().take() {
            ct.cancel();
        }
        let handle = self.server.lock().unwrap().take();
        if let Some(h) = handle {
            tauri::async_runtime::block_on(async {
                let _ = h.await;
            });
        }
        *self.active.lock().unwrap() = None;
        self.set_status(McpStatus {
            status: McpStatusKind::Off,
            message: None,
        });
    }

    pub fn stop(&self) {
        self.stop_and_wait();
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

        let desired = McpListenConfig {
            port,
            token: token.clone(),
        };
        if self.active.lock().unwrap().as_ref() == Some(&desired) {
            return;
        }

        self.stop_and_wait();

        let ct = CancellationToken::new();
        *self.cancel.lock().unwrap() = Some(ct.clone());
        let app_handle = app.clone();
        let app_for_factory = app_handle.clone();
        let expected = ExpectedToken::new(&token);
        let desired_in_spawn = desired.clone();

        let server = tauri::async_runtime::spawn(async move {
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
                .layer(middleware::from_fn(rewrite_jsonrpc_http_errors))
                .layer(middleware::from_fn(json_content_type_gate))
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
                *runtime.active.lock().unwrap() = Some(desired_in_spawn);
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

        *self.server.lock().unwrap() = Some(server);
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
