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
use Illuminate\Support\Str;

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
        private readonly FullDownloads $downloads,
    ) {}

    /**
     * @param  list<array{resource: string, cursor: array<string, mixed>|null, limit: int|null}>  $requests
     * @return array{horizon: string, server_time: string, resources: list<array<string, mixed>>}
     */
    public function pull(User $user, string $companyId, array $requests, ?string $tokenId = null): array
    {
        $config = $this->manifests->config();
        // Full-download sessions belong to the durable device, not to its rotating access token.
        $device = $tokenId === null ? null : $this->downloads->deviceFor($tokenId, $user->id);

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

            $wire = $request['cursor'];

            // xid8 travels as a decimal string only (a JSON number loses precision in clients);
            // session is required on every cursor: null, or the opaque id this server issued.
            if (is_array($wire) && (! is_string($wire['txid'] ?? null) || ! array_key_exists('session', $wire) || ! self::sessionValue($wire['session']))) {
                throw new ApiException(ErrorCode::SyncCursorInvalid, fields: ["resources.{$i}.cursor" => [__('sync::sync.cursor_invalid')]]);
            }

            $sessionKey = is_array($wire) && is_string($wire['session']) ? $wire['session'] : null;

            if (is_array($wire)) {
                unset($wire['session']);
            }

            $cursor = $wire === null ? null : Cursor::fromWire($wire);

            if ($cursor !== null && ($cursor->isAheadOf($horizon) || $cursor->gen > $generation)) {
                throw new ApiException(ErrorCode::SyncCursorInvalid, fields: ["resources.{$i}.cursor" => [__('sync::sync.cursor_invalid')]]);
            }

            $limit = min($request['limit'] ?? $config->pullPageDefault, $config->pullPageMax);
            $session = $cursor === null || $device === null || $sessionKey === null ? null : $this->downloads->find($device, $user->id, $companyId, $resource->name, $sessionKey, $cursor);
            // A cursor naming a session that is gone (finished, replaced by a newer download of
            // the device) or that never issued this position continues nothing: it resets.
            $orphan = $sessionKey !== null && $session === null;
            $observed = $device === null ? null : $this->downloads->observe($device, $user->id, $companyId, $resource->name);
            $plans[] = [$resource, $adapter, $cursor, $session, $orphan, $observed, $generation, max(1, $limit)];
        }

        // Floor, live rows and tombstones of every resource come from one REPEATABLE READ
        // snapshot, so a sync:prune committing meanwhile is either wholly seen (floor raised:
        // the cursor expires) or not at all (its tombstones are still read). The horizon is
        // read again inside: it can only be at or above the one the cursors were checked against.
        [$horizon, $results, $continuations] = $this->snapshot(function () use ($plans, $companyId, $device): array {
            $horizon = $this->horizon->current();
            $results = [];
            $continuations = [];

            foreach ($plans as [$resource, $adapter, $cursor, $session, $orphan, $observed, $generation, $limit]) {
                $newSession = $device !== null ? (string) Str::uuid7() : null;
                [$page, $continuation] = $this->page($resource, $adapter, $companyId, $cursor, $session, $orphan, $newSession, $generation, $limit, $horizon);
                $results[] = $page;

                if ($continuation !== null) {
                    $continuations[] = [$resource->name, ...$continuation, $session, $observed, $newSession];
                }
            }

            return [$horizon, $results, $continuations];
        });

        if ($device !== null) {
            // Every session write is compare-and-swap against what this request read: a page
            // that began a download replaces (or, done in one page, removes) the session only if
            // it is still the one observed before the read; a continuation only moves or removes
            // the session it continued, at the version it read. A late request never changes a
            // newer session.
            foreach ($continuations as [$name, $next, $started, $fresh, $session, $observed, $newSession]) {
                if ($fresh || $session === null) {
                    $next === null || $newSession === null
                        ? $this->downloads->forget($device, $user->id, $companyId, $name, $observed)
                        : $this->downloads->start($device, $user->id, $companyId, $name, $observed, $newSession, $next, $started);
                } else {
                    $next === null
                        ? $this->downloads->finish($session)
                        : $this->downloads->advance($session, $next);
                }
            }
        }

        return [
            'horizon' => $horizon->value,
            'server_time' => Carbon::now()->toIso8601String(),
            'resources' => $results,
        ];
    }

    /**
     * @template T
     *
     * @param  callable(): T  $read
     * @return T
     */
    private function snapshot(callable $read): mixed
    {
        if ($this->db->transactionLevel() > 0) {
            return $read();
        }

        return $this->db->transaction(function () use ($read): mixed {
            $this->db->statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');

            return $read();
        });
    }

    /**
     * One resource page. A full download (no cursor, a reset, or a cursor this server issued
     * while paging a full download) is checked against the floor by the horizon it started at,
     * not by its paging position: rows below the floor are the download itself, and only a
     * download older than the floor can have missed a delete. Incremental cursors are checked
     * by their position.
     *
     * The next cursor's session is the download's session id while a full download has more
     * pages ($newSession when the download begins on this page), and null otherwise.
     *
     * @return array{0: array<string, mixed>, 1: array{0: Cursor|null, 1: Xid8, 2: bool}|null} page, and for a full download its continuation (null cursor: finished) and whether it began here
     */
    private function page(ManifestResource $resource, SyncResource $adapter, string $companyId, ?Cursor $cursor, ?DownloadSession $session, bool $orphan, ?string $newSession, int $generation, int $limit, Xid8 $horizon): array
    {
        $reset = null;
        $started = $session?->started;
        $floor = $cursor !== null ? $this->floor($adapter, $companyId) : null;

        if ($cursor !== null && $cursor->gen !== $generation) {
            $reset = ResetReason::VisibilityChanged;
        } elseif ($cursor !== null && ($orphan || ($started !== null ? Cursor::atHorizon($started, $generation) : $cursor)->expiredBy($floor))) {
            $reset = ResetReason::CursorExpired;
        }

        $full = $cursor === null || $reset !== null || $started !== null;
        $started = $cursor === null || $reset !== null ? $horizon : $started;
        $from = $cursor === null || $reset !== null ? Cursor::initial($generation) : $cursor;
        // Window filter of a first download: the client holds nothing, so out-of-window rows
        // are left out instead of being sent as out_of_scope tombstones.
        $initial = $full;

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
            'next_cursor' => [...$next->toArray(), 'session' => null],
            'has_more' => $hasMore,
            'reset' => $reset !== null,
        ];

        if ($reset !== null) {
            $out['reset_reason'] = $reset->value;
        }

        $fresh = $cursor === null || $reset !== null;

        if ($full && $hasMore) {
            $out['next_cursor']['session'] = $fresh ? $newSession : $session?->sessionId;
        }

        return [$out, $full && $started !== null ? [$hasMore ? $next : null, $started, $fresh] : null];
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

    private static function sessionValue(mixed $value): bool
    {
        return $value === null || (is_string($value) && preg_match('/\A[A-Za-z0-9_-]{1,64}\z/', $value) === 1);
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
