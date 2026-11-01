//! Routing of `api_request`: the path table and decision ([`decide`]), the
//! Laravel envelope of local answers ([`envelope`]), the connectivity view
//! ([`Connectivity`]) and the door for local answers ([`LocalResolver`]).
//!
//! [`local_resolver`] answers from the mirror and the snapshots
//! ([`local_read`]) and queues drafts in the outbox ([`local_write`]);
//! [`query_map`] says which list parameters the local copy can apply.

pub mod decide;
pub mod envelope;
pub mod local_read;
#[cfg(test)]
mod local_support;
mod local_write;
mod query_map;

use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use keystone_sync::client::ProxyMethod;
use keystone_sync::store::{LocalCopy, Store};
use keystone_sync::wire::ResourceName;
use serde_json::Value;

pub use decide::{
    Decision, Facts, LocalPlan, ONLINE_FIRST_DEADLINE, OfflineWrites, Refusal, Router, Target,
    TargetKind,
};

use crate::commands::CommandResult;
use crate::dto::api::ApiResponseDto;
use crate::state::Engine;

/// A validated `api_request`, as the proxy and the local resolver take it.
#[derive(Clone, PartialEq)]
pub struct ApiCall {
    pub method: ProxyMethod,
    /// Full path under `/api/v1/`, plain segments only.
    pub path: String,
    pub query: Vec<(String, String)>,
    /// Allowed request headers only, lowercase names.
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
}

impl ApiCall {
    /// First value of `name` (any case).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    /// The body parsed as JSON, when there is one.
    pub fn json_body(&self) -> Option<serde_json::Result<Value>> {
        self.body.as_deref().map(serde_json::from_slice)
    }
}

/// Neither query values, header values nor the body are printed.
impl std::fmt::Debug for ApiCall {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let query: Vec<&str> = self.query.iter().map(|(n, _)| n.as_str()).collect();
        let headers: Vec<&str> = self.headers.iter().map(|(n, _)| n.as_str()).collect();
        f.debug_struct("ApiCall")
            .field("method", &self.method)
            .field("path", &self.path)
            .field("query", &query)
            .field("headers", &headers)
            .field("body_len", &self.body.as_ref().map(Vec::len))
            .finish()
    }
}

/// What the local resolver made of a [`LocalPlan`].
#[derive(Debug, Clone, PartialEq)]
pub enum LocalOutcome {
    /// A local answer in the Laravel envelope (data, draft or a refusal
    /// such as `DOCUMENT_LOCKED`), see [`envelope`].
    Answer(ApiResponseDto),
    /// The local copy cannot answer this request (a filter it does not
    /// index, a snapshot that was never fetched). Online, the request goes
    /// to the server; offline, it is `OFFLINE_UNAVAILABLE` with these
    /// filters in `meta.offline.unsupported_filters`.
    Unsupported { unsupported_filters: Vec<String> },
}

/// Answers requests on this device. Called on a blocking thread
/// (`spawn_blocking`): store work may block.
pub trait LocalResolver: Send + Sync + 'static {
    /// State of the local copy of `resource`. `store` is the one `engine`
    /// works on, of the same profile (`None`: not attached).
    fn local_copy(
        &self,
        engine: &Engine,
        store: Option<&Store>,
        resource: &ResourceName,
    ) -> CommandResult<LocalCopy>;

    /// Carries out `plan` for `call`.
    fn resolve(
        &self,
        engine: &Engine,
        store: Option<&Store>,
        plan: &LocalPlan,
        call: &ApiCall,
    ) -> CommandResult<LocalOutcome>;

    /// The answer to a write whose `Idempotency-Key` this device has seen
    /// already. Asked before any routing: online too, a repeat of a pushed
    /// draft must not reach the server as a new request.
    fn replay(&self, _engine: &Engine, _call: &ApiCall) -> CommandResult<Option<ApiResponseDto>> {
        Ok(None)
    }
}

