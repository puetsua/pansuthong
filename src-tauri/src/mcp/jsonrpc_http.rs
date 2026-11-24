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

/// Same limit as rmcp `StreamableHttpServerConfig` default (`DEFAULT_MAX_REQUEST_BODY_BYTES`).
pub const MCP_MAX_REQUEST_BODY_BYTES: usize = 4 * 1024 * 1024;

/// Transport-layer JSON-RPC errors expose `"id": null`; message-level gate errors echo the
/// request id when the body is an object carrying a valid (string or number) id.
#[derive(Serialize)]
struct TransportJsonRpcError {
    jsonrpc: JsonRpcVersion2_0,
    id: Value,
    error: ErrorData,
}

fn transport_error_response(status: StatusCode, error: ErrorData) -> Response<Body> {
    jsonrpc_error_response(status, Value::Null, error)
}

fn jsonrpc_error_response(status: StatusCode, id: Value, error: ErrorData) -> Response<Body> {
    let err = TransportJsonRpcError {
        jsonrpc: JsonRpcVersion2_0,
        id,
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

fn payload_too_large_response() -> Response<Body> {
    invalid_request_response(
        StatusCode::PAYLOAD_TOO_LARGE,
        format!(
            "Payload Too Large: request body exceeds {} bytes",
            MCP_MAX_REQUEST_BODY_BYTES
        ),
    )
}

enum RequestBodyReadError {
    TooLarge,
}

async fn read_request_body_limited(
    body: Body,
) -> Result<axum::body::Bytes, RequestBodyReadError> {
    match to_bytes(body, MCP_MAX_REQUEST_BODY_BYTES).await {
        Ok(bytes) => Ok(bytes),
        Err(_) => Err(RequestBodyReadError::TooLarge),
    }
}

/// `list_tasks` page-size bounds; keep in sync with `ListTasksArgs::limit` schema attributes.
const LIST_TASKS_LIMIT_MAX: u64 = 500;

/// Require `value` to be a JSON integer in `min..=max` (no null, floats, strings, or bools).
fn integer_in_range(value: &Value, min: u64, max: u64) -> bool {
    value.as_u64().is_some_and(|u| (min..=max).contains(&u))
}

/// Reject `list_tasks` argument shapes that violate the advertised input schema.
fn list_tasks_arguments_invalid(name: &str, arguments: Option<&Value>) -> Option<String> {
    if name != "list_tasks" {
        return None;
    }
    let args = arguments?;
    if let Some(limit) = args.get("limit") {
        if !integer_in_range(limit, 1, LIST_TASKS_LIMIT_MAX) {
            return Some(format!(
                "list_tasks limit must be an integer between 1 and {LIST_TASKS_LIMIT_MAX}"
            ));
        }
    }
    if let Some(offset) = args.get("offset") {
        if !integer_in_range(offset, 0, u32::MAX as u64) {
            return Some(format!(
                "list_tasks offset must be an integer between 0 and {}",
                u32::MAX
            ));
        }
    }
    None
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
    let params = params.unwrap();
    if let Some(msg) = tools_call_params_invalid(params) {
        return Some(msg);
    }
    if let Some(obj) = params.as_object() {
        if let Some(name) = obj.get("name").and_then(Value::as_str) {
            if let Some(msg) = list_tasks_arguments_invalid(name, obj.get("arguments")) {
                return Some(msg);
            }
        }
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

/// A pre-dispatch rejection. `id` is `Some` only when the body is an object with a valid
/// JSON-RPC id (string or number); such errors are returned in-band with HTTP 200.
struct GateError {
    id: Option<Value>,
    /// Object without an `id` member: a JSON-RPC notification, which never gets a response body.
    notification: bool,
    error: ErrorData,
}

impl GateError {
    fn into_response(self) -> Response<Body> {
        if self.notification {
            // Same as rmcp for accepted notifications: 202, empty body.
            return Response::builder()
                .status(StatusCode::ACCEPTED)
                .body(Body::empty())
                .expect("valid response");
        }
        match self.id {
            Some(id) => jsonrpc_error_response(StatusCode::OK, id, self.error),
            None => transport_error_response(StatusCode::BAD_REQUEST, self.error),
        }
    }
}

/// Validate a successfully parsed JSON body before rmcp sees it.
fn gate_check(value: &Value) -> Option<GateError> {
    let Some(obj) = value.as_object() else {
        // Batches (arrays) are unsupported; any other non-object is not a request either.
        let msg = if value.is_array() {
            "JSON-RPC batch requests are not supported"
        } else {
            "request must be a JSON-RPC object"
        };
        return Some(GateError {
            id: None,
            notification: false,
            error: ErrorData::invalid_request(msg, None),
        });
    };
    let id = match obj.get("id") {
        Some(id @ (Value::String(_) | Value::Number(_))) => Some(id.clone()),
        _ => None,
    };
    let notification = !obj.contains_key("id");
    if obj.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Some(GateError {
            id,
            notification,
            error: ErrorData::invalid_request("jsonrpc must be exactly \"2.0\"", None),
        });
    }
    tools_call_shape_error(value).map(|message| GateError {
        id,
        notification,
        error: ErrorData::invalid_params(message, None),
    })
}

/// Reject malformed requests before rmcp maps them to parse errors or method-not-found.
pub async fn tools_call_shape_gate(
    req: Request<Body>,
    next: Next,
) -> axum::response::Response {
    if req.method() != axum::http::Method::POST {
        return next.run(req).await;
    }
    let (parts, body) = req.into_parts();
    let bytes = match read_request_body_limited(body).await {
        Ok(bytes) => bytes,
        Err(RequestBodyReadError::TooLarge) => {
            return payload_too_large_response().into_response();
        }
    };
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(value) => {
            if let Some(err) = gate_check(&value) {
                return err.into_response().into_response();
            }
        }
        Err(e) => {
            return transport_error_response(
                StatusCode::BAD_REQUEST,
                ErrorData::parse_error(format!("Parse error: {e}"), None),
            )
            .into_response();
        }
    }
    let req = Request::from_parts(parts, Body::from(bytes));
    next.run(req).await
}

/// True when the media type (ignoring parameters such as `charset`) is exactly `application/json`.
fn is_json_media_type(content_type: &str) -> bool {
    content_type
        .split(';')
        .next()
        .is_some_and(|m| m.trim().eq_ignore_ascii_case(JSON))
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
            .is_some_and(is_json_media_type);
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
    let bytes = match to_bytes(body, MCP_MAX_REQUEST_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return transport_error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                ErrorData::invalid_request(
                    format!(
                        "Payload Too Large: response body exceeds {} bytes",
                        MCP_MAX_REQUEST_BODY_BYTES
                    ),
                    None,
                ),
            )
            .into_response();
        }
    };
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
