<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Cursor;
use App\Core\Sync\ResetReason;
use App\Core\Sync\SyncScope;
use App\Core\Sync\TombstoneReason;
use App\Core\Sync\Xid8;
use App\Models\User;
use App\Modules\Sync\Manifest\ManifestResource;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\Query\Expression;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Schema;

/**
 * POST /sync/pull (SYNC-PROTOCOL "POST /api/v1/sync/pull").
 *
 * Per resource the events are one deduplicated stream ordered by (position, id): live rows of
 * the adapter query, plus tombstones whose id has no live row. Both sets are read with the
 * same keyset bounds below the horizon, merged and cut at limit + 1, so has_more and
 * next_cursor are exact and an id appears at most once on a page.
 */
final class PullService
{
    /** @var array<string, bool> */
    private static array $softDeletes = [];

    public function __construct(
        private readonly ConnectionInterface $db,
        private readonly ManifestService $manifests,
        private readonly Adapters $adapters,
        private readonly Visibility $visibility,
        private readonly Horizon $horizon,
        private readonly Rows $rows,
    ) {}

    /**
     * @param  list<array{resource: string, cursor: array<string, mixed>|null, limit: int|null}>  $requests
     * @return array{horizon: string, server_time: string, resources: list<array<string, mixed>>}
     */
    public function pull(User $user, string $companyId, array $requests): array
    {
        $config = $this->manifests->config();

        if (count($requests) > $config->pullResourcesMax) {
            throw new ApiException(ErrorCode::SyncBatchTooLarge);
        }

        $names = array_column($requests, 'resource');

        if (count($names) !== count(array_unique($names))) {
            throw new ApiException(ErrorCode::ValidationError, fields: ['resources' => [__('sync::sync.duplicate_resource')]]);
        }

        $horizon = $this->horizon->current();
        $granted = $this->manifests->granted($user, $companyId);
        $plans = [];

        // Every request-level check runs before any resource is read.
        foreach ($requests as $i => $request) {
            $resource = $this->manifests->manifest()->find($request['resource']);
            $adapter = $resource !== null && $resource->isPull() ? $this->adapters->resource($resource->name) : null;

            if ($resource === null || $adapter === null) {
                throw new ApiException(ErrorCode::SyncResourceUnsupported, fields: ["resources.{$i}.resource" => [__('sync::sync.resource_unsupported')]]);
            }

            $visible = $resource->requires->satisfiedBy($granted);
            $generation = $this->visibility->observe($user->id, $companyId, $resource->name, $visible);

            if (! $visible) {
                throw new ApiException(ErrorCode::Forbidden);
            }

            // xid8 travels as a decimal string only (a JSON number loses precision in clients).
            if (is_array($request['cursor']) && ! is_string($request['cursor']['txid'] ?? null)) {
                throw new ApiException(ErrorCode::SyncCursorInvalid, fields: ["resources.{$i}.cursor" => [__('sync::sync.cursor_invalid')]]);
            }

            $cursor = $request['cursor'] === null ? null : Cursor::fromWire($request['cursor']);

            if ($cursor !== null && ($cursor->isAheadOf($horizon) || $cursor->gen > $generation)) {
                throw new ApiException(ErrorCode::SyncCursorInvalid, fields: ["resources.{$i}.cursor" => [__('sync::sync.cursor_invalid')]]);
            }

            $limit = min($request['limit'] ?? $config->pullPageDefault, $config->pullPageMax);
            $plans[] = [$resource, $adapter, $cursor, $generation, max(1, $limit)];
        }

        $results = [];

        foreach ($plans as [$resource, $adapter, $cursor, $generation, $limit]) {
            $results[] = $this->page($resource, $adapter, $companyId, $cursor, $generation, $limit, $horizon);
        }

        return [
            'horizon' => $horizon->value,
            'server_time' => Carbon::now()->toIso8601String(),
            'resources' => $results,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function page(ManifestResource $resource, SyncResource $adapter, string $companyId, ?Cursor $cursor, int $generation, int $limit, Xid8 $horizon): array
    {
        $reset = null;

        if ($cursor !== null && $cursor->gen !== $generation) {
            $reset = ResetReason::VisibilityChanged;
        } elseif ($cursor !== null && $cursor->expiredBy($this->floor($adapter, $companyId))) {
            $reset = ResetReason::CursorExpired;
        }

        $from = $cursor === null || $reset !== null ? Cursor::initial($generation) : $cursor;
        $initial = $from->afterId === null && $from->txid->equals(Xid8::zero());

        $events = [
            ...$this->liveEvents($resource, $adapter, $companyId, $from, $horizon, $limit, $initial),
            ...$this->tombstoneEvents($resource, $adapter, $companyId, $from, $horizon, $limit),
        ];
        usort($events, static fn (array $a, array $b): int => $a['pos']->compare($b['pos']) ?: strcmp($a['id'], $b['id']));

        $hasMore = count($events) > $limit;
        $events = array_slice($events, 0, $limit);
        $rows = [];
        $tombstones = [];

        foreach ($events as $event) {
            if ($event['row'] !== null) {
                $rows[] = $this->rows->render($adapter, $event['row']);
            } else {
                $tombstones[] = $event['tombstone'];
            }
        }

        $last = $events === [] ? null : $events[count($events) - 1];
        $next = $hasMore && $last !== null
            ? Cursor::after($last['pos'], $last['id'], $generation)
            : Cursor::atHorizon($horizon, $generation);

        $out = [
            'resource' => $resource->name,
            'rows' => $rows,
            'tombstones' => $tombstones,
            'next_cursor' => $next->toArray(),
            'has_more' => $hasMore,
            'reset' => $reset !== null,
        ];

        if ($reset !== null) {
            $out['reset_reason'] = $reset->value;
        }

        return $out;
    }

    /**
     * Live rows after the cursor. In windowed resources a changed row whose window field is
     * outside the window becomes an out_of_scope tombstone; on a first download (nothing local
     * to remove) such rows are left out instead.
     *
     * @return list<array{pos: Xid8, id: string, row: Model|null, tombstone: array<string, mixed>|null}>
     */
    private function liveEvents(ManifestResource $resource, SyncResource $adapter, string $companyId, Cursor $from, Xid8 $horizon, int $limit, bool $initial): array
    {
        $table = $adapter->table();
        $pos = $adapter->positionColumn();
        $query = $adapter->query($companyId);
        $base = $query->getQuery();

        if ($base->columns === null) {
            $query->select("{$table}.*");
        }

        $query->addSelect(self::sql("({$pos})::text AS sync_pull_position"));
        $windowField = $resource->windowDays !== null ? ($resource->windowField ?? $adapter->windowField()) : null;
        $cutoff = $resource->windowDays !== null ? Carbon::today()->subDays($resource->windowDays)->toDateString() : null;

        if ($windowField !== null) {
            $query->addSelect(self::sql("({$table}.{$windowField} >= ?::date) AS sync_pull_in_window"))->addBinding($cutoff, 'select');

            if ($initial) {
                $query->where("{$table}.{$windowField}", '>=', $cutoff);
            }
        }

        $this->keyset($query, $pos, "{$table}.id", $from, $horizon);
        $query->reorder()->orderBy(self::sql($pos))->orderBy("{$table}.id")->limit($limit + 1);

        $events = [];

        foreach ($query->get() as $model) {
            /** @var Model $model */
            $position = Xid8::of((string) $model->getAttribute('sync_pull_position'));
            $id = (string) $model->getKey();
            $inWindow = $windowField === null || (bool) $model->getAttribute('sync_pull_in_window');
            $model->offsetUnset('sync_pull_position');
            $model->offsetUnset('sync_pull_in_window');

            if ($inWindow) {
                $events[] = ['pos' => $position, 'id' => $id, 'row' => $model, 'tombstone' => null];

                continue;
            }

            $changed = $model->getAttribute('updated_at');
            $events[] = ['pos' => $position, 'id' => $id, 'row' => null, 'tombstone' => $this->tombstone(
                $resource,
                $id,
                $adapter->parentKey() !== null ? self::nullableString($model->getAttribute($adapter->parentKey())) : null,
                $position,
                $changed !== null ? Carbon::parse(self::stringish($changed)) : Carbon::now(),
                TombstoneReason::OutOfScope,
            )];
        }

        return $events;
    }

    /**
     * @return list<array{pos: Xid8, id: string, row: Model|null, tombstone: array<string, mixed>|null}>
     */
    private function tombstoneEvents(ManifestResource $resource, SyncResource $adapter, string $companyId, Cursor $from, Xid8 $horizon, int $limit): array
    {
        $table = $adapter->table();
        $query = $this->db->table('sync_tombstones')
            ->where('resource_table', $table)
            ->select(['row_id', 'parent_id', 'reason', 'deleted_at'])
            ->selectRaw('sync_txid::text AS position');

        match ($adapter->scope()) {
            SyncScope::Company => $query->where('company_id', $companyId),
            SyncScope::CompanyOrGlobal => $query->where(fn (QueryBuilder $q) => $q->whereNull('company_id')->orWhere('company_id', $companyId)),
            SyncScope::GlobalWithCompanyActivation => $query->whereNull('company_id'),
        };

        // A live row always wins over its tombstone.
        $live = $this->db->table($table)->whereColumn("{$table}.id", 'sync_tombstones.row_id');

        if ($this->softDeletes($table)) {
            $live->whereNull("{$table}.deleted_at");
        }

        $query->whereNotExists($live);
        $this->keyset($query, 'sync_tombstones.sync_txid', 'sync_tombstones.row_id', $from, $horizon);
        $query->orderByRaw('sync_tombstones.sync_txid, sync_tombstones.row_id')->limit($limit + 1);

        $events = [];

        foreach ($query->get() as $row) {
            /** @var object{row_id: string, parent_id: string|null, reason: string, deleted_at: string, position: string} $row */
            $position = Xid8::of($row->position);
            $events[] = ['pos' => $position, 'id' => $row->row_id, 'row' => null, 'tombstone' => $this->tombstone(
                $resource,
                $row->row_id,
                $row->parent_id,
                $position,
                Carbon::parse($row->deleted_at),
                TombstoneReason::tryFrom($row->reason) ?? TombstoneReason::Deleted,
            )];
        }

        return $events;
    }

    /**
     * @param  Builder<Model>|QueryBuilder  $query
     */
    private function keyset(Builder|QueryBuilder $query, string $position, string $id, Cursor $from, Xid8 $horizon): void
    {
        if ($from->afterId === null) {
            $query->whereRaw(self::sql("{$position} >= ?::xid8"), [$from->txid->value]);
        } else {
            $query->whereRaw(self::sql("({$position}, {$id}) > (?::xid8, ?::uuid)"), [$from->txid->value, $from->afterId]);
        }

        $query->whereRaw(self::sql("{$position} < ?::xid8"), [$horizon->value]);
    }

    /**
     * @return array<string, mixed>
     */
    private function tombstone(ManifestResource $resource, string $id, ?string $parentId, Xid8 $position, Carbon $at, TombstoneReason $reason): array
    {
        $out = ['resource' => $resource->name, 'id' => $id];

        if ($resource->parent !== null) {
            $out['parent_id'] = $parentId;
        }

        return [...$out, 'sync_txid' => $position->value, 'deleted_at' => $at->toIso8601String(), 'reason' => $reason->value];
    }

    /**
     * Tombstone floor of the resource's table for the company (and for its global rows when
     * the scope includes them): the largest stored floor applies.
     */
    private function floor(SyncResource $adapter, string $companyId): ?Xid8
    {
        $query = $this->db->table('sync_watermarks')
            ->where('resource_table', $adapter->table())
            ->selectRaw('floor_txid::text AS floor');

        match ($adapter->scope()) {
            SyncScope::Company => $query->where('company_id', $companyId),
            SyncScope::CompanyOrGlobal => $query->where(fn (QueryBuilder $q) => $q->whereNull('company_id')->orWhere('company_id', $companyId)),
            SyncScope::GlobalWithCompanyActivation => $query->whereNull('company_id'),
        };

        $floor = null;

        foreach ($query->pluck('floor') as $value) {
            $xid = Xid8::tryOf($value);

            if ($xid !== null) {
                $floor = $floor === null ? $xid : Xid8::max($floor, $xid);
            }
        }

        return $floor;
    }

    /**
     * SQL fragment built from adapter-declared identifiers (table, position expression,
     * window field); values always travel as bindings. Quotes, comments and statement
     * separators are refused, so a fragment can only name columns and call functions.
     *
     * @return Expression<literal-string>
     */
    private static function sql(string $fragment): Expression
    {
        if (preg_match('/\A[^;\'"\\\\]*\z/', $fragment) !== 1 || str_contains($fragment, '--') || str_contains($fragment, '/*')) {
            throw new \InvalidArgumentException("Unsafe sync SQL fragment [{$fragment}].");
        }

        /** @var literal-string $fragment */
        return new Expression($fragment);
    }

    private function softDeletes(string $table): bool
    {
        return self::$softDeletes[$table] ??= Schema::hasColumn($table, 'deleted_at');
    }

    private static function nullableString(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    private static function stringish(mixed $value): string
    {
        return $value instanceof \DateTimeInterface ? $value->format(DATE_ATOM) : (is_scalar($value) ? (string) $value : '');
    }
}
