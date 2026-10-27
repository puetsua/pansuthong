//! Bearer token gate and Origin policy for the local MCP HTTP endpoint.

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use subtle::ConstantTimeEq;

#[derive(Clone)]
pub struct ExpectedToken(Arc<Vec<u8>>);

impl ExpectedToken {
    pub fn new(token: &str) -> Self {
        Self(Arc::new(token.as_bytes().to_vec()))
    }
}

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

pub async fn bearer_auth(
    State(expected): State<ExpectedToken>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let authorized = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .is_some_and(|provided| {
            let a = provided.as_bytes();
            let b = expected.0.as_slice();
            a.len() == b.len() && a.ct_eq(b).into()
        });
    if authorized {
        next.run(req).await
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn authorized(expected: &ExpectedToken, header_value: Option<&str>) -> bool {
        header_value
            .and_then(|s| s.strip_prefix("Bearer "))
            .is_some_and(|provided| {
                let a = provided.as_bytes();
                let b = expected.0.as_slice();
                a.len() == b.len() && a.ct_eq(b).into()
            })
    }

    #[test]
    fn rejects_missing_or_wrong_bearer() {
        let expected = ExpectedToken::new("secret-token-value-0123456789abcdef");
        assert!(!authorized(&expected, None));
        assert!(!authorized(&expected, Some("Bearer wrong")));
        assert!(!authorized(&expected, Some("Basic x")));
    }

    #[test]
    fn accepts_valid_bearer() {
        let token = "secret-token-value-0123456789abcdef";
        let expected = ExpectedToken::new(token);
        assert!(authorized(&expected, Some(&format!("Bearer {token}"))));
    }

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
