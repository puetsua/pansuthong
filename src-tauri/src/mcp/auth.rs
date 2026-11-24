//! Origin policy for the local MCP HTTP endpoint. The server binds to 127.0.0.1
//! only and needs no token (#252); this gate keeps web pages from calling it.

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};

/// Streamable HTTP DNS-rebinding guard: allow missing `Origin` (curl, native clients)
/// and localhost origins only when the header is present.
pub fn is_allowed_origin(origin: &str) -> bool {
    let origin = origin.trim();
    let rest = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .unwrap_or(origin);
    let host_port = rest.split('/').next().unwrap_or(rest);
    let host = host_port
        .rsplit_once(':')
        .map(|(h, _)| h)
        .unwrap_or(host_port);
    let host = host.trim_matches(|c| c == '[' || c == ']');
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

pub async fn origin_gate(req: Request<Body>, next: Next) -> Response {
    if let Some(origin) = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
    {
        if !is_allowed_origin(origin) {
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_allows_localhost_and_missing() {
        assert!(is_allowed_origin("http://localhost:7373"));
        assert!(is_allowed_origin("http://127.0.0.1:7373"));
        assert!(is_allowed_origin("https://localhost"));
        assert!(is_allowed_origin("http://[::1]:8080"));
        assert!(!is_allowed_origin("http://evil.example"));
        assert!(!is_allowed_origin("http://127.0.0.1.evil.example"));
    }
}
