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
    error: ErrorData,
}

impl GateError {
    fn into_response(self) -> Response<Body> {
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
            error: ErrorData::invalid_request(msg, None),
        });
    };
    let id = match obj.get("id") {
        Some(id @ (Value::String(_) | Value::Number(_))) => Some(id.clone()),
        _ => None,
    };
    if obj.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Some(GateError {
            id,
            error: ErrorData::invalid_request("jsonrpc must be exactly \"2.0\"", None),
        });
    }
    tools_call_shape_error(value).map(|message| GateError {
        id,
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

    #[test]
    fn list_tasks_limit_argument_validation() {
        let bad = [
            json!({
                "method": "tools/call",
                "params": { "name": "list_tasks", "arguments": { "limit": -1 } }
            }),
            json!({
                "method": "tools/call",
                "params": { "name": "list_tasks", "arguments": { "limit": "5" } }
            }),
            json!({
                "method": "tools/call",
                "params": { "name": "list_tasks", "arguments": { "limit": 0 } }
            }),
        ];
        for body in bad {
            assert!(
                tools_call_shape_error(&body).is_some(),
                "expected shape error for {body}"
            );
        }
        let ok = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": "list_tasks", "arguments": { "limit": 5 } }
        });
        assert!(tools_call_shape_error(&ok).is_none());
    }

    fn list_tasks_call(arguments: Value) -> Value {
        json!({
            "jsonrpc": "2.0",
            "id": 18,
            "method": "tools/call",
            "params": { "name": "list_tasks", "arguments": arguments }
        })
    }

    #[test]
    fn list_tasks_limit_and_offset_bounds() {
        let bad = [
            json!({"limit": 0}),
            json!({"limit": -1}),
            json!({"limit": 501}),
            json!({"limit": 1.5}),
            json!({"limit": "5"}),
            json!({"limit": null}),
            json!({"limit": true}),
            json!({"limit": 4294967296u64}),
            json!({"limit": 1e20}),
            json!({"offset": -1}),
            json!({"offset": "5"}),
            json!({"offset": 1.5}),
            json!({"offset": null}),
            json!({"offset": 4294967296u64}),
            json!({"offset": 1e20}),
        ];
        for args in bad {
            let err = gate_check(&list_tasks_call(args.clone()))
                .unwrap_or_else(|| panic!("expected gate error for {args}"));
            assert_eq!(err.error.code, ErrorData::invalid_params("", None).code);
            assert_eq!(err.id, Some(json!(18)));
        }
        for args in [
            json!({}),
            json!({"limit": 1}),
            json!({"limit": 500, "offset": 0}),
            json!({"offset": 4294967295u64}),
        ] {
            assert!(gate_check(&list_tasks_call(args.clone())).is_none(), "{args}");
        }
    }

    #[test]
    fn gate_echoes_known_ids_and_nulls_unknown() {
        let no_params = json!({"jsonrpc": "2.0", "id": 9, "method": "tools/call"});
        assert_eq!(gate_check(&no_params).unwrap().id, Some(json!(9)));
        let str_id = json!({"jsonrpc": "2.0", "id": "a", "method": "tools/call"});
        assert_eq!(gate_check(&str_id).unwrap().id, Some(json!("a")));
        let no_id = json!({"jsonrpc": "2.0", "method": "tools/call"});
        assert_eq!(gate_check(&no_id).unwrap().id, None);
        let bad_id = json!({"jsonrpc": "2.0", "id": {}, "method": "tools/call"});
        assert_eq!(gate_check(&bad_id).unwrap().id, None);
    }

    #[test]
    fn gate_rejects_batches_and_wrong_version_as_invalid_request() {
        let invalid_request = ErrorData::invalid_request("", None).code;
        let batch = json!([{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}]);
        let err = gate_check(&batch).unwrap();
        assert_eq!(err.error.code, invalid_request);
        assert_eq!(err.id, None);

        let v1 = json!({"jsonrpc": "1.0", "id": 7, "method": "tools/list"});
        let err = gate_check(&v1).unwrap();
        assert_eq!(err.error.code, invalid_request);
        assert_eq!(err.id, Some(json!(7)));

        let missing = json!({"id": 7, "method": "tools/list"});
        assert_eq!(gate_check(&missing).unwrap().error.code, invalid_request);
        assert!(gate_check(&json!({"jsonrpc": "2.0", "id": 7, "method": "tools/list"})).is_none());
    }

    #[test]
    fn json_media_type_is_exact() {
        assert!(is_json_media_type("application/json"));
        assert!(is_json_media_type("application/json; charset=utf-8"));
        assert!(is_json_media_type("Application/JSON"));
        assert!(!is_json_media_type("application/jsonx"));
        assert!(!is_json_media_type("application/json-seq"));
        assert!(!is_json_media_type("text/plain"));
    }
}
