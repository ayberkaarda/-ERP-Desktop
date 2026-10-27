//! The Laravel response envelope (`backend/app/Core/Http/ApiResponse.php`),
//! built for local answers exactly as the server builds it, and the server's
//! answer turned into an [`ApiResponseDto`].
//!
//! - success: `{"data": ..., "meta"?: {...}}` (`meta` only when not empty)
//! - paginated: `meta.pagination = {current_page, per_page, total, last_page}`
//! - error: `{"errors": {"message", "code", "fields"?}}`
//!
//! Local answers add `meta.offline` ([`OfflineMeta`]); the server never
//! sends that key.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use keystone_sync::client::ProxyResponse;
use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::dto::api::{ApiBody, ApiResponseDto, ResponseSource};

const JSON: &str = "application/json";

/// `ApiResponse::success`: `meta` is left out when empty.
pub fn success(data: Value, meta: Map<String, Value>) -> Value {
    let mut body = Map::new();
    body.insert("data".into(), data);
    if !meta.is_empty() {
        body.insert("meta".into(), Value::Object(meta));
    }
    Value::Object(body)
}

/// `ApiResponse::paginated`: `last_page` is `ceil(total / per_page)`, at
/// least 1 (Laravel `LengthAwarePaginator::lastPage`).
pub fn paginated(rows: Vec<Value>, current_page: u64, per_page: u64, total: u64) -> Value {
    let last_page = if per_page == 0 {
        1
    } else {
        total.div_ceil(per_page).max(1)
    };
    let mut meta = Map::new();
    meta.insert(
        "pagination".into(),
        json!({
            "current_page": current_page,
            "per_page": per_page,
            "total": total,
            "last_page": last_page,
        }),
    );
    success(Value::Array(rows), meta)
}

/// `ApiResponse::error`: `fields` only when given.
pub fn error(code: &str, message: &str, fields: Option<Map<String, Value>>) -> Value {
    let mut error = Map::new();
    error.insert("message".into(), Value::String(message.to_owned()));
    error.insert("code".into(), Value::String(code.to_owned()));
    if let Some(fields) = fields {
        error.insert("fields".into(), Value::Object(fields));
    }
    json!({ "errors": error })
}

/// Freshness of a local answer, under `meta.offline`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct OfflineMeta {
    /// When the local copy was last brought in line with the server
    /// (ISO 8601), when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub as_of: Option<String>,
    /// The local copy is still downloading: rows are a subset.
    pub partial: bool,
    /// Shown instead of a server answer that did not come: may be old.
    pub stale: bool,
    /// The answer is a queued draft, not yet sent.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pending: bool,
    /// Filters of the request the local copy cannot apply.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unsupported_filters: Vec<String>,
}

/// Adds `meta.offline` to an envelope (success or error), keeping any
/// other `meta` keys.
pub fn with_offline(mut body: Value, offline: &OfflineMeta) -> Value {
    if let Value::Object(map) = &mut body {
        let meta = map
            .entry("meta")
            .or_insert_with(|| Value::Object(Map::new()));
        if let Value::Object(meta) = meta {
            meta.insert(
                "offline".into(),
                serde_json::to_value(offline).unwrap_or(Value::Null),
            );
        }
    }
    body
}

/// A local JSON answer.
pub fn local(status: u16, body: Value) -> ApiResponseDto {
    ApiResponseDto {
        status,
        headers: vec![("content-type".into(), JSON.into())],
        body: Some(ApiBody::Json { value: body }),
        source: ResponseSource::Local,
    }
}

/// The server's answer, body typed by its `content-type`: JSON types
/// parsed, `text/*` as text, anything else (or a body that does not match
/// its type) as base64.
pub fn from_proxy(response: ProxyResponse) -> ApiResponseDto {
    let content_type = response
        .header("content-type")
        .map(|value| value.to_ascii_lowercase());
    let body = if response.body.is_empty() {
        None
    } else {
        Some(body_of(content_type.as_deref(), response.body))
    };
    ApiResponseDto {
        status: response.status,
        headers: response.headers,
        body,
        source: ResponseSource::Network,
    }
}

