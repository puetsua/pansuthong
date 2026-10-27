//! Map plain-text Streamable HTTP error bodies to JSON-RPC error responses.

use axum::{
    body::{Body, to_bytes},
    http::{Response, StatusCode, header},
    middleware::Next,
    response::IntoResponse,
};
use rmcp::model::{ErrorData, JsonRpcError};

const JSON: &str = "application/json";

fn parse_error_response(status: StatusCode, message: String) -> Response<Body> {
    let err = JsonRpcError::new(None, ErrorData::parse_error(message, None));
    let body = serde_json::to_vec(&err).expect("serialize JsonRpcError");
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, JSON)
        .body(Body::from(body))
        .expect("valid response")
}

/// Reject POSTs without `Content-Type: application/json` using a JSON-RPC parse error.
pub async fn json_content_type_gate(
    req: axum::http::Request<axum::body::Body>,
    next: Next,
) -> axum::response::Response {
    if req.method() == axum::http::Method::POST {
        let ok = req
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with(JSON));
        if !ok {
            return parse_error_response(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Unsupported Media Type: Content-Type must be application/json".into(),
            );
        }
    }
    next.run(req).await
}

/// Rewrite rmcp plain-text 415/406 bodies into JSON-RPC errors when possible.
pub async fn rewrite_jsonrpc_http_errors(
    req: axum::http::Request<axum::body::Body>,
    next: Next,
) -> axum::response::Response {
    let res = next.run(req).await;
    let status = res.status();
    if status != StatusCode::UNSUPPORTED_MEDIA_TYPE && status != StatusCode::NOT_ACCEPTABLE {
        return res;
    }
    let (parts, body) = res.into_parts();
    let bytes = to_bytes(body, 1_048_576).await.unwrap_or_default();
    let message = String::from_utf8_lossy(&bytes).into_owned();
    parse_error_response(parts.status, message).into_response()
}