/// No local copy of anything: online requests go to the server, offline
/// ones are refused.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoLocalCopy;

impl LocalResolver for NoLocalCopy {
    fn local_copy(
        &self,
        _: &Engine,
        _: Option<&Store>,
        _: &ResourceName,
    ) -> CommandResult<LocalCopy> {
        Ok(LocalCopy::Missing)
    }

    fn resolve(
        &self,
        _: &Engine,
        _: Option<&Store>,
        _: &LocalPlan,
        _: &ApiCall,
    ) -> CommandResult<LocalOutcome> {
        Ok(LocalOutcome::Unsupported {
            unsupported_filters: Vec::new(),
        })
    }
}

/// The resolver `api_request` uses.
pub fn local_resolver() -> Arc<dyn LocalResolver> {
    Arc::new(local_read::LocalAnswers)
}

/// How long a proxy result decides online/offline before the engine
/// status takes over again.
pub const OBSERVATION_TTL: Duration = Duration::from_secs(30);

/// Online or offline, per profile: the last proxy result while it is
/// fresh (an answer: online; a connection that could not be made: offline;
/// a slow or cut-off answer is not recorded) ([`OBSERVATION_TTL`]), else the engine (`SyncState::Offline`),
/// else online (the proxy finds out).
#[derive(Debug, Default)]
pub struct Connectivity {
    last: Mutex<Option<Observation>>,
}

#[derive(Debug, Clone)]
struct Observation {
    profile: String,
    at: Instant,
    reachable: bool,
}

impl Connectivity {
    /// `engine_offline`: `None` when the profile has no engine.
    pub fn online(&self, profile: &str, engine_offline: Option<bool>, now: Instant) -> bool {
        let last = self.last.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(seen) = last.as_ref()
            && seen.profile == profile
            && now.saturating_duration_since(seen.at) < OBSERVATION_TTL
        {
            return seen.reachable;
        }
        !engine_offline.unwrap_or(false)
    }

    /// Records whether the server of `profile` answered.
    pub fn observe(&self, profile: &str, reachable: bool, now: Instant) {
        let mut last = self.last.lock().unwrap_or_else(PoisonError::into_inner);
        *last = Some(Observation {
            profile: profile.to_owned(),
            at: now,
            reachable,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_decides_without_a_fresh_observation() {
        let c = Connectivity::default();
        let now = Instant::now();
        assert!(c.online("p1", None, now));
        assert!(c.online("p1", Some(false), now));
        assert!(!c.online("p1", Some(true), now));
    }

    #[test]
    fn a_fresh_proxy_result_wins_over_the_engine() {
        let c = Connectivity::default();
        let now = Instant::now();
        c.observe("p1", false, now);
        assert!(!c.online("p1", Some(false), now + Duration::from_secs(1)));
        c.observe("p1", true, now);
        assert!(c.online("p1", Some(true), now + Duration::from_secs(1)));
    }

    #[test]
    fn observations_expire_and_belong_to_one_profile() {
        let c = Connectivity::default();
        let now = Instant::now();
        c.observe("p1", false, now);
        assert!(c.online("p1", Some(false), now + OBSERVATION_TTL));
        assert!(c.online("p2", None, now));
    }

    #[test]
    fn call_debug_hides_values() {
        let call = ApiCall {
            method: ProxyMethod::Post,
            path: "/api/v1/parties".into(),
            query: vec![("search".into(), "Ayşe Yılmaz".into())],
            headers: vec![("idempotency-key".into(), "secret-key".into())],
            body: Some(br#"{"tax_number":"1234567890"}"#.to_vec()),
        };
        let text = format!("{call:?}");
        for hidden in ["Ayşe", "secret-key", "1234567890"] {
            assert!(!text.contains(hidden), "{text}");
        }
        assert_eq!(call.header("Idempotency-Key"), Some("secret-key"));
        assert_eq!(
            call.json_body().unwrap().unwrap()["tax_number"],
            "1234567890"
        );
    }
}
