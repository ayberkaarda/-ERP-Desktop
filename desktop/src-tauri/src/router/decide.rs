//! Where an `api_request` is answered: [`Router::target`] maps the path to a
//! manifest resource, [`Router::decide`] picks the network, this device or
//! a refusal.
//!
//! The path table comes from `contracts/offline-manifest.json` (compiled in,
//! parsed at run time): every `resources[].path` (GET list),
//! `detail_path` (GET item), `children[]` paths and `write.ops[].route`.
//! A `{param}` segment matches a UUID only, so `/parties/duplicates` is not
//! the detail of a party. A path outside the table is online only.
//!
//! Reads follow the manifest `read` mode through
//! [`keystone_sync::store::read_route`] (docs/SYNC-PROTOCOL.md "Okuma
//! modları"); writes go to the server while online and, offline, to the
//! outbox when the resource allows that operation offline.

use std::time::Duration;

use keystone_sync::client::ProxyMethod;
use keystone_sync::store::{LocalCopy, ReadRoute, WritePolicy, read_route};
use keystone_sync::wire::{MutationOp, ReadMode, ResourceName, Source};
use serde_json::Value;
use uuid::Uuid;

/// The offline manifest the shell is built with.
pub const OFFLINE_MANIFEST: &str = include_str!("../../../../contracts/offline-manifest.json");

/// How long an `online-first` read waits for the server before it shows
/// the local copy.
pub const ONLINE_FIRST_DEADLINE: Duration = Duration::from_secs(5);

const PREFIX: &str = "/api/v1/";

#[derive(Debug, Clone, PartialEq, Eq)]
enum Segment {
    Literal(String),
    Param,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Route {
    method: ProxyMethod,
    segments: Vec<Segment>,
    resource: ResourceName,
    read: ReadMode,
    source: Source,
    kind: TargetKind,
    /// Whether the resource is a child (`items.variants`): its first path
    /// parameter is the parent id.
    child: bool,
}

/// What a request does to a manifest resource.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetKind {
    /// GET of the collection path.
    List,
    /// GET of the detail path.
    Item,
    /// A `write.ops[]` route.
    Write {
        op: MutationOp,
        action: Option<String>,
    },
}

/// A request matched to a manifest resource.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub resource: ResourceName,
    pub read: ReadMode,
    pub source: Source,
    pub kind: TargetKind,
    /// Row id: the last path parameter of an item or of a write on a row.
    pub id: Option<Uuid>,
    /// Parent row id of a child resource (`/items/{item}/variants`).
    pub parent_id: Option<Uuid>,
}

/// State the decision depends on, gathered by the command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Facts {
    pub online: bool,
    /// Local copy of the target resource (`Missing` when there is none or
    /// no local store).
    pub local_copy: LocalCopy,
    pub offline_writes: OfflineWrites,
}

/// Whether drafts can be queued on this device now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfflineWrites {
    Open,
    /// The compiled offline manifest differs from the server's: offline
    /// writes are closed (reads and online writes go on).
    ManifestMismatch,
    /// The profile has no open local store.
    NoLocalStore,
}

/// Work for the local resolver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalPlan {
    /// List (`id: None`) or row from the mirror, drafts laid over.
    Read {
        resource: ResourceName,
        id: Option<Uuid>,
        parent_id: Option<Uuid>,
        /// The local copy is still downloading.
        partial: bool,
        /// Shown in place of a server answer: may be old.
        stale: bool,
    },
    /// The stored snapshot of a `source: snapshot` resource, "as of" its time.
    Snapshot { resource: ResourceName },
    /// A draft into the outbox.
    Write {
        resource: ResourceName,
        op: MutationOp,
        action: Option<String>,
        /// Target row; `None` for create (the id is in the payload).
        id: Option<Uuid>,
        parent_id: Option<Uuid>,
    },
}

