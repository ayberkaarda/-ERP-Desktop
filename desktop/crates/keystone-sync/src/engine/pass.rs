//! One sync pass: manifest, push, pull, bound to one sign-in generation.

use std::collections::{HashMap, HashSet};
use std::sync::PoisonError;

use serde_json::Value;

use super::{
    MAX_IDLE_PAGES, MAX_PULL_REQUESTS, MAX_PUSH_BATCHES, MAX_SERVER_RESETS, MAX_STALE_PAGES,
    SyncEngine, SyncReport, Trigger, invalid_answer, is_transient, local,
};
use crate::client::SyncApi;
use crate::error::{Result, SyncError};
use crate::outbox::OutboxQueue;
use crate::store::{MirrorStore, PageApply, PullBase, ResourceSpec};
use crate::wire::{
    ErrorCode, Manifest, PullRequest, PullResource, PushRequest, PushResult, PushStatus,
    ResourceName, SCHEMA_VERSION, Source,
};

/// Per-resource pull counters of one run.
#[derive(Debug, Default)]
struct Progress {
    stale: usize,
    resets: usize,
    idle: usize,
}

impl<A: SyncApi> SyncEngine<A> {
    pub(super) async fn pass_inner(
        &self,
        _trigger: &Trigger,
        generation: u64,
        report: &mut SyncReport,
    ) -> Result<()> {
        // Runs are serialized: anything still in flight was cut off by a
        // crash or a dropped run, not sent by a concurrent one.
        self.outbox.requeue_in_flight()?;
        let manifest = self.api.manifest_in(generation).await?.data;
        self.apply_session(&manifest, generation, report)?;
        self.push_all(&manifest, generation, report).await?;
        self.pull_all(&manifest, generation, report).await?;
        local::prune_bases(&self.store)?;
        Ok(())
    }

    /// Identity and manifest, in one exclusive step that no read or enqueue
    /// interleaves with, and only while `generation` is still current.
    fn apply_session(
        &self,
        manifest: &Manifest,
        generation: u64,
        report: &mut SyncReport,
    ) -> Result<()> {
        let _local = self.local.write().unwrap_or_else(PoisonError::into_inner);
        self.ensure_generation(generation)?;
        let identity = format!("{}:{}", manifest.user_id, manifest.company_id);
        // A different user or company than the local data belongs to: wipe
        // before anything of the previous user is pushed.
        if local::session(&self.store)?
            .identity
            .is_some_and(|known| known != identity)
        {
            let names = local::wipe(&self.store)?;
            self.pending_pulls
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clear();
            for name in &names {
                self.touch(report, name);
            }
        }
        let resources: Vec<ResourceName> = manifest
            .resources
            .iter()
            .map(|r| r.resource.clone())
            .collect();
        // Access follows the new manifest before its resets run.
        local::set_session(&self.store, &identity, generation, &resources)?;
        self.apply_manifest(manifest, report)
    }

    /// Registers manifest resources, resets those whose visibility
    /// generation moved, and drops local data of resources that left the
    /// manifest. Both also drop the server rows kept as draft bases.
    fn apply_manifest(&self, manifest: &Manifest, report: &mut SyncReport) -> Result<()> {
        let listed: HashSet<&ResourceName> =
            manifest.resources.iter().map(|r| &r.resource).collect();

        for entry in &manifest.resources {
            let mut spec = self
                .specs
                .iter()
                .find(|s| s.resource == entry.resource)
                .cloned()
                .unwrap_or_else(|| ResourceSpec::new(entry.resource.clone()));
            spec.read = entry.read;
            spec.source = entry.source;
            if self.store.resource_spec(&entry.resource)?.as_ref() != Some(&spec) {
                self.store.register(&spec)?;
            }
            if entry.source == Source::Pull
                && let Some(state) = self.store.resource_state(&entry.resource)?
                && state.cursor.generation != entry.visibility_generation
            {
                self.store.reset_resource(&entry.resource)?;
                local::drop_bases(&self.store, &entry.resource)?;
                self.forget_pull(&entry.resource);
                self.touch(report, &entry.resource);
            }
        }

        for spec in self.store.resource_specs()? {
            let name = &spec.resource;
            if listed.contains(name) {
                continue;
            }
            let had_cursor = self.store.resource_state(name)?.is_some();
            let rows = self.store.reset_resource(name)?;
            let snapshot = self.store.remove_snapshot(name)?;
            let bases = local::drop_bases(&self.store, name)?;
            self.forget_pull(name);
            if had_cursor || rows > 0 || snapshot || bases > 0 {
                self.touch(report, name);
            }
        }
        for name in self.store.snapshot_resources()? {
            if !listed.contains(&name) && self.store.remove_snapshot(&name)? {
                self.touch(report, &name);
            }
        }
        Ok(())
    }

