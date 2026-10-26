//! Profile base URL and endpoint paths. Only `https://host[:port]` is
//! accepted (plain http only for loopback hosts, and only when the caller
//! opts in, e.g. tests), and only paths under `/api/v1/`.

use reqwest::Url;

use crate::error::{Result, SyncError};

use super::API_PREFIX;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerUrl {
    origin: Url,
}

impl ServerUrl {
    /// `base_url` is scheme, host and optional port, e.g.
    /// `https://erp.example.com`. A trailing `/` is accepted; any other path,
    /// a query, a fragment or credentials are rejected.
    pub fn parse(base_url: &str, allow_http_localhost: bool) -> Result<Self> {
        let raw = base_url.trim();
        // Checked on the raw text: `Url` would normalize `/a/..` or `/%2e%2e` to `/`.
        let after_scheme = raw
            .split_once("://")
            .map(|(_, rest)| rest)
            .ok_or_else(|| invalid("scheme is missing"))?;
        let tail = after_scheme
            .find(['/', '\\', '?', '#'])
            .map_or("", |at| &after_scheme[at..]);
        if !matches!(tail, "" | "/") {
            return Err(invalid(
                "the base URL must be scheme://host[:port] (no path, query or fragment)",
            ));
        }
        let url = Url::parse(raw).map_err(|e| invalid(format!("{e}")))?;
        match url.scheme() {
            "https" => {}
            "http" if allow_http_localhost && is_loopback(&url) => {}
            "http" => return Err(invalid("https is required")),
            other => return Err(invalid(format!("scheme {other:?} is not allowed"))),
        }
        if url.host_str().is_none_or(str::is_empty) {
            return Err(invalid("host is missing"));
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err(invalid("credentials are not allowed in the URL"));
        }
        if url.query().is_some() || url.fragment().is_some() {
            return Err(invalid("query and fragment are not allowed"));
        }
        if !matches!(url.path(), "" | "/") {
            return Err(invalid(
                "the base URL must not have a path (paths come from the client)",
            ));
        }
        Ok(Self { origin: url })
    }

    /// `scheme://host[:port]` of the profile.
    pub fn origin(&self) -> String {
        self.origin.origin().ascii_serialization()
    }

    /// Absolute URL of an endpoint. `path` must start with `/api/v1/` and
    /// consist of plain segments (no `.`/`..`, no empty segment, no query,
    /// no percent escapes).
    pub fn endpoint(&self, path: &str) -> Result<Url> {
        let rest = path
            .strip_prefix(API_PREFIX)
            .and_then(|rest| rest.strip_prefix('/'))
            .ok_or_else(|| invalid(format!("path must start with {API_PREFIX}/")))?;
        let plain = rest.split('/').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && segment
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~'))
        });
        if !plain {
            return Err(invalid("path has a disallowed segment"));
        }
        let mut url = self.origin.clone();
        url.set_path(path);
        if url.path() != path || url.origin() != self.origin.origin() {
            return Err(invalid("path changed the target"));
        }
        Ok(url)
    }
}

fn is_loopback(url: &Url) -> bool {
    url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "[::1]"
    })
}

fn invalid(message: impl Into<String>) -> SyncError {
    SyncError::InvalidServerUrl(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_origins() {
        let url = ServerUrl::parse("https://erp.example.com/", false).unwrap();
        assert_eq!(url.origin(), "https://erp.example.com");
        assert_eq!(
            url.endpoint("/api/v1/sync/pull").unwrap().as_str(),
            "https://erp.example.com/api/v1/sync/pull"
        );
        assert!(ServerUrl::parse("https://erp.example.com:8443", false).is_ok());
    }

    #[test]
    fn rejects_bad_base_urls() {
        for base in [
            "http://erp.example.com",
            "http://localhost:8000",
            "ftp://erp.example.com",
            "https://user:pw@erp.example.com",
            "https://erp.example.com/erp",
            "https://erp.example.com/?a=1",
            "https://erp.example.com/#x",
            "erp.example.com",
        ] {
            assert!(ServerUrl::parse(base, false).is_err(), "{base}");
        }
        assert!(ServerUrl::parse("http://erp.example.com", true).is_err());
        assert!(ServerUrl::parse("http://localhost:8000", true).is_ok());
        assert!(ServerUrl::parse("http://127.0.0.1:8000", true).is_ok());
        assert!(ServerUrl::parse("http://[::1]:8000", true).is_ok());
    }

    #[test]
    fn rejects_paths_outside_the_api_prefix() {
        let url = ServerUrl::parse("https://erp.example.com", false).unwrap();
        for path in [
            "/api/v2/sync/pull",
            "/api/v1",
            "/api/v1/",
            "/api/v10/x",
            "api/v1/sync",
            "/api/v1/../admin",
            "/api/v1/./x",
            "/api/v1//x",
            "/api/v1/x?y=1",
            "/api/v1/x#y",
            "/api/v1/%2e%2e/x",
            "//evil.example/api/v1/x",
            "https://evil.example/api/v1/x",
            "/api/v1/x\\y",
        ] {
            let error = url.endpoint(path).unwrap_err();
            assert_eq!(error.code(), "INVALID_SERVER_URL", "{path}");
        }
    }
}