/// Why a request cannot be answered now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// Offline and nothing on this device answers it.
    Offline,
    /// Offline, and this operation of the resource is online only.
    OnlineOnlyWrite,
    /// Offline writes are closed by a manifest mismatch.
    ManifestMismatch,
}

impl Refusal {
    /// Code and HTTP status of the local error envelope.
    pub fn code_and_status(self) -> (&'static str, u16) {
        match self {
            Self::Offline | Self::OnlineOnlyWrite => ("OFFLINE_UNAVAILABLE", 503),
            Self::ManifestMismatch => ("SYNC_OFFLINE_WRITE_NOT_ALLOWED", 422),
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::Offline => "this is not available offline",
            Self::OnlineOnlyWrite => "this action is available only online",
            Self::ManifestMismatch => {
                "the offline manifest differs from the server; offline writes are closed"
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Send to the server. With `deadline`, stop waiting after it; with
    /// `fallback`, answer from this device when the server cannot be
    /// reached (network error or deadline).
    Online {
        deadline: Option<Duration>,
        fallback: Option<LocalPlan>,
    },
    /// Answer on this device. `else_online`: when the local copy cannot
    /// answer this request (an unsupported filter), send it to the server.
    Local {
        plan: LocalPlan,
        else_online: bool,
    },
    Refuse(Refusal),
}

impl Decision {
    const ONLINE: Self = Self::Online {
        deadline: None,
        fallback: None,
    };
}

/// The path table of the offline manifest.
#[derive(Debug, Clone)]
pub struct Router {
    routes: Vec<Route>,
}

impl Router {
    /// Table of [`OFFLINE_MANIFEST`].
    pub fn embedded() -> &'static Router {
        static ROUTER: std::sync::OnceLock<Router> = std::sync::OnceLock::new();
        ROUTER.get_or_init(|| {
            Router::from_manifest(OFFLINE_MANIFEST).expect("compiled offline manifest is valid")
        })
    }

    /// Reads the table from an offline manifest. Fails on a template that
    /// is not under `/api/v1/`, an unknown method or a duplicate route.
    pub fn from_manifest(json: &str) -> Result<Router, String> {
        let root: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let resources = root
            .get("resources")
            .and_then(Value::as_array)
            .ok_or("offline manifest has no resources")?;
        let mut routes: Vec<Route> = Vec::new();
        for entry in resources {
            let resource = name(entry)?;
            let read: ReadMode = serde_json::from_value(entry["read"].clone())
                .map_err(|e| format!("{resource}: read: {e}"))?;
            let source: Source = serde_json::from_value(entry["source"].clone())
                .map_err(|e| format!("{resource}: source: {e}"))?;
            let base = Base {
                resource,
                read,
                source,
                child: false,
            };
            reads(&mut routes, entry, &base)?;
            for op in entry
                .pointer("/write/ops")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let (method, path) = op["route"]
                    .as_str()
                    .and_then(|r| r.split_once(' '))
                    .ok_or_else(|| format!("{}: write route missing", base.resource))?;
                let mutation: MutationOp = serde_json::from_value(op["op"].clone())
                    .map_err(|e| format!("{}: op: {e}", base.resource))?;
                let action = op["action"].as_str().map(str::to_owned);
                let method = ProxyMethod::from_name(method)
                    .ok_or_else(|| format!("{}: method {method}", base.resource))?;
                push(
                    &mut routes,
                    &base,
                    method,
                    path,
                    TargetKind::Write {
                        op: mutation,
                        action,
                    },
                )?;
            }
            for child in entry
                .get("children")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let child_base = Base {
                    resource: name(child)?,
                    read,
                    source: Source::Pull,
                    child: true,
                };
                reads(&mut routes, child, &child_base)?;
            }
        }
        Ok(Router { routes })
    }

