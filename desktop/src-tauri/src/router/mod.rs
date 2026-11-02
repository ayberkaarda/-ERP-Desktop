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
#[cfg(test)]
mod session_tests;

use std::collections::{HashMap, HashSet};
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

    /// The kept answer of `GET /auth/me` for the current sign-in, when the
    /// server cannot be reached. `None`: nothing this device may show.
    fn session(&self, _engine: &Engine) -> CommandResult<Option<ApiResponseDto>> {
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

/// At most one probe per profile in this time is asked for by requests
/// answered offline ([`Connectivity::probe_due`]).
pub const PROBE_INTERVAL: Duration = Duration::from_secs(2);

/// How long a request that would be refused offline, and `sync_now`, wait
/// for the verdict of the probe they asked for.
pub const PROBE_WAIT: Duration = Duration::from_secs(3);

/// Online or offline, per profile: the last proxy result while it is
/// fresh (an answer: online; a connection that could not be made: offline;
/// a slow or cut-off answer is not recorded) ([`OBSERVATION_TTL`]), else the engine (`SyncState::Offline`),
/// else online (the proxy finds out).
///
/// A clone shares the same view. A result that turns a profile from
/// reachable to unreachable or back is announced once to [`Connectivity::subscribe`]
/// ([`ConnectivityChange`]); a profile counts as reachable until a result
/// says otherwise.
#[derive(Debug, Clone)]
pub struct Connectivity {
    shared: Arc<Shared>,
}

#[derive(Debug)]
struct Shared {
    seen: Mutex<Seen>,
    changes: tokio::sync::broadcast::Sender<ConnectivityChange>,
}

#[derive(Debug, Default)]
struct Seen {
    last: Option<Observation>,
    /// Profiles last announced unreachable. Any other profile was last
    /// announced reachable, or never, and counts as reachable.
    told_offline: HashSet<String>,
    /// When a probe was last granted, per profile.
    probed: HashMap<String, Instant>,
}

#[derive(Debug, Clone)]
struct Observation {
    profile: String,
    at: Instant,
    reachable: bool,
}

/// The server of `profile` became reachable (`online`) or unreachable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectivityChange {
    pub profile: String,
    pub online: bool,
}

impl Default for Connectivity {
    fn default() -> Self {
        let (changes, _) = tokio::sync::broadcast::channel(16);
        Self {
            shared: Arc::new(Shared {
                seen: Mutex::default(),
                changes,
            }),
        }
    }
}

impl Connectivity {
    /// `engine_offline`: `None` when the profile has no engine.
    pub fn online(&self, profile: &str, engine_offline: Option<bool>, now: Instant) -> bool {
        let seen = self.seen();
        if let Some(seen) = seen.last.as_ref()
            && seen.profile == profile
            && now.saturating_duration_since(seen.at) < OBSERVATION_TTL
        {
            return seen.reachable;
        }
        !engine_offline.unwrap_or(false)
    }

    /// Records whether the server of `profile` answered; announces a change.
    pub fn observe(&self, profile: &str, reachable: bool, now: Instant) {
        let mut seen = self.seen();
        seen.last = Some(Observation {
            profile: profile.to_owned(),
            at: now,
            reachable,
        });
        let changed = if reachable {
            seen.told_offline.remove(profile)
        } else {
            seen.told_offline.insert(profile.to_owned())
        };
        if changed {
            // Sent under the lock: changes go out in the order they happened.
            let _ = self.shared.changes.send(ConnectivityChange {
                profile: profile.to_owned(),
                online: reachable,
            });
        }
    }

    /// Drops what was announced for `profile` (removed or signed out).
    pub fn forget(&self, profile: &str) {
        let mut seen = self.seen();
        seen.told_offline.remove(profile);
        seen.probed.remove(profile);
    }

    /// Whether a request answered offline for `profile` may ask the engine
    /// for a probe now: at most once per [`PROBE_INTERVAL`]. A grant counts
    /// from `now`.
    pub fn probe_due(&self, profile: &str, now: Instant) -> bool {
        let mut seen = self.seen();
        let due = seen
            .probed
            .get(profile)
            .is_none_or(|at| now.saturating_duration_since(*at) >= PROBE_INTERVAL);
        if due {
            seen.probed.insert(profile.to_owned(), now);
        }
        due
    }

    /// Changes from now on.
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<ConnectivityChange> {
        self.shared.changes.subscribe()
    }

    fn seen(&self) -> std::sync::MutexGuard<'_, Seen> {
        self.shared
            .seen
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
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

    fn changes(
        rx: &mut tokio::sync::broadcast::Receiver<ConnectivityChange>,
    ) -> Vec<(String, bool)> {
        std::iter::from_fn(|| rx.try_recv().ok())
            .map(|change| (change.profile, change.online))
            .collect()
    }

