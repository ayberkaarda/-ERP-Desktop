//! Socket URL from the server meta `reverb` block, and the TLS rule.

use std::net::{IpAddr, Ipv6Addr};

use url::Url;

/// `client` query value sent to Reverb.
pub const CLIENT_NAME: &str = "keystone-desktop";
/// Pusher protocol version spoken by this client.
pub const PROTOCOL_VERSION: u8 = 7;

/// The `reverb` block of `GET /api/v1/meta` (`wire::meta::ReverbMeta` in
/// keystone-sync), copied field by field by the shell so this crate does not
/// depend on keystone-sync.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReverbParams {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub scheme: Option<String>,
    pub key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    /// `wss://` (rustls, ring provider, OS trust store).
    Tls,
    /// `ws://`, debug builds with the dev flag on a loopback host only.
    Plain,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    #[error("realtime over plain ws is not allowed")]
    PlainTransportRefused,
    #[error("unknown realtime scheme `{0}`")]
    UnknownScheme(String),
    #[error("invalid realtime host")]
    InvalidHost,
    #[error("invalid realtime app key")]
    InvalidKey,
    #[error("only private channels are supported")]
    InvalidChannel,
}

/// A validated socket endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RealtimeConfig {
    url: Url,
    transport: Transport,
}

impl RealtimeConfig {
    /// `Ok(None)` when the key or host is missing (realtime disabled).
    ///
    /// `allow_dev_plain` is the shell's `KEYSTONE_DEV_ALLOW_HTTP=1` flag; it
    /// has no effect in release builds and only admits loopback hosts.
    pub fn from_params(
        params: &ReverbParams,
        app_version: &str,
        allow_dev_plain: bool,
    ) -> Result<Option<Self>, ConfigError> {
        let (Some(key), Some(host)) = (non_empty(&params.key), non_empty(&params.host)) else {
            return Ok(None);
        };
        let scheme = params
            .scheme
            .as_deref()
            .map(|s| s.trim().to_ascii_lowercase());
        let transport = match scheme.as_deref() {
            None | Some("" | "https" | "wss") => Transport::Tls,
            Some("http" | "ws") => Transport::Plain,
            Some(other) => return Err(ConfigError::UnknownScheme(other.to_owned())),
        };
        if transport == Transport::Plain
            && !plain_allowed(allow_dev_plain, cfg!(debug_assertions), host)
        {
            return Err(ConfigError::PlainTransportRefused);
        }
        if !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        {
            return Err(ConfigError::InvalidKey);
        }
        let (scheme, default_port) = match transport {
            Transport::Tls => ("wss", 443),
            Transport::Plain => ("ws", 80),
        };
        let port = params.port.unwrap_or(default_port);
        let host_part = match host.parse::<Ipv6Addr>() {
            Ok(v6) => format!("[{v6}]"),
            Err(_) if host.chars().any(forbidden_host_char) => {
                return Err(ConfigError::InvalidHost);
            }
            Err(_) => host.to_owned(),
        };
        let mut url = Url::parse(&format!("{scheme}://{host_part}:{port}/"))
            .map_err(|_| ConfigError::InvalidHost)?;
        if url.host_str().is_none() || !url.username().is_empty() {
            return Err(ConfigError::InvalidHost);
        }
        url.path_segments_mut()
            .map_err(|_| ConfigError::InvalidHost)?
            .clear()
            .push("app")
            .push(key);
        url.query_pairs_mut()
            .append_pair("protocol", &PROTOCOL_VERSION.to_string())
            .append_pair("client", CLIENT_NAME)
            .append_pair("version", app_version);
        Ok(Some(Self { url, transport }))
    }

    pub fn url(&self) -> &Url {
        &self.url
    }

    pub fn transport(&self) -> Transport {
        self.transport
    }

    /// `host:port` for logs.
    pub(crate) fn origin(&self) -> String {
        format!(
            "{}:{}",
            self.url.host_str().unwrap_or_default(),
            self.url.port_or_known_default().unwrap_or_default()
        )
    }
}

/// `private-user.{id}`, the per-user channel of the server.
pub fn user_channel(user_id: &str) -> String {
    format!("private-user.{user_id}")
}

pub(crate) fn validate_channel(name: &str) -> Result<(), ConfigError> {
    let rest = name
        .strip_prefix("private-")
        .ok_or(ConfigError::InvalidChannel)?;
    let ok = !rest.is_empty()
        && !rest.starts_with("encrypted-")
        && rest
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '=' | '@' | ','));
    if ok {
        Ok(())
    } else {
        Err(ConfigError::InvalidChannel)
    }
}

fn forbidden_host_char(c: char) -> bool {
    c.is_whitespace() || matches!(c, ':' | '/' | '@' | '?' | '#' | '[' | ']' | '\\' | '%')
}

