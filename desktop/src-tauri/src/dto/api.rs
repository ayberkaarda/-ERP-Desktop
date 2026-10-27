//! `api_request`: the request the webview sends and the answer it gets.
//!
//! The answer is either the server's (status, allowed headers, body as
//! received) or a local one built in the same Laravel envelope
//! (`{data, meta}` / `{errors}`), told apart by [`ResponseSource`].

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

/// One `/api/v1` request of the UI.
///
/// ```json
/// {"method": "GET", "path": "/api/v1/parties",
///  "query": [["page", "1"]], "headers": [["Accept-Language", "tr"]],
///  "body": {"kind": "json", "value": {"name": "Acme"}}}
/// ```
#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
#[serde(deny_unknown_fields)]
pub struct ApiRequestDto {
    /// `GET`, `POST`, `PUT`, `PATCH` or `DELETE` (any case).
    pub method: String,
    /// Full path under `/api/v1/`, without query or fragment.
    pub path: String,
    /// Query pairs in order; a name may repeat (`filter[status][]`).
    #[serde(default)]
    #[ts(as = "Option<Vec<(String, String)>>", optional)]
    pub query: Vec<(String, String)>,
    /// Only `idempotency-key`, `accept-language`, `if-none-match` and
    /// `content-type` are passed on; other names are dropped.
    #[serde(default)]
    #[ts(as = "Option<Vec<(String, String)>>", optional)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    #[ts(optional)]
    pub body: Option<ApiBody>,
}

/// A request or response body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ApiBody {
    /// JSON (`application/json` and `+json` types).
    Json {
        #[ts(type = "unknown")]
        value: Value,
    },
    /// UTF-8 text (`text/*`).
    Text { value: String },
    /// Anything else (PDF, spreadsheets, images), standard base64 with padding.
    Binary { base64: String },
}

/// Where an answer came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
#[serde(rename_all = "snake_case")]
pub enum ResponseSource {
    /// The server answered (any status).
    Network,
    /// Answered on this device: local data, a queued draft or an offline
    /// refusal. `meta.offline` (when present) says how fresh it is.
    Local,
}

/// The answer to an [`ApiRequestDto`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct ApiResponseDto {
    pub status: u16,
    /// Lowercase names: `content-type`, `content-disposition`, `etag`,
    /// `retry-after`, `x-request-id`, in arrival order.
    pub headers: Vec<(String, String)>,
    /// `None` for an empty body (204).
    pub body: Option<ApiBody>,
    pub source: ResponseSource,
}

impl ApiResponseDto {
    /// First value of `name` (any case).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    /// The JSON body, when there is one.
    pub fn json(&self) -> Option<&Value> {
        match &self.body {
            Some(ApiBody::Json { value }) => Some(value),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_reads_the_documented_shape() {
        let request: ApiRequestDto = serde_json::from_value(json!({
            "method": "post",
            "path": "/api/v1/parties",
            "query": [["page", "2"], ["filter[status][]", "active"]],
            "headers": [["Idempotency-Key", "k1"]],
            "body": { "kind": "json", "value": { "name": "Acme" } }
        }))
        .unwrap();
        assert_eq!(request.method, "post");
        assert_eq!(request.query[1].0, "filter[status][]");
        assert_eq!(
            request.body,
            Some(ApiBody::Json {
                value: json!({ "name": "Acme" })
            })
        );

        let minimal: ApiRequestDto =
            serde_json::from_value(json!({ "method": "GET", "path": "/api/v1/parties" })).unwrap();
        assert!(minimal.query.is_empty() && minimal.headers.is_empty() && minimal.body.is_none());
    }

    #[test]
    fn unknown_request_fields_are_refused() {
        let extra = serde_json::from_value::<ApiRequestDto>(json!({
            "method": "GET", "path": "/api/v1/parties", "url": "https://elsewhere.example"
        }));
        assert!(extra.is_err());
        let body = serde_json::from_value::<ApiBody>(json!({ "kind": "file", "path": "C:/x" }));
        assert!(body.is_err());
    }

    #[test]
    fn response_serializes_with_tagged_body_and_source() {
        let response = ApiResponseDto {
            status: 200,
            headers: vec![("content-type".into(), "application/pdf".into())],
            body: Some(ApiBody::Binary {
                base64: "JVBERg==".into(),
            }),
            source: ResponseSource::Network,
        };
        assert_eq!(
            serde_json::to_value(&response).unwrap(),
            json!({
                "status": 200,
                "headers": [["content-type", "application/pdf"]],
                "body": { "kind": "binary", "base64": "JVBERg==" },
                "source": "network"
            })
        );
        assert_eq!(response.header("Content-Type"), Some("application/pdf"));
        assert_eq!(response.json(), None);
    }
}