    #[test]
    fn only_a_change_of_reachability_is_announced() {
        let c = Connectivity::default();
        let mut rx = c.subscribe();
        let now = Instant::now();
        // Reachable is what a profile starts as: nothing to tell.
        c.observe("p1", true, now);
        assert!(changes(&mut rx).is_empty());
        c.observe("p1", false, now);
        c.observe("p1", false, now);
        c.observe("p1", true, now);
        c.observe("p1", true, now);
        c.observe("p1", false, now);
        assert_eq!(
            changes(&mut rx),
            [
                ("p1".into(), false),
                ("p1".into(), true),
                ("p1".into(), false)
            ]
        );
    }

    #[test]
    fn changes_name_their_profile_and_clones_share_them() {
        let c = Connectivity::default();
        let shared = c.clone();
        let mut rx = c.subscribe();
        let now = Instant::now();
        shared.observe("p1", false, now);
        // Another profile starts reachable: its first failure is a change.
        shared.observe("p2", true, now);
        shared.observe("p2", false, now);
        assert_eq!(
            changes(&mut rx),
            [("p1".into(), false), ("p2".into(), false)]
        );
        assert!(!c.online("p2", Some(false), now));
    }

    #[test]
    fn the_return_of_a_profile_is_told_after_another_profile_fails() {
        let c = Connectivity::default();
        let mut rx = c.subscribe();
        let now = Instant::now();
        c.observe("p1", false, now);
        c.observe("p2", false, now);
        c.observe("p1", true, now);
        assert_eq!(
            changes(&mut rx),
            [
                ("p1".into(), false),
                ("p2".into(), false),
                ("p1".into(), true)
            ]
        );
    }

    #[test]
    fn each_profile_returns_on_its_own() {
        let c = Connectivity::default();
        let mut rx = c.subscribe();
        let now = Instant::now();
        c.observe("p1", false, now);
        c.observe("p2", false, now);
        c.observe("p2", true, now);
        c.observe("p1", true, now);
        assert_eq!(
            changes(&mut rx),
            [
                ("p1".into(), false),
                ("p2".into(), false),
                ("p2".into(), true),
                ("p1".into(), true)
            ]
        );
    }

    #[test]
    fn a_state_told_once_is_not_told_again_between_other_profiles() {
        let c = Connectivity::default();
        let mut rx = c.subscribe();
        let now = Instant::now();
        c.observe("p1", false, now);
        c.observe("p2", false, now);
        c.observe("p1", false, now);
        c.observe("p2", false, now);
        c.observe("p2", true, now);
        c.observe("p1", false, now);
        c.observe("p2", true, now);
        assert_eq!(
            changes(&mut rx),
            [
                ("p1".into(), false),
                ("p2".into(), false),
                ("p2".into(), true)
            ]
        );
    }

    #[test]
    fn a_forgotten_profile_starts_reachable_again() {
        let c = Connectivity::default();
        let mut rx = c.subscribe();
        let now = Instant::now();
        c.observe("p2", false, now);
        c.observe("p1", false, now);
        c.forget("p1");
        // Reachable is where a forgotten profile starts: nothing to tell.
        c.observe("p1", true, now);
        c.observe("p1", false, now);
        // The other profile keeps what it was told.
        c.observe("p2", false, now);
        c.observe("p2", true, now);
        assert_eq!(
            changes(&mut rx),
            [
                ("p2".into(), false),
                ("p1".into(), false),
                ("p1".into(), false),
                ("p2".into(), true)
            ]
        );
        // Only p1 is unreachable now; forgetting it leaves nothing kept.
        assert_eq!(c.seen().told_offline.len(), 1);
        c.forget("p1");
        c.forget("never-seen");
        assert!(c.seen().told_offline.is_empty());
    }

    #[test]
    fn probes_are_granted_at_most_once_per_interval_and_profile() {
        let c = Connectivity::default();
        let now = Instant::now();
        assert!(c.probe_due("p1", now));
        assert!(!c.probe_due("p1", now));
        assert!(!c.probe_due("p1", now + PROBE_INTERVAL - Duration::from_millis(1)));
        // Another profile has its own interval.
        assert!(c.probe_due("p2", now));
        assert!(c.probe_due("p1", now + PROBE_INTERVAL));
        // A refused ask does not move the interval.
        assert!(!c.probe_due("p1", now + PROBE_INTERVAL + Duration::from_secs(1)));
        assert!(c.probe_due("p1", now + PROBE_INTERVAL * 2));
        // A forgotten profile starts again.
        c.forget("p2");
        assert!(c.probe_due("p2", now));
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
