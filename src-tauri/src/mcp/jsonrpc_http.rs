//! Map plain-text Streamable HTTP error bodies to JSON-RPC error responses.

use axum::{
    body::{Body, to_bytes},
    http::{Request, Response, StatusCode, header},
    middleware::Next,
    response::IntoResponse,
};
use rmcp::model::{
    CallToolRequest, ClientJsonRpcMessage, ClientRequest, ErrorData, JsonRpcVersion2_0,
};
use serde::Serialize;
use serde_json::Value;
use std::borrow::Cow;

const JSON: &str = "application/json";

/// Transport-layer JSON-RPC errors always expose `"id": null` (gate cannot trust client ids).
#[derive(Serialize)]
struct TransportJsonRpcError {
    jsonrpc: JsonRpcVersion2_0,
    id: Value,
    error: ErrorData,
}

fn transport_error_response(status: StatusCode, error: ErrorData) -> Response<Body> {
    let err = TransportJsonRpcError {
        jsonrpc: JsonRpcVersion2_0,
        id: Value::Null,
        error,
    };
    let body = serde_json::to_vec(&err).expect("serialize TransportJsonRpcError");
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, JSON)
        .body(Body::from(body))
        .expect("valid response")
}

fn invalid_request_response(
    status: StatusCode,
    message: impl Into<Cow<'static, str>>,
) -> Response<Body> {
    transport_error_response(status, ErrorData::invalid_request(message, None))
}

fn invalid_params_response(
    status: StatusCode,
    message: impl Into<Cow<'static, str>>,
) -> Response<Body> {
    transport_error_response(status, ErrorData::invalid_params(message, None))
}

fn tools_call_params_invalid(params: &Value) -> Option<String> {
    let obj = match params {
        Value::Object(map) => map,
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) | Value::Array(_) => {
            return Some("tools/call requires params to be an object".into());
        }
    };
    match obj.get("name") {
        Some(Value::String(name)) if !name.is_empty() => {}
        _ => return Some("tools/call requires params.name as a non-empty string".into()),
    }
    if let Some(args) = obj.get("arguments") {
        if !args.is_object() {
            return Some("tools/call params.arguments must be an object".into());
        }
    }
    None
}

fn tools_call_shape_error(body: &Value) -> Option<String> {
    if body.get("method").and_then(Value::as_str) != Some("tools/call") {
        return None;
    }
    let params = body.get("params");
    if params.is_none() || params.is_some_and(|p| p.is_null()) {
        return Some("tools/call requires params".into());
    }
    if let Some(msg) = tools_call_params_invalid(params.unwrap()) {
        return Some(msg);
    }
    // Reject shapes rmcp would route as CustomRequest instead of CallToolRequest.
    if serde_json::from_value::<CallToolRequest>(body.clone()).is_err() {
        return Some("tools/call params are invalid".into());
    }
    if let Ok(ClientJsonRpcMessage::Request(req)) = serde_json::from_value(body.clone()) {
        if matches!(req.request, ClientRequest::CustomRequest(_)) {
            return Some("tools/call params are invalid".into());
        }
    }
    None
}

/// Reject malformed `tools/call` before rmcp maps them to method-not-found (`-32601`).
pub async fn tools_call_shape_gate(
    req: Request<Body>,
    next: Next,
) -> axum::response::Response {
    if req.method() != axum::http::Method::POST {
        return next.run(req).await;
    }
    let (parts, body) = req.into_parts();
    let bytes = to_bytes(body, 1_048_576).await.unwrap_or_default();
    if bytes.is_empty() {
        let req = Request::from_parts(parts, Body::from(bytes));
        return next.run(req).await;
    }
    if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
        if let Some(message) = tools_call_shape_error(&value) {
            return invalid_params_response(StatusCode::BAD_REQUEST, message).into_response();
        }
    }
    let req = Request::from_parts(parts, Body::from(bytes));
    next.run(req).await
}

/// Reject POSTs without `Content-Type: application/json` using a JSON-RPC invalid-request error.
pub async fn json_content_type_gate(
    req: Request<Body>,
    next: Next,
) -> axum::response::Response {
    if req.method() == axum::http::Method::POST {
        let ok = req
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with(JSON));
        if !ok {
            return invalid_request_response(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Unsupported Media Type: Content-Type must be application/json",
            );
        }
    }
    next.run(req).await
}

/// Rewrite rmcp plain-text 406/413/415 bodies into JSON-RPC errors when possible.
pub async fn rewrite_jsonrpc_http_errors(
    req: Request<Body>,
    next: Next,
) -> axum::response::Response {
    let res = next.run(req).await;
    let status = res.status();
    if status != StatusCode::UNSUPPORTED_MEDIA_TYPE
        && status != StatusCode::NOT_ACCEPTABLE
        && status != StatusCode::PAYLOAD_TOO_LARGE
    {
        return res;
    }
    let (parts, body) = res.into_parts();
    let bytes = to_bytes(body, 1_048_576).await.unwrap_or_default();
    let message = String::from_utf8_lossy(&bytes).into_owned();
    let error = if status == StatusCode::NOT_ACCEPTABLE || status == StatusCode::PAYLOAD_TOO_LARGE {
        ErrorData::invalid_request(message, None)
    } else if message.contains("fail to deserialize") || message.contains("deserialize request body") {
        ErrorData::parse_error(message, None)
    } else {
        ErrorData::invalid_request(message, None)
    };
    transport_error_response(parts.status, error).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn transport_error_serializes_null_id() {
        let err = TransportJsonRpcError {
            jsonrpc: JsonRpcVersion2_0,
            id: Value::Null,
            error: ErrorData::invalid_request("test", None),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json.get("id"), Some(&Value::Null));
        assert_eq!(
            json.get("error")
                .and_then(|e| e.get("code"))
                .and_then(|c| c.as_i64()),
            Some(-32600)
        );
    }

    #[test]
    fn tools_call_shape_errors() {
        let cases = [
            (
                json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call"}),
                true,
            ),
            (
                json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": null}),
                true,
            ),
            (
                json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {}}),
                true,
            ),
            (
                json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": { "name": "ping", "arguments": "x" }
                }),
                true,
            ),
            (
                json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": { "name": "ping" }
                }),
                false,
            ),
        ];
        for (body, expect_err) in cases {
            let got = tools_call_shape_error(&body).is_some();
            assert_eq!(got, expect_err, "body={body}");
        }
    }
}
