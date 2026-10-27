//! Bearer token gate for the local MCP HTTP endpoint.

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
}
