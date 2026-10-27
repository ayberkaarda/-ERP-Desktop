<?php

declare(strict_types=1);

namespace App\Core\Sync\Contracts;

use App\Core\Sync\SyncScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Read side of one offline-manifest resource, implemented by the module that owns the table
 * (Modules/<Name>/Sync) and tagged with self::TAG in its service provider. The Sync module
 * only sees this contract, so it never touches another module's models.
 *
 * The pull service applies the cursor window to positionColumn() and the
 * (company_id, sync_txid, id) keyset itself; query() returns live rows only — no sync
 * conditions, no ordering, no limit — with the scope rules of scope() already applied.
 * Row visibility is per resource in D1 (manifest `requires` + company scope + this query);
 * policies are not evaluated per row.
 *
 * Table setup (module migration): `$table->syncable()` on the resource table and
 * `syncable(parent: ..., parentKey: [...])` on line tables (see App\Core\Sync\Schema\Syncable).
 * Before binding, check the table's own BEFORE UPDATE guards: comparisons of to_jsonb(OLD) and
 * to_jsonb(NEW) keep working (zz_sync_touch runs last), but a guard that rejects every update
 * of a posted/closed row also rejects the parent touch caused by a line change; such a guard
 * starts with App\Core\Sync\Schema\Syncable::GUARD_EXEMPTION (sync_touch_only(OLD, NEW): the touch
 * flag AND no column but sync_txid changed), never with a check of the sync_touching() flag alone.
 */
interface SyncResource
{
    public const string TAG = 'sync.resources';

    /** Manifest resource name, e.g. 'parties' or 'items.variants'. */
    public function name(): string;

    /** Table whose rows and sync_tombstones.resource_table back this resource. */
    public function table(): string;

    public function scope(): SyncScope;

    /**
     * Live rows of the resource visible to the company, embeds eager loaded.
     *
     * @return Builder<Model>
     */
    public function query(string $companyId): Builder;

    /**
     * SQL expression of the row's sync position (xid8), qualified, e.g. 'parties.sync_txid'.
     * Resources whose state spans two tables return GREATEST(...) of both.
     */
    public function positionColumn(): string;

    /**
     * API Resource used by the REST index, so a pulled row has exactly the REST shape.
     *
     * @return class-string<JsonResource>
     */
    public function resourceClass(): string;

    /**
     * Relations loaded for every row (manifest `embeds`).
     *
     * @return list<string>
     */
    public function embeds(): array;

    /** Column limiting rows to the manifest window (e.g. document_date), or null. */
    public function windowField(): ?string;

    /** Child resources: column of the parent id, copied into tombstones; null otherwise. */
    public function parentKey(): ?string;
}