    async fn push_all(
        &self,
        manifest: &Manifest,
        generation: u64,
        report: &mut SyncReport,
    ) -> Result<()> {
        let max = usize::try_from(manifest.limits.push_batch_max)
            .unwrap_or(500)
            .clamp(1, 500);
        for _ in 0..MAX_PUSH_BATCHES {
            let batch = self.outbox.next_batch(max)?;
            if batch.is_empty() {
                break;
            }
            let request = PushRequest {
                schema_version: SCHEMA_VERSION,
                mutations: batch,
            };
            let response = match self.api.push_in(&request, generation).await {
                Ok(response) => response,
                Err(error) => {
                    if is_transient(&error) {
                        // The server failed it: counts towards the quarantine.
                        for mutation in &request.mutations {
                            self.outbox.transient_failure(mutation.idempotency_key)?;
                        }
                    } else {
                        self.outbox.requeue_in_flight()?;
                    }
                    return Err(error);
                }
            };
            let results = &response.data.results;
            let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
            // Nothing is written from an answer that arrived after another
            // sign-in, or that carries rows outside the request.
            if let Err(error) = self
                .ensure_generation(generation)
                .and_then(|()| check_push_results(&request, results, manifest))
            {
                self.outbox.requeue_in_flight()?;
                return Err(error);
            }
            // Mirror first: a crash before the outbox settles resends the
            // batch and gets `duplicate` with the same rows.
            for result in results {
                if !is_settled(result) || !was_sent(&request, result) {
                    continue;
                }
                match &result.data {
                    Some(Some(row)) => {
                        self.store.put_row(&result.resource, row)?;
                        self.touch(report, &result.resource);
                    }
                    Some(None) => {
                        if self.store.remove_row(&result.resource, result.id)? {
                            report.rows_removed += 1;
                        }
                        self.touch(report, &result.resource);
                    }
                    None => {}
                }
            }
            let outcome = self.outbox.record_results(results)?;
            report.pushed += outcome.applied;
            report.conflicts += outcome.conflicts;
            report.rejected += outcome.rejected;
            for result in results {
                if !is_settled(result) {
                    self.touch(report, &result.resource);
                }
            }
            // A mutation without a result goes back to the queue.
            self.outbox.requeue_in_flight()?;
        }
        Ok(())
    }