/// Plain `ws` needs a debug build, the dev flag and a loopback host.
fn plain_allowed(flag: bool, debug_build: bool, host: &str) -> bool {
    flag && debug_build && is_loopback(host)
}

fn is_loopback(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

fn non_empty(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(scheme: Option<&str>, host: &str, port: Option<u16>) -> ReverbParams {
        ReverbParams {
            host: Some(host.into()),
            port,
            scheme: scheme.map(Into::into),
            key: Some("app-key".into()),
        }
    }

    #[test]
    fn builds_the_pusher_url() {
        let cfg = RealtimeConfig::from_params(
            &params(Some("https"), "ws.example.com", Some(8443)),
            "1.2.3",
            false,
        )
        .unwrap()
        .unwrap();
        assert_eq!(cfg.transport(), Transport::Tls);
        assert_eq!(
            cfg.url().as_str(),
            "wss://ws.example.com:8443/app/app-key?protocol=7&client=keystone-desktop&version=1.2.3"
        );
        assert_eq!(cfg.origin(), "ws.example.com:8443");
    }

    #[test]
    fn missing_scheme_and_port_mean_wss_443() {
        let cfg = RealtimeConfig::from_params(&params(None, "ws.example.com", None), "1", false)
            .unwrap()
            .unwrap();
        assert_eq!(cfg.url().scheme(), "wss");
        assert_eq!(cfg.url().port_or_known_default(), Some(443));
    }

    #[test]
    fn missing_key_or_host_disables() {
        let mut p = params(None, "ws.example.com", None);
        p.key = Some("  ".into());
        assert_eq!(RealtimeConfig::from_params(&p, "1", true), Ok(None));
        let mut p = params(None, "ws.example.com", None);
        p.host = None;
        assert_eq!(RealtimeConfig::from_params(&p, "1", true), Ok(None));
    }

    #[test]
    fn plain_ws_is_refused_without_the_dev_flag() {
        for scheme in ["http", "ws", "HTTP"] {
            assert_eq!(
                RealtimeConfig::from_params(
                    &params(Some(scheme), "127.0.0.1", Some(8080)),
                    "1",
                    false
                ),
                Err(ConfigError::PlainTransportRefused)
            );
        }
    }

    #[test]
    fn plain_ws_is_refused_for_non_loopback_hosts_even_with_the_flag() {
        for host in ["ws.example.com", "10.0.0.2", "localhost.evil.com"] {
            assert_eq!(
                RealtimeConfig::from_params(&params(Some("http"), host, None), "1", true),
                Err(ConfigError::PlainTransportRefused),
                "{host}"
            );
        }
    }

    #[test]
    fn plain_ws_with_flag_on_loopback_in_debug() {
        let cfg =
            RealtimeConfig::from_params(&params(Some("http"), "localhost", Some(8080)), "1", true)
                .unwrap()
                .unwrap();
        assert_eq!(cfg.transport(), Transport::Plain);
        assert!(
            cfg.url()
                .as_str()
                .starts_with("ws://localhost:8080/app/app-key?")
        );
        let v6 = RealtimeConfig::from_params(&params(Some("ws"), "::1", Some(8080)), "1", true)
            .unwrap()
            .unwrap();
        assert!(v6.url().as_str().starts_with("ws://[::1]:8080/app/"));
    }

    #[test]
    fn release_builds_never_allow_plain() {
        assert!(plain_allowed(true, true, "127.0.0.1"));
        assert!(!plain_allowed(true, false, "127.0.0.1"));
        assert!(!plain_allowed(false, true, "127.0.0.1"));
        assert!(!plain_allowed(true, true, "example.com"));
    }

    #[test]
    fn rejects_unknown_scheme_bad_host_and_bad_key() {
        assert_eq!(
            RealtimeConfig::from_params(&params(Some("ftp"), "h", None), "1", false),
            Err(ConfigError::UnknownScheme("ftp".into()))
        );
        for host in ["user@evil.com", "a/b", "h:1", "a b", "h?x", "h%2f"] {
            assert_eq!(
                RealtimeConfig::from_params(&params(None, host, None), "1", false),
                Err(ConfigError::InvalidHost),
                "{host}"
            );
        }
        let mut p = params(None, "h", None);
        p.key = Some("a/b?c".into());
        assert_eq!(
            RealtimeConfig::from_params(&p, "1", false),
            Err(ConfigError::InvalidKey)
        );
    }

    #[test]
    fn channel_rules() {
        assert_eq!(user_channel("01J"), "private-user.01J");
        assert!(validate_channel("private-user.01J").is_ok());
        for bad in [
            "user.1",
            "presence-company.1.online",
            "private-",
            "private-encrypted-x",
            "private-a b",
            "private-a\"b",
        ] {
            assert_eq!(
                validate_channel(bad),
                Err(ConfigError::InvalidChannel),
                "{bad}"
            );
        }
    }
}