fn body_of(content_type: Option<&str>, bytes: Vec<u8>) -> ApiBody {
    let essence = content_type
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or("");
    let json = essence == JSON || essence.ends_with("+json");
    if json && let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
        return ApiBody::Json { value };
    }
    if json || essence.starts_with("text/") {
        match String::from_utf8(bytes) {
            Ok(value) => return ApiBody::Text { value },
            Err(error) => return binary(&error.into_bytes()),
        }
    }
    binary(&bytes)
}

fn binary(bytes: &[u8]) -> ApiBody {
    ApiBody::Binary {
        base64: STANDARD.encode(bytes),
    }
}

/// Bytes of a request body: JSON serialized, text as UTF-8, binary decoded.
pub fn request_bytes(body: &ApiBody) -> Result<Vec<u8>, String> {
    match body {
        ApiBody::Json { value } => serde_json::to_vec(value).map_err(|e| e.to_string()),
        ApiBody::Text { value } => Ok(value.clone().into_bytes()),
        ApiBody::Binary { base64 } => STANDARD
            .decode(base64)
            .map_err(|_| "binary body is not valid base64".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proxy(content_type: Option<&str>, body: &[u8]) -> ProxyResponse {
        ProxyResponse {
            status: 200,
            headers: content_type
                .map(|ct| vec![("content-type".to_owned(), ct.to_owned())])
                .unwrap_or_default(),
            body: body.to_vec(),
        }
    }

    #[test]
    fn success_leaves_out_empty_meta() {
        assert_eq!(
            success(json!({ "id": 1 }), Map::new()),
            json!({ "data": { "id": 1 } })
        );
        let mut meta = Map::new();
        meta.insert("x".into(), json!(1));
        assert_eq!(
            success(json!([]), meta),
            json!({ "data": [], "meta": { "x": 1 } })
        );
    }

    #[test]
    fn paginated_matches_length_aware_paginator() {
        assert_eq!(
            paginated(vec![json!({ "id": 1 })], 2, 25, 51),
            json!({
                "data": [{ "id": 1 }],
                "meta": { "pagination": {
                    "current_page": 2, "per_page": 25, "total": 51, "last_page": 3
                } }
            })
        );
        let empty = paginated(Vec::new(), 1, 25, 0);
        assert_eq!(empty["meta"]["pagination"]["last_page"], 1);
        let exact = paginated(Vec::new(), 1, 25, 50);
        assert_eq!(exact["meta"]["pagination"]["last_page"], 2);
        let zero = paginated(Vec::new(), 1, 0, 10);
        assert_eq!(zero["meta"]["pagination"]["last_page"], 1);
    }

    #[test]
    fn error_has_message_code_and_optional_fields() {
        assert_eq!(
            error("OFFLINE_UNAVAILABLE", "not offline", None),
            json!({ "errors": { "message": "not offline", "code": "OFFLINE_UNAVAILABLE" } })
        );
        let mut fields = Map::new();
        fields.insert("name".into(), json!(["required"]));
        assert_eq!(
            error("VALIDATION_ERROR", "invalid", Some(fields)),
            json!({ "errors": {
                "message": "invalid", "code": "VALIDATION_ERROR", "fields": { "name": ["required"] }
            } })
        );
    }

    #[test]
    fn offline_meta_is_added_next_to_other_meta() {
        let body = paginated(Vec::new(), 1, 25, 0);
        let body = with_offline(
            body,
            &OfflineMeta {
                as_of: Some("2026-10-27T10:00:00+03:00".into()),
                partial: true,
                stale: false,
                ..OfflineMeta::default()
            },
        );
        assert_eq!(body["meta"]["pagination"]["total"], 0);
        assert_eq!(
            body["meta"]["offline"],
            json!({ "as_of": "2026-10-27T10:00:00+03:00", "partial": true, "stale": false })
        );

        let refused = with_offline(
            error("OFFLINE_UNAVAILABLE", "x", None),
            &OfflineMeta {
                unsupported_filters: vec!["filter[city]".into()],
                pending: true,
                ..OfflineMeta::default()
            },
        );
        assert_eq!(refused["errors"]["code"], "OFFLINE_UNAVAILABLE");
        assert_eq!(
            refused["meta"]["offline"],
            json!({
                "partial": false, "stale": false, "pending": true,
                "unsupported_filters": ["filter[city]"]
            })
        );
    }

    #[test]
    fn local_answer_is_json_from_this_device() {
        let answer = local(503, error("OFFLINE_UNAVAILABLE", "x", None));
        assert_eq!(answer.status, 503);
        assert_eq!(answer.source, ResponseSource::Local);
        assert_eq!(answer.header("content-type"), Some("application/json"));
        assert_eq!(
            answer.json().unwrap()["errors"]["code"],
            "OFFLINE_UNAVAILABLE"
        );
    }

    #[test]
    fn server_body_is_typed_by_content_type() {
        let answer = from_proxy(proxy(
            Some("application/json; charset=UTF-8"),
            br#"{"data":[]}"#,
        ));
        assert_eq!(answer.source, ResponseSource::Network);
        assert_eq!(answer.json(), Some(&json!({ "data": [] })));

        let problem = from_proxy(proxy(Some("application/problem+json"), br#"{"a":1}"#));
        assert_eq!(problem.json(), Some(&json!({ "a": 1 })));

        let text = from_proxy(proxy(Some("text/csv"), b"a;b\n1;2"));
        assert_eq!(
            text.body,
            Some(ApiBody::Text {
                value: "a;b\n1;2".into()
            })
        );

        let pdf = from_proxy(proxy(Some("application/pdf"), b"%PDF"));
        assert_eq!(
            pdf.body,
            Some(ApiBody::Binary {
                base64: "JVBERg==".into()
            })
        );

        let untyped = from_proxy(proxy(None, b"{}"));
        assert!(matches!(untyped.body, Some(ApiBody::Binary { .. })));

        let broken_json = from_proxy(proxy(Some("application/json"), b"<html>oops"));
        assert_eq!(
            broken_json.body,
            Some(ApiBody::Text {
                value: "<html>oops".into()
            })
        );

        let not_utf8 = from_proxy(proxy(Some("text/plain"), &[0xff, 0xfe]));
        assert!(matches!(not_utf8.body, Some(ApiBody::Binary { .. })));

        let empty = from_proxy(ProxyResponse {
            status: 204,
            headers: Vec::new(),
            body: Vec::new(),
        });
        assert_eq!((empty.status, empty.body), (204, None));
    }

    #[test]
    fn server_status_and_headers_are_kept() {
        let answer = from_proxy(ProxyResponse {
            status: 422,
            headers: vec![
                ("content-type".into(), "application/json".into()),
                ("x-request-id".into(), "r1".into()),
            ],
            body: br#"{"errors":{"message":"m","code":"VALIDATION_ERROR"}}"#.to_vec(),
        });
        assert_eq!(answer.status, 422);
        assert_eq!(answer.header("x-request-id"), Some("r1"));
        assert_eq!(
            answer.json().unwrap()["errors"]["code"],
            json!("VALIDATION_ERROR")
        );
    }

    #[test]
    fn request_bodies_become_bytes() {
        assert_eq!(
            request_bytes(&ApiBody::Json {
                value: json!({ "a": 1 })
            })
            .unwrap(),
            br#"{"a":1}"#
        );
        assert_eq!(
            request_bytes(&ApiBody::Text { value: "hi".into() }).unwrap(),
            b"hi"
        );
        assert_eq!(
            request_bytes(&ApiBody::Binary {
                base64: "JVBERg==".into()
            })
            .unwrap(),
            b"%PDF"
        );
        assert!(
            request_bytes(&ApiBody::Binary {
                base64: "not base64!".into()
            })
            .is_err()
        );
    }
}
