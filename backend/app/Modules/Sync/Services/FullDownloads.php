<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\Cursor;
use App\Core\Sync\Xid8;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;

/**
 * Full-download sessions (SYNC-PROTOCOL "Tam indirme oturumu").
 *
 * One session per (device, user, company, resource): the durable user_devices row, which
 * survives access token refreshes and takes its sessions with it when revoked. A session has
 * an opaque id that travels in cursor.session, a version, the horizon its download started at
 * and the cursors it may be continued with: the latest one issued and the one before it (a
 * retried request; read only, it never moves the session).
 *
 * Every write is a compare-and-swap on what the request read before its snapshot:
 * - a page that begins a download (no cursor, or a reset) replaces the observed session, or
 *   inserts one when none was observed;
 * - a continuation advances or finishes only its own session at the version it read, and only
 *   from the latest cursor.
 * A request that lost the race writes nothing; its response cursor then names a session that
 * is not stored, and the next request with it resets.
 */
final readonly class FullDownloads
{
    public function __construct(private ConnectionInterface $db) {}

    public function deviceFor(string $tokenId, string $userId): ?string
    {
        $id = $this->db->table('user_devices')->where('token_id', $tokenId)->where('user_id', $userId)->value('id');

        return is_string($id) ? $id : null;
    }

    /**
     * The device's session row as it is now: [session id, version], or null.
     *
     * @return array{0: string, 1: int}|null
     */
    public function observe(string $device, string $userId, string $companyId, string $resource): ?array
    {
        $row = $this->key($device, $userId, $companyId, $resource)->selectRaw('session_id::text AS session, version')->first();
        $values = is_object($row) ? get_object_vars($row) : [];

        return is_string($values['session'] ?? null) && is_numeric($values['version'] ?? null)
            ? [$values['session'], (int) $values['version']]
            : null;
    }

    /**
     * The session named by cursor.session, when it is the device's current session and issued
     * this position.
     */
    public function find(string $device, string $userId, string $companyId, string $resource, string $session, Cursor $cursor): ?DownloadSession
    {
        if (preg_match(Cursor::UUID_PATTERN, $session) !== 1) {
            return null;
        }

        $hash = self::hash($companyId, $resource, $cursor);
        $row = $this->key($device, $userId, $companyId, $resource)
            ->where('session_id', $session)
            ->where(fn (Builder $q) => $q->where('cursor_hash', $hash)->orWhere('previous_hash', $hash))
            ->selectRaw('version, cursor_hash, started_horizon::text AS started')
            ->first();
        $values = is_object($row) ? get_object_vars($row) : [];
        $started = Xid8::tryOf($values['started'] ?? null);

        return $started !== null && is_numeric($values['version'] ?? null)
            ? new DownloadSession($device, $userId, $companyId, $resource, $session, (int) $values['version'], $hash, ($values['cursor_hash'] ?? null) === $hash, $started)
            : null;
    }

    /**
     * A page began a download with more to come: it replaces the observed session.
     *
     * @param  array{0: string, 1: int}|null  $observed
     */
    public function start(string $device, string $userId, string $companyId, string $resource, ?array $observed, string $session, Cursor $next, Xid8 $started): void
    {
        $now = Carbon::now();
        $hash = self::hash($companyId, $resource, $next);

        if ($observed === null) {
            $this->db->statement(
                'INSERT INTO sync_full_downloads (device_id, user_id, company_id, resource, session_id, version, cursor_hash, previous_hash, started_horizon, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?::uuid, 1, ?, NULL, ?::xid8, ?, ?)
                 ON CONFLICT (device_id, company_id, resource) DO NOTHING',
                [$device, $userId, $companyId, $resource, $session, $hash, $started->value, $now, $now],
            );

            return;
        }

        $this->db->update(
            'UPDATE sync_full_downloads SET session_id = ?::uuid, version = 1, cursor_hash = ?, previous_hash = NULL,
                started_horizon = ?::xid8, created_at = ?, updated_at = ?
             WHERE device_id = ? AND user_id = ? AND company_id = ? AND resource = ? AND session_id = ?::uuid AND version = ?',
            [$session, $hash, $started->value, $now, $now, $device, $userId, $companyId, $resource, $observed[0], $observed[1]],
        );
    }

    /**
     * A download began and completed on one page: the observed session is over.
     *
     * @param  array{0: string, 1: int}|null  $observed
     */
    public function forget(string $device, string $userId, string $companyId, string $resource, ?array $observed): void
    {
        if ($observed === null) {
            return;
        }

        $this->key($device, $userId, $companyId, $resource)
            ->where('session_id', $observed[0])
            ->where('version', $observed[1])
            ->delete();
    }

    /**
     * The session the request continued from its latest cursor issued the next one.
     */
    public function advance(DownloadSession $session, Cursor $next): void
    {
        if (! $session->atLatest) {
            return;
        }

        $this->current($session)->where('cursor_hash', $session->presentedHash)->update([
            'previous_hash' => $session->presentedHash,
            'cursor_hash' => self::hash($session->companyId, $session->resource, $next),
            'version' => $session->version + 1,
            'updated_at' => Carbon::now(),
        ]);
    }

    /**
     * The session the request continued from its latest cursor is complete. A retry from the
     * previous cursor reads but never writes, so it leaves the session to its latest cursor.
     */
    public function finish(DownloadSession $session): void
    {
        if (! $session->atLatest) {
            return;
        }

        $this->current($session)->where('cursor_hash', $session->presentedHash)->delete();
    }

    private function current(DownloadSession $session): Builder
    {
        return $this->key($session->device, $session->userId, $session->companyId, $session->resource)
            ->where('session_id', $session->sessionId)
            ->where('version', $session->version);
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
