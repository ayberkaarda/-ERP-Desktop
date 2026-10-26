//! One sync pass: manifest, push, pull.

use std::collections::HashSet;
use std::sync::PoisonError;

use super::{
    MAX_PULL_REQUESTS, MAX_PUSH_BATCHES, SyncEngine, SyncReport, Trigger, is_transient, local,
};
use crate::client::SyncApi;
use crate::error::{Result, SyncError};
use crate::outbox::OutboxQueue;
use crate::store::{MirrorStore, PageApply, PullBase, ResourceSpec};
use crate::wire::{
    ErrorCode, Manifest, PullRequest, PullResource, PushRequest, PushStatus, ResourceName,
    SCHEMA_VERSION, Source,
};

impl<A: SyncApi> SyncEngine<A> {
    pub(super) async fn pass_inner(
        &self,
        _trigger: &Trigger,
        report: &mut SyncReport,
    ) -> Result<()> {
        // Runs are serialized: anything still in flight was cut off by a
        // crash or a dropped run, not sent by a concurrent one.
        self.outbox.requeue_in_flight()?;
        let manifest = self.api.manifest().await?.data;
        self.apply_identity(&manifest, report)?;
        self.apply_manifest(&manifest, report)?;
        self.push_all(&manifest, report).await?;
        self.pull_all(&manifest, report).await?;
        local::prune_bases(&self.store)?;
        Ok(())
    }

    /// A different user or company than the local data belongs to: wipe
    /// before anything of the previous user is pushed.
    fn apply_identity(&self, manifest: &Manifest, report: &mut SyncReport) -> Result<()> {
        let identity = format!("{}:{}", manifest.user_id, manifest.company_id);
        match local::identity(&self.store)? {
            Some(known) if known == identity => return Ok(()),
            Some(_) => {
                let names = local::wipe(&self.store)?;
                self.pending_pulls
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clear();
                for name in &names {
                    report.touch(name);
                }
            }
            None => {}
        }
        local::set_identity(&self.store, &identity)
    }

    /// Registers manifest resources, resets those whose visibility
    /// generation moved, and drops local data of resources that left the
    /// manifest.
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
                self.forget_pull(&entry.resource);
                report.touch(&entry.resource);
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
            self.forget_pull(name);
            if had_cursor || rows > 0 || snapshot {
                report.touch(name);
            }
        }
        for name in self.store.snapshot_resources()? {
            if !listed.contains(&name) && self.store.remove_snapshot(&name)? {
                report.touch(&name);
            }
        }
        Ok(())
    }

    async fn push_all(&self, manifest: &Manifest, report: &mut SyncReport) -> Result<()> {
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
            let response = match self.api.push(&request).await {
                Ok(response) => response,
                Err(error) => {
                    if is_transient(&error) {
                        // Outcome unknown: counts towards the quarantine.
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
            // Mirror first: a crash before the outbox settles resends the
            // batch and gets `duplicate` with the same rows.
            for result in results {
                if !matches!(result.status, PushStatus::Applied | PushStatus::Duplicate) {
                    continue;
                }
                let sent = request.mutations.iter().any(|m| {
                    m.idempotency_key == result.idempotency_key
                        && m.resource == result.resource
                        && m.id == result.id
                });
                if !sent {
                    continue;
                }
                match &result.data {
                    Some(Some(row)) => {
                        self.store.put_row(&result.resource, row)?;
                        report.touch(&result.resource);
                    }
                    Some(None) => {
                        if self.store.remove_row(&result.resource, result.id)? {
                            report.rows_removed += 1;
                        }
                        report.touch(&result.resource);
                    }
                    None => {}
                }
            }
            let outcome = self.outbox.record_results(results)?;
            report.pushed += outcome.applied;
            report.conflicts += outcome.conflicts;
            report.rejected += outcome.rejected;
            for result in results {
                if result.status != PushStatus::Applied && result.status != PushStatus::Duplicate {
                    report.touch(&result.resource);
                }
            }
            // A mutation without a result goes back to the queue.
            self.outbox.requeue_in_flight()?;
        }
        Ok(())
    }

    async fn pull_all(&self, manifest: &Manifest, report: &mut SyncReport) -> Result<()> {
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

        while !todo.is_empty() && report.pull_requests < MAX_PULL_REQUESTS {
            let chunk: Vec<ResourceName> = todo.iter().take(per_request).cloned().collect();
            let mut bases = Vec::with_capacity(chunk.len());
            let mut items = Vec::with_capacity(chunk.len());
            for name in &chunk {
                let base = self.store.pull_base(name)?;
                items.push(self.pull_item(name, &base, limit, page_max));
                bases.push(base);
            }
            let request = PullRequest {
                schema_version: SCHEMA_VERSION,
                resources: items,
            };
            report.pull_requests += 1;
            let response = match self.api.pull(&request).await {
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
                        report.touch(name);
                    }
                    continue;
                }
                Err(error) => return Err(error),
            };

            for page in &response.data.resources {
                let Some(at) = chunk.iter().position(|n| *n == page.resource) else {
                    continue;
                };
                self.forget_pull(&page.resource);
                match self.store.apply_page(page, &bases[at])? {
                    PageApply::Applied(applied) => {
                        report.rows_upserted += applied.upserted;
                        report.rows_removed += applied.removed;
                        if applied.upserted > 0 || applied.removed > 0 || applied.reset {
                            report.touch(&page.resource);
                        }
                        if !page.has_more {
                            todo.retain(|n| *n != page.resource);
                        }
                    }
                    PageApply::Stale => report.stale_pages += 1,
                }
            }
        }
        Ok(())
    }

    /// The request item for `name`: the previous one, unchanged, while the
    /// resource is still at the base it was built from (a lost answer is
    /// retried with the same cursor, session and limit); else a new one.
    fn pull_item(
        &self,
        name: &ResourceName,
        base: &PullBase,
        limit: u32,
        max: u32,
    ) -> PullResource {
        let mut pending = self
            .pending_pulls
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if let Some((saved, item)) = pending.get(name)
            && saved == base
            && item.limit.is_none_or(|l| l <= max)
        {
            return item.clone();
        }
        let item = PullResource {
            resource: name.clone(),
            cursor: base.cursor.clone(),
            limit: Some(limit),
        };
        pending.insert(name.clone(), (base.clone(), item.clone()));
        item
    }

    pub(super) fn forget_pull(&self, name: &ResourceName) {
        self.pending_pulls
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(name);
    }
}
