<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\Cursor;
use App\Core\Sync\Xid8;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;

/**
 * Full-download sessions, so the server can tell "page N of a full download" from "an
 * incremental cursor at the same position" without changing the wire cursor
 * ({txid, after_id, gen}).
 *
 * One session per (device, user, company, resource): the durable user_devices row, which
 * survives access token refreshes and takes its sessions with it when revoked. A session holds
 * the horizon its download started at and the cursors it may be continued with: the last one
 * issued and the one before it (a retried request). A download that starts anew (no cursor, or
 * a reset) replaces the session, so cursors of an earlier download never continue the new one.
 * A finished download removes it. Only this server writes sessions, so a client cannot turn an
 * incremental cursor into a continuation.
 */
final readonly class FullDownloads
{
    public function __construct(private ConnectionInterface $db) {}

    public function deviceFor(string $tokenId, string $userId): ?string
    {
        $id = $this->db->table('user_devices')->where('token_id', $tokenId)->where('user_id', $userId)->value('id');

        return is_string($id) ? $id : null;
    }

    public function startedAt(string $device, string $userId, string $companyId, string $resource, Cursor $cursor): ?Xid8
    {
        if ($cursor->afterId === null) {
            return null;
        }

        $hash = self::hash($companyId, $resource, $cursor);
        $value = $this->session($device, $userId, $companyId, $resource)
            ->where(fn ($q) => $q->where('cursor_hash', $hash)->orWhere('previous_hash', $hash))
            ->selectRaw('started_horizon::text AS started')
            ->value('started');

        return Xid8::tryOf($value);
    }

    /**
     * @param  bool  $fresh  the page began a new download: the session is replaced
     */
    public function remember(string $device, string $userId, string $companyId, string $resource, Cursor $next, Xid8 $started, bool $fresh): void
    {
        $this->db->statement(
            'INSERT INTO sync_full_downloads (device_id, user_id, company_id, resource, cursor_hash, previous_hash, started_horizon, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?::xid8, ?, ?)
             ON CONFLICT (device_id, company_id, resource) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                previous_hash = CASE WHEN ? THEN NULL ELSE sync_full_downloads.cursor_hash END,
                cursor_hash = EXCLUDED.cursor_hash,
                started_horizon = EXCLUDED.started_horizon,
                created_at = CASE WHEN ? THEN EXCLUDED.created_at ELSE sync_full_downloads.created_at END,
                updated_at = EXCLUDED.updated_at',
            [$device, $userId, $companyId, $resource, self::hash($companyId, $resource, $next), $started->value, Carbon::now(), Carbon::now(), $fresh, $fresh],
        );
    }

    public function finish(string $device, string $userId, string $companyId, string $resource): void
    {
        $this->session($device, $userId, $companyId, $resource)->delete();
    }

    private function session(string $device, string $userId, string $companyId, string $resource): Builder
    {
        return $this->db->table('sync_full_downloads')
            ->where('device_id', $device)
            ->where('user_id', $userId)
            ->where('company_id', $companyId)
            ->where('resource', $resource);
    }

    private static function hash(string $companyId, string $resource, Cursor $cursor): string
    {
        return hash('sha256', implode('|', [$companyId, $resource, $cursor->txid->value, (string) $cursor->afterId, (string) $cursor->gen]));
    }
}