    /// The manifest resource `path` belongs to, for `method`. `None`: not
    /// in the table (online only). `path` is a full path without query.
    pub fn target(&self, method: ProxyMethod, path: &str) -> Option<Target> {
        let rest = path.strip_prefix(PREFIX)?;
        let parts: Vec<&str> = rest.split('/').collect();
        let mut found = None;
        for route in &self.routes {
            if route.method != method || route.segments.len() != parts.len() {
                continue;
            }
            let mut params = Vec::new();
            let matched = route
                .segments
                .iter()
                .zip(&parts)
                .all(|(segment, part)| match segment {
                    Segment::Literal(text) => text == part,
                    Segment::Param => match Uuid::try_parse(part) {
                        Ok(id) => {
                            params.push(id);
                            true
                        }
                        Err(_) => false,
                    },
                });
            if !matched {
                continue;
            }
            if found.is_some() {
                // Ambiguous: the table never allows this (see the tests).
                return None;
            }
            found = Some((route, params));
        }
        let (route, params) = found?;
        let on_row = match route.kind {
            TargetKind::List => false,
            TargetKind::Item => true,
            TargetKind::Write { op, .. } => op != MutationOp::Create,
        };
        let id = if on_row { params.last().copied() } else { None };
        let parent_id = if route.child {
            params.first().copied()
        } else {
            None
        };
        Some(Target {
            resource: route.resource.clone(),
            read: route.read,
            source: route.source,
            kind: route.kind.clone(),
            id,
            parent_id,
        })
    }

    /// Picks where the request is answered.
    ///
    /// - Not in the table: server while online, else refused.
    /// - GET: [`read_route`] of the resource's read mode, online state and
    ///   local copy. A local answer of `online-first` is marked stale; a
    ///   server-first read with a local copy waits [`ONLINE_FIRST_DEADLINE`]
    ///   and falls back to it. `source: snapshot` reads the snapshot.
    /// - Write: server while online. Offline: refused while offline writes
    ///   are closed or the resource's [`WritePolicy`] does not list the
    ///   operation, else a draft (the row-level checks run on enqueue).
    pub fn decide(
        target: Option<&Target>,
        facts: &Facts,
        policy: Option<&WritePolicy>,
    ) -> Decision {
        let Some(target) = target else {
            return if facts.online {
                Decision::ONLINE
            } else {
                Decision::Refuse(Refusal::Offline)
            };
        };
        match &target.kind {
            TargetKind::List | TargetKind::Item => read_decision(target, facts),
            TargetKind::Write { op, action } => {
                if facts.online {
                    return Decision::ONLINE;
                }
                match facts.offline_writes {
                    OfflineWrites::NoLocalStore => Decision::Refuse(Refusal::Offline),
                    OfflineWrites::ManifestMismatch => Decision::Refuse(Refusal::ManifestMismatch),
                    OfflineWrites::Open => {
                        if policy.is_some_and(|p| !p.allows_op(*op, action.as_deref())) {
                            return Decision::Refuse(Refusal::OnlineOnlyWrite);
                        }
                        Decision::Local {
                            plan: LocalPlan::Write {
                                resource: target.resource.clone(),
                                op: *op,
                                action: action.clone(),
                                id: target.id,
                                parent_id: target.parent_id,
                            },
                            else_online: false,
                        }
                    }
                }
            }
        }
    }
}

fn read_decision(target: &Target, facts: &Facts) -> Decision {
    let plan = |partial: bool, stale: bool| match target.source {
        Source::Snapshot => LocalPlan::Snapshot {
            resource: target.resource.clone(),
        },
        Source::Pull => LocalPlan::Read {
            resource: target.resource.clone(),
            id: target.id,
            parent_id: target.parent_id,
            partial,
            stale,
        },
    };
    match read_route(target.read, facts.online, facts.local_copy) {
        ReadRoute::Local { partial } => Decision::Local {
            plan: plan(partial, target.read == ReadMode::OnlineFirst),
            else_online: facts.online,
        },
        ReadRoute::Remote => Decision::ONLINE,
        ReadRoute::RemoteThenLocal { partial } => Decision::Online {
            deadline: Some(ONLINE_FIRST_DEADLINE),
            fallback: Some(plan(partial, true)),
        },
        ReadRoute::Unavailable => Decision::Refuse(Refusal::Offline),
    }
}

