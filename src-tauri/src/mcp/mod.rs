#[cfg(desktop)]
pub mod auth;
#[cfg(desktop)]
pub mod handler;
#[cfg(desktop)]
pub mod json;
#[cfg(desktop)]
pub mod runtime;

#[cfg(desktop)]
pub use runtime::{McpRuntime, McpStatus, McpStatusKind, generate_mcp_token};

#[cfg(all(test, desktop))]
mod http_test;
