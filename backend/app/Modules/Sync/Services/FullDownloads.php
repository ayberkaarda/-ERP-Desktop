<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\Cursor;
use App\Core\Sync\Xid8;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Full-download sessions, so the server can tell "page N of a full download" from "an
 * incremental cursor at the same position" without changing the wire cursor
 * ({txid, after_id, gen}).
 *
 * One session per (device, user, company, resource): the durable user_devices row, which
 * survives access token refreshes and takes its sessions with it when revoked. A session has
 * its own id, the horizon its download started at and the cursors it may be continued with:
 * the last one issued and the one before it (a retried request). A download that starts anew
 * (no cursor, or a reset) replaces the session with a new id. Continuation writes are
 * compare-and-swap on the session id and the presented cursor, so a late request of an older
 * download changes or removes nothing of a newer one. Only this server writes sessions, so a
 * client cannot turn an incremental cursor into a continuation.
 *
 * The wire cursor carries no session id: a cursor whose (txid, after_id, gen) equals one the
 * current session issued is that session's cursor.
 */
final readonly class FullDownloads
{
    public function __construct(private ConnectionInterface $db) {}

    public function deviceFor(string $tokenId, string $userId): ?string
    {
        $id = $this->db->table('user_devices')->where('token_id', $tokenId)->where('user_id', $userId)->value('id');

        return is_string($id) ? $id : null;
    }

    public function find(string $device, string $userId, string $companyId, string $resource, Cursor $cursor): ?DownloadSession
    {
        if ($cursor->afterId === null) {
            return null;
        }

        $hash = self::hash($companyId, $resource, $cursor);
        $row = $this->key($device, $userId, $companyId, $resource)
            ->where(fn (Builder $q) => $q->where('cursor_hash', $hash)->orWhere('previous_hash', $hash))
            ->selectRaw('session_id::text AS session, started_horizon::text AS started')
            ->first();
        $values = is_object($row) ? get_object_vars($row) : [];
        $started = Xid8::tryOf($values['started'] ?? null);

        return $started !== null && is_string($values['session'] ?? null)
            ? new DownloadSession($device, $userId, $companyId, $resource, $values['session'], $hash, $started)
            : null;
    }

    /**
     * A page began a download with more to come: it becomes the device's session.
     */
    public function start(string $device, string $userId, string $companyId, string $resource, Cursor $next, Xid8 $started): void
    {
        $this->db->statement(
            'INSERT INTO sync_full_downloads (device_id, user_id, company_id, resource, session_id, cursor_hash, previous_hash, started_horizon, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, ?::xid8, ?, ?)
             ON CONFLICT (device_id, company_id, resource) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                session_id = EXCLUDED.session_id,
                cursor_hash = EXCLUDED.cursor_hash,
                previous_hash = NULL,
                started_horizon = EXCLUDED.started_horizon,
                created_at = EXCLUDED.created_at,
                updated_at = EXCLUDED.updated_at',
            [$device, $userId, $companyId, $resource, (string) Str::uuid7(), self::hash($companyId, $resource, $next), $started->value, Carbon::now(), Carbon::now()],
        );
    }

    /**
     * The session the request continued issued its next cursor. Nothing changes when the
     * session was replaced or moved on meanwhile.
     */
    public function advance(DownloadSession $session, Cursor $next): void
    {
        $this->db->update(
            'UPDATE sync_full_downloads SET
                previous_hash = CASE WHEN cursor_hash = ? THEN cursor_hash ELSE previous_hash END,
                cursor_hash = ?,
                updated_at = ?
             WHERE device_id = ? AND user_id = ? AND company_id = ? AND resource = ?
               AND session_id = ?::uuid AND (cursor_hash = ? OR previous_hash = ?)',
            [
                $session->presentedHash,
                self::hash($session->companyId, $session->resource, $next),
                Carbon::now(),
                $session->device, $session->userId, $session->companyId, $session->resource,
                $session->sessionId, $session->presentedHash, $session->presentedHash,
            ],
        );
    }

    /**
     * The session the request continued is complete; a newer session is left alone.
     */
    public function finish(DownloadSession $session): void
    {
        $this->key($session->device, $session->userId, $session->companyId, $session->resource)
            ->where('session_id', $session->sessionId)
            ->where(fn (Builder $q) => $q->where('cursor_hash', $session->presentedHash)->orWhere('previous_hash', $session->presentedHash))
            ->delete();
    }

    /**
     * A download began and completed on one page: no session is left for the device.
     */
    public function forget(string $device, string $userId, string $companyId, string $resource): void
    {
        $this->key($device, $userId, $companyId, $resource)->delete();
    }

    private function key(string $device, string $userId, string $companyId, string $resource): Builder
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