struct Base {
    resource: ResourceName,
    read: ReadMode,
    source: Source,
    child: bool,
}

fn name(entry: &Value) -> Result<ResourceName, String> {
    entry["resource"]
        .as_str()
        .map(|s| ResourceName(s.to_owned()))
        .ok_or_else(|| "resource name missing".to_owned())
}

fn reads(routes: &mut Vec<Route>, entry: &Value, base: &Base) -> Result<(), String> {
    if let Some(path) = entry["path"].as_str() {
        push(routes, base, ProxyMethod::Get, path, TargetKind::List)?;
    }
    if let Some(path) = entry["detail_path"].as_str() {
        push(routes, base, ProxyMethod::Get, path, TargetKind::Item)?;
    }
    Ok(())
}

fn push(
    routes: &mut Vec<Route>,
    base: &Base,
    method: ProxyMethod,
    template: &str,
    kind: TargetKind,
) -> Result<(), String> {
    let rest = template
        .strip_prefix(PREFIX)
        .ok_or_else(|| format!("{}: {template} is not under {PREFIX}", base.resource))?;
    let segments: Vec<Segment> = rest
        .split('/')
        .map(|part| {
            if part.starts_with('{') && part.ends_with('}') {
                Segment::Param
            } else {
                Segment::Literal(part.to_owned())
            }
        })
        .collect();
    if segments
        .iter()
        .any(|s| matches!(s, Segment::Literal(text) if text.is_empty()))
    {
        return Err(format!(
            "{}: {template} has an empty segment",
            base.resource
        ));
    }
    if routes
        .iter()
        .any(|r| r.method == method && r.segments == segments)
    {
        return Err(format!("duplicate route {method:?} {template}"));
    }
    routes.push(Route {
        method,
        segments,
        resource: base.resource.clone(),
        read: base.read,
        source: base.source,
        kind,
        child: base.child,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ProxyMethod::{Delete, Get, Patch, Post, Put};
    use keystone_sync::store::offline_manifest;
    use serde_json::json;

    const ID: &str = "0192f5a0-0000-7000-8000-00000000000a";
    const PARENT: &str = "0192f5a0-0000-7000-8000-00000000000b";

    fn router() -> &'static Router {
        Router::embedded()
    }

    fn id() -> Uuid {
        Uuid::parse_str(ID).unwrap()
    }

    fn facts(online: bool, local_copy: LocalCopy) -> Facts {
        Facts {
            online,
            local_copy,
            offline_writes: OfflineWrites::Open,
        }
    }

    fn policy_of(resource: &str) -> Option<WritePolicy> {
        offline_manifest(OFFLINE_MANIFEST)
            .unwrap()
            .specs
            .into_iter()
            .find(|s| s.resource.as_str() == resource)
            .and_then(|s| s.write)
    }

    fn decide_for(method: ProxyMethod, path: &str, facts: &Facts) -> Decision {
        let target = router().target(method, path);
        let policy = target.as_ref().and_then(|t| policy_of(t.resource.as_str()));
        Router::decide(target.as_ref(), facts, policy.as_ref())
    }

    // ------------------------------------------------------------ table

    /// Every template of the manifest, filled with fresh UUIDs (v7 and
    /// arbitrary 128-bit values), maps to
    /// exactly one route, and that route is its own (resource and kind);
    /// the same path with a non-UUID parameter maps to none.
    #[test]
    fn every_manifest_template_maps_to_exactly_one_target() {
        let root: Value = serde_json::from_str(OFFLINE_MANIFEST).unwrap();
        let mut templates: Vec<(ProxyMethod, String, String, TargetKind)> = Vec::new();
        let mut collect = |entry: &Value| {
            let resource = entry["resource"].as_str().unwrap().to_owned();
            if let Some(path) = entry["path"].as_str() {
                templates.push((Get, path.into(), resource.clone(), TargetKind::List));
            }
            if let Some(path) = entry["detail_path"].as_str() {
                templates.push((Get, path.into(), resource.clone(), TargetKind::Item));
            }
            for op in entry
                .pointer("/write/ops")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let (method, path) = op["route"].as_str().unwrap().split_once(' ').unwrap();
                templates.push((
                    ProxyMethod::from_name(method).unwrap(),
                    path.into(),
                    resource.clone(),
                    TargetKind::Write {
                        op: serde_json::from_value(op["op"].clone()).unwrap(),
                        action: op["action"].as_str().map(str::to_owned),
                    },
                ));
            }
        };
        for entry in root["resources"].as_array().unwrap() {
            collect(entry);
            for child in entry["children"].as_array().into_iter().flatten() {
                collect(child);
            }
        }
        assert!(templates.len() > 60, "{} templates", templates.len());

        let mut seed: u128 = 0x0192_f5a0_0000_7000_8000_0000_0000_0001;
        for round in 0..32 {
            for (method, template, resource, kind) in &templates {
                let mut params = Vec::new();
                let path = fill(template, |_| {
                    seed = seed
                        .wrapping_mul(0x2360_ed05_1fc6_5da4_4385_df64_9fcc_f645)
                        .wrapping_add(0x4f1b_bcdc_bfa5_3e0a);
                    let id = if round % 2 == 0 {
                        Uuid::now_v7()
                    } else {
                        Uuid::from_u128(seed)
                    };
                    params.push(id);
                    id.to_string()
                });
                let matches = count_matches(router(), *method, &path);
                assert_eq!(matches, 1, "{method:?} {path} matched {matches} routes");
                let target = router().target(*method, &path).unwrap();
                assert_eq!(target.resource.as_str(), resource, "{template}");
                assert_eq!(&target.kind, kind, "{template}");
                if template.matches('{').count() == 2 {
                    assert_eq!(target.parent_id, params.first().copied(), "{template}");
                }
                if matches!(kind, TargetKind::Item)
                    || matches!(kind, TargetKind::Write { op, .. } if *op != MutationOp::Create)
                {
                    assert_eq!(target.id, params.last().copied(), "{template}");
                }

                if template.contains('{') {
                    let word = fill(template, |_| "duplicates".to_owned());
                    assert_eq!(router().target(*method, &word), None, "{word}");
                }
            }
        }
    }

    fn fill(template: &str, mut value: impl FnMut(&str) -> String) -> String {
        template
            .split('/')
            .map(|part| {
                if part.starts_with('{') {
                    value(part)
                } else {
                    part.to_owned()
                }
            })
            .collect::<Vec<_>>()
            .join("/")
    }

    fn count_matches(router: &Router, method: ProxyMethod, path: &str) -> usize {
        let parts: Vec<&str> = path.strip_prefix(PREFIX).unwrap().split('/').collect();
        router
            .routes
            .iter()
            .filter(|r| r.method == method && r.segments.len() == parts.len())
            .filter(|r| {
                r.segments.iter().zip(&parts).all(|(s, p)| match s {
                    Segment::Literal(text) => text == p,
                    Segment::Param => Uuid::try_parse(p).is_ok(),
                })
            })
            .count()
    }

    #[test]
    fn targets_carry_resource_mode_ids_and_kind() {
        let item = router()
            .target(Get, &format!("/api/v1/items/{PARENT}/variants/{ID}"))
            .unwrap();
        assert_eq!(item.resource.as_str(), "items.variants");
        assert_eq!(item.read, ReadMode::LocalFirst);
        assert_eq!(item.kind, TargetKind::Item);
        assert_eq!(item.id, Some(id()));
        assert_eq!(item.parent_id, Some(Uuid::parse_str(PARENT).unwrap()));

        let counts = router()
            .target(Patch, &format!("/api/v1/stock-documents/{ID}/counts"))
            .unwrap();
        assert_eq!(
            counts.kind,
            TargetKind::Write {
                op: MutationOp::Action,
                action: Some("counts".into())
            }
        );
        assert_eq!(counts.id, Some(id()));

        let create = router().target(Post, "/api/v1/parties").unwrap();
        assert_eq!(create.id, None);
        let snapshot = router().target(Get, "/api/v1/stock-balances").unwrap();
        assert_eq!(snapshot.source, Source::Snapshot);
        assert_eq!(snapshot.read, ReadMode::OfflineFallback);
    }

    #[test]
    fn paths_outside_the_table_have_no_target() {
        for (method, path) in [
            (Get, "/api/v1/parties/duplicates".to_owned()),
            (Post, format!("/api/v1/sales-quotes/{ID}/send")),
            (Patch, format!("/api/v1/parties/{ID}")),
            (Put, format!("/api/v1/sales-quotes/{ID}")),
            (Post, "/api/v1/items".to_owned()),
            (Get, "/api/v1/reports/trial-balance".to_owned()),
            (Get, "/api/v1/Parties".to_owned()),
            (Get, "/api/v1/parties/".to_owned()),
            (Get, "/api/v2/parties".to_owned()),
            (Get, "/api/v1".to_owned()),
            (Delete, "/api/v1/parties".to_owned()),
        ] {
            assert_eq!(router().target(method, &path), None, "{method:?} {path}");
        }
    }

    #[test]
    fn manifest_errors_are_reported() {
        let dup = json!({ "resources": [
            { "resource": "a", "read": "local-first", "source": "pull", "path": "/api/v1/a" },
            { "resource": "b", "read": "local-first", "source": "pull", "path": "/api/v1/a" }
        ] });
        assert!(
            Router::from_manifest(&dup.to_string())
                .unwrap_err()
                .contains("duplicate")
        );
        let outside = json!({ "resources": [
            { "resource": "a", "read": "local-first", "source": "pull", "path": "/api/v2/a" }
        ] });
        assert!(Router::from_manifest(&outside.to_string()).is_err());
        let method = json!({ "resources": [
            { "resource": "a", "read": "local-first", "source": "pull", "path": "/api/v1/a",
              "write": { "ops": [{ "op": "create", "route": "HEAD /api/v1/a" }] } }
        ] });
        assert!(Router::from_manifest(&method.to_string()).is_err());
        assert!(Router::from_manifest("{}").is_err());
    }

    // ------------------------------------------------------------ decide

    fn read(resource: &str, id: Option<Uuid>, partial: bool, stale: bool) -> LocalPlan {
        LocalPlan::Read {
            resource: ResourceName(resource.into()),
            id,
            parent_id: None,
            partial,
            stale,
        }
    }

    fn write(resource: &str, op: MutationOp, action: Option<&str>, id: Option<Uuid>) -> LocalPlan {
        LocalPlan::Write {
            resource: ResourceName(resource.into()),
            op,
            action: action.map(str::to_owned),
            id,
            parent_id: None,
        }
    }

    fn fallback(plan: LocalPlan) -> Decision {
        Decision::Online {
            deadline: Some(ONLINE_FIRST_DEADLINE),
            fallback: Some(plan),
        }
    }

    fn local(plan: LocalPlan, else_online: bool) -> Decision {
        Decision::Local { plan, else_online }
    }

    /// Read mode x online/offline x GET list/item, POST, PATCH, DELETE and
    /// action, each with a complete local copy.
    #[test]
    fn decide_table() {
        use Decision::Refuse;
        use LocalCopy::Complete;
        use MutationOp::{Action, Create, Delete as Del, Update};
        use Refusal::{Offline, OnlineOnlyWrite};
        let online = Decision::ONLINE;
        let doc = format!("/api/v1/stock-documents/{ID}");
        let counts = format!("/api/v1/stock-documents/{ID}/counts");
        let delivery = format!("/api/v1/sales-deliveries/{ID}");
        let posting = format!("/api/v1/sales-deliveries/{ID}/post");
        let party = format!("/api/v1/parties/{ID}");
        let cases: Vec<(ProxyMethod, &str, bool, Decision)> = vec![
            // local-first, writable (stock-documents)
            (
                Get,
                "/api/v1/stock-documents",
                true,
                local(read("stock-documents", None, false, false), true),
            ),
            (
                Get,
                "/api/v1/stock-documents",
                false,
                local(read("stock-documents", None, false, false), false),
            ),
            (
                Get,
                &doc,
                true,
                local(read("stock-documents", Some(id()), false, false), true),
            ),
            (
                Get,
                &doc,
                false,
                local(read("stock-documents", Some(id()), false, false), false),
            ),
            (Post, "/api/v1/stock-documents", true, online.clone()),
            (
                Post,
                "/api/v1/stock-documents",
                false,
                local(write("stock-documents", Create, None, None), false),
            ),
            (Patch, &doc, true, online.clone()),
            (
                Patch,
                &doc,
                false,
                local(write("stock-documents", Update, None, Some(id())), false),
            ),
            (Delete, &doc, true, online.clone()),
            (
                Delete,
                &doc,
                false,
                local(write("stock-documents", Del, None, Some(id())), false),
            ),
            (Patch, &counts, true, online.clone()),
            (
                Patch,
                &counts,
                false,
                local(
                    write("stock-documents", Action, Some("counts"), Some(id())),
                    false,
                ),
            ),
            // local-first, create only (parties): other writes are online only
            (Patch, &party, true, online.clone()),
            (Patch, &party, false, Refuse(Offline)),
            (Delete, &party, false, Refuse(Offline)),
            // online-first, read only (sales-deliveries)
            (
                Get,
                "/api/v1/sales-deliveries",
                true,
                fallback(read("sales-deliveries", None, false, true)),
            ),
            (
                Get,
                "/api/v1/sales-deliveries",
                false,
                local(read("sales-deliveries", None, false, true), false),
            ),
            (
                Get,
                &delivery,
                true,
                fallback(read("sales-deliveries", Some(id()), false, true)),
            ),
            (
                Get,
                &delivery,
                false,
                local(read("sales-deliveries", Some(id()), false, true), false),
            ),
            (Post, "/api/v1/sales-deliveries", true, online.clone()),
            (Post, "/api/v1/sales-deliveries", false, Refuse(Offline)),
            (Patch, &delivery, false, Refuse(Offline)),
            (Delete, &delivery, false, Refuse(Offline)),
            (Post, &posting, true, online.clone()),
            (Post, &posting, false, Refuse(Offline)),
            // offline-fallback snapshot (stock-balances)
            (Get, "/api/v1/stock-balances", true, online.clone()),
            (
                Get,
                "/api/v1/stock-balances",
                false,
                local(
                    LocalPlan::Snapshot {
                        resource: ResourceName("stock-balances".into()),
                    },
                    false,
                ),
            ),
            (Post, "/api/v1/stock-balances", true, online.clone()),
            (Post, "/api/v1/stock-balances", false, Refuse(Offline)),
            (Patch, "/api/v1/stock-balances", false, Refuse(Offline)),
            (Delete, "/api/v1/stock-balances", false, Refuse(Offline)),
        ];
        for (method, path, is_online, expected) in cases {
            let decision = decide_for(method, path, &facts(is_online, Complete));
            assert_eq!(decision, expected, "{method:?} {path} online={is_online}");
        }
        // An action the policy does not list (a hand-made policy without
        // `counts`): online only.
        let target = router().target(Patch, &counts).unwrap();
        let mut policy = policy_of("stock-documents").unwrap();
        policy.ops.retain(|w| w.op != MutationOp::Action);
        assert_eq!(
            Router::decide(Some(&target), &facts(false, Complete), Some(&policy)),
            Refuse(OnlineOnlyWrite)
        );
    }

    #[test]
    fn reads_depend_on_the_local_copy() {
        use LocalCopy::{Missing, Partial};
        let parties = "/api/v1/parties";
        let deliveries = "/api/v1/sales-deliveries";
        let balances = "/api/v1/stock-balances";
        let cases: Vec<(&str, bool, LocalCopy, Decision)> = vec![
            (parties, true, Missing, Decision::ONLINE),
            (parties, false, Missing, Decision::Refuse(Refusal::Offline)),
            (
                parties,
                true,
                Partial,
                fallback(read("parties", None, true, true)),
            ),
            (
                parties,
                false,
                Partial,
                local(read("parties", None, true, false), false),
            ),
            (deliveries, true, Missing, Decision::ONLINE),
            (
                deliveries,
                false,
                Missing,
                Decision::Refuse(Refusal::Offline),
            ),
            (
                deliveries,
                true,
                Partial,
                fallback(read("sales-deliveries", None, true, true)),
            ),
            (
                deliveries,
                false,
                Partial,
                local(read("sales-deliveries", None, true, true), false),
            ),
            (balances, true, Missing, Decision::ONLINE),
            (balances, false, Missing, Decision::Refuse(Refusal::Offline)),
        ];
        for (path, is_online, copy, expected) in cases {
            assert_eq!(
                decide_for(Get, path, &facts(is_online, copy)),
                expected,
                "{path} online={is_online} {copy:?}"
            );
        }
    }

    #[test]
    fn unmapped_paths_are_online_only() {
        for copy in [LocalCopy::Missing, LocalCopy::Complete] {
            assert_eq!(
                decide_for(Get, "/api/v1/reports/trial-balance", &facts(true, copy)),
                Decision::ONLINE
            );
            assert_eq!(
                decide_for(Post, "/api/v1/treasury-payments", &facts(false, copy)),
                Decision::Refuse(Refusal::Offline)
            );
        }
    }

    #[test]
    fn closed_offline_writes_refuse_drafts_but_not_reads() {
        let mismatch = Facts {
            offline_writes: OfflineWrites::ManifestMismatch,
            ..facts(false, LocalCopy::Complete)
        };
        assert_eq!(
            decide_for(Post, "/api/v1/parties", &mismatch),
            Decision::Refuse(Refusal::ManifestMismatch)
        );
        assert_eq!(
            decide_for(Get, "/api/v1/parties", &mismatch),
            local(read("parties", None, false, false), false)
        );
        let online = Facts {
            online: true,
            ..mismatch
        };
        assert_eq!(
            decide_for(Post, "/api/v1/parties", &online),
            Decision::ONLINE
        );

        let no_store = Facts {
            offline_writes: OfflineWrites::NoLocalStore,
            ..facts(false, LocalCopy::Missing)
        };
        assert_eq!(
            decide_for(Post, "/api/v1/parties", &no_store),
            Decision::Refuse(Refusal::Offline)
        );
    }

    #[test]
    fn refusals_have_codes_and_statuses() {
        assert_eq!(
            Refusal::Offline.code_and_status(),
            ("OFFLINE_UNAVAILABLE", 503)
        );
        assert_eq!(
            Refusal::OnlineOnlyWrite.code_and_status(),
            ("OFFLINE_UNAVAILABLE", 503)
        );
        assert_eq!(
            Refusal::ManifestMismatch.code_and_status(),
            ("SYNC_OFFLINE_WRITE_NOT_ALLOWED", 422)
        );
    }
}