    async fn pull_all(
        &self,
        manifest: &Manifest,
        generation: u64,
        report: &mut SyncReport,
    ) -> Result<()> {
        let limits = manifest.limits;
        let per_request = usize::try_from(limits.pull_resources_max)
            .unwrap_or(1)
            .max(1);
        let page_max = limits.pull_page_max.clamp(1, 1000);
        let limit = self
            .pull_limit
            .unwrap_or(limits.pull_page_default)
            .clamp(1, page_max);
        let mut todo: Vec<ResourceName> = manifest
            .resources
            .iter()
            .filter(|r| r.source == Source::Pull)
            .map(|r| r.resource.clone())
            .collect();
        let mut cursor_resets = 0;
        let mut progress: HashMap<ResourceName, Progress> = HashMap::new();

        while !todo.is_empty() {
            if report.pull_requests >= MAX_PULL_REQUESTS {
                return Err(invalid_answer(
                    "the pull did not finish within the request budget of one run",
                ));
            }
            let chunk: Vec<ResourceName> = todo.iter().take(per_request).cloned().collect();
            let mut bases = Vec::with_capacity(chunk.len());
            let mut items = Vec::with_capacity(chunk.len());
            for name in &chunk {
                let (base, item) = self.pull_request_for(name, limit, page_max, report)?;
                items.push(item);
                bases.push(base);
            }
            let request = PullRequest {
                schema_version: SCHEMA_VERSION,
                resources: items,
            };
            report.pull_requests += 1;
            let response = match self.api.pull_in(&request, generation).await {
                Ok(response) => response,
                Err(
                    error @ SyncError::Api {
                        code: ErrorCode::SyncCursorInvalid,
                        ..
                    },
                ) => {
                    // The server rejects a stored cursor: download again,
                    // once per run.
                    cursor_resets += 1;
                    if cursor_resets > 1 {
                        return Err(error);
                    }
                    for name in &chunk {
                        self.store.reset_resource(name)?;
                        self.forget_pull(name);
                        self.touch(report, name);
                    }
                    continue;
                }
                Err(error) => return Err(error),
            };

            let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
            self.ensure_generation(generation)?;
            for page in &response.data.resources {
                let Some(at) = chunk.iter().position(|n| *n == page.resource) else {
                    continue;
                };
                self.forget_pull(&page.resource);
                let counters = progress.entry(page.resource.clone()).or_default();
                match self.store.apply_page(page, &bases[at])? {
                    PageApply::Applied(applied) => {
                        report.rows_upserted += applied.upserted;
                        report.rows_removed += applied.removed;
                        if applied.upserted > 0 || applied.removed > 0 || applied.reset {
                            self.touch(report, &page.resource);
                        }
                        if page.reset {
                            counters.resets += 1;
                            if counters.resets > MAX_SERVER_RESETS {
                                return Err(invalid_answer(&format!(
                                    "the server reset {} again and again",
                                    page.resource.as_str()
                                )));
                            }
                        }
                        // Same position (txid, after_id; the session is
                        // never compared) and nothing on the page.
                        let sent = request.resources[at].cursor.as_ref();
                        let stuck = page.has_more
                            && page.rows.is_empty()
                            && page.tombstones.is_empty()
                            && sent.is_some_and(|c| {
                                c.txid == page.next_cursor.txid
                                    && c.after_id == page.next_cursor.after_id
                            });
                        counters.idle = if stuck { counters.idle + 1 } else { 0 };
                        if counters.idle >= MAX_IDLE_PAGES {
                            return Err(invalid_answer(&format!(
                                "the pull of {} makes no progress",
                                page.resource.as_str()
                            )));
                        }
                        if !page.has_more {
                            todo.retain(|n| *n != page.resource);
                        }
                    }
                    PageApply::Stale => {
                        report.stale_pages += 1;
                        counters.stale += 1;
                        if counters.stale > MAX_STALE_PAGES {
                            return Err(invalid_answer(&format!(
                                "{} keeps moving locally during the pull",
                                page.resource.as_str()
                            )));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Base and request item for `name`. A lost request is resent as it
    /// was; when the manifest no longer allows its `limit`, the resource is
    /// reset and downloads anew (a cursor or session is never sent with
    /// another limit than the one it was issued under).
    fn pull_request_for(
        &self,
        name: &ResourceName,
        limit: u32,
        max: u32,
        report: &mut SyncReport,
    ) -> Result<(PullBase, PullResource)> {
        let base = self.store.pull_base(name)?;
        if let Some(item) = self.pull_item(name, &base, limit, max) {
            return Ok((base, item));
        }
        self.store.reset_resource(name)?;
        self.forget_pull(name);
        self.touch(report, name);
        let base = self.store.pull_base(name)?;
        let item = self
            .pull_item(name, &base, limit, max)
            .ok_or_else(|| invalid_answer("no pull request after a reset"))?;
        Ok((base, item))
    }

    /// The request item for `name`: the previous one, unchanged, while the
    /// resource is still at the base it was built from (a lost answer is
    /// retried with the same cursor, session and limit); `None` when that
    /// one exceeds `max`; else a new one.
    fn pull_item(
        &self,
        name: &ResourceName,
        base: &PullBase,
        limit: u32,
        max: u32,
    ) -> Option<PullResource> {
        let mut pending = self
            .pending_pulls
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if let Some((saved, item)) = pending.get(name)
            && saved == base
        {
            return item.limit.is_none_or(|l| l <= max).then(|| item.clone());
        }
        let item = PullResource {
            resource: name.clone(),
            cursor: base.cursor.clone(),
            limit: Some(limit),
        };
        pending.insert(name.clone(), (base.clone(), item.clone()));
        Some(item)
    }

    pub(super) fn forget_pull(&self, name: &ResourceName) {
        self.pending_pulls
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(name);
    }
}

fn is_settled(result: &PushResult) -> bool {
    matches!(result.status, PushStatus::Applied | PushStatus::Duplicate)
}

fn was_sent(request: &PushRequest, result: &PushResult) -> bool {
    request.mutations.iter().any(|m| {
        m.idempotency_key == result.idempotency_key
            && m.resource == result.resource
            && m.id == result.id
    })
}

/// Every row an answer would write must be the row of the mutation it
/// answers, of a manifest resource, and of the manifest's company. One bad
/// row rejects the whole answer before anything is written.
fn check_push_results(
    request: &PushRequest,
    results: &[PushResult],
    manifest: &Manifest,
) -> Result<()> {
    let company = manifest.company_id.to_string();
    for result in results {
        let Some(Some(row)) = &result.data else {
            continue;
        };
        if !is_settled(result) || !was_sent(request, result) {
            continue;
        }
        if row.id != result.id {
            return Err(invalid_answer(
                "a push result carries the row of another id",
            ));
        }
        if !manifest
            .resources
            .iter()
            .any(|r| r.resource == result.resource)
        {
            return Err(invalid_answer(
                "a push result carries a row of a resource outside the manifest",
            ));
        }
        match row.fields.get("company_id") {
            None | Some(Value::Null) => {}
            Some(Value::String(id)) if *id == company => {}
            Some(_) => {
                return Err(invalid_answer(
                    "a push result carries a row of another company",
                ));
            }
        }
    }
    Ok(())
}
