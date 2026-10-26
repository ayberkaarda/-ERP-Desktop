<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\Cursor;
use App\Core\Sync\Xid8;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Carbon;

/**
 * Continuation cursors of full downloads, so the server can tell "page N of a full download"
 * from "an incremental cursor at the same position" without changing the wire cursor
 * ({txid, after_id, gen}). Each has_more cursor a full-download page issues is remembered for
 * the device token that pulled it, with the horizon the download started at. Only this server
 * writes them, so a client cannot turn an incremental cursor into a continuation.
 */
final readonly class FullDownloads
{
    public function __construct(private ConnectionInterface $db) {}

    public function startedAt(?string $device, string $companyId, string $resource, Cursor $cursor): ?Xid8
    {
        if ($device === null || $cursor->afterId === null) {
            return null;
        }

        $value = $this->db->table('sync_full_downloads')
            ->where('cursor_hash', self::hash($device, $companyId, $resource, $cursor))
            ->selectRaw('started_horizon::text AS started')
            ->value('started');

        return Xid8::tryOf($value);
    }

    public function remember(?string $device, string $companyId, string $resource, Cursor $next, Xid8 $started): void
    {
        if ($device === null) {
            return;
        }

        $this->db->statement(
            'INSERT INTO sync_full_downloads (cursor_hash, token_id, company_id, resource, started_horizon, created_at)
             VALUES (?, ?, ?, ?, ?::xid8, ?) ON CONFLICT (cursor_hash) DO NOTHING',
            [self::hash($device, $companyId, $resource, $next), $device, $companyId, $resource, $started->value, Carbon::now()],
        );
    }

    private static function hash(string $device, string $companyId, string $resource, Cursor $cursor): string
    {
        return hash('sha256', implode('|', [$device, $companyId, $resource, $cursor->txid->value, (string) $cursor->afterId, (string) $cursor->gen]));
    }
}
