<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\Xid8;
use Illuminate\Database\ConnectionInterface;
use RuntimeException;

/**
 * pg_snapshot_xmin(pg_current_snapshot()): every transaction below it has finished, so an
 * event with sync_txid < horizon can never show up later with a smaller sync_txid. The value
 * is cluster wide; one long transaction anywhere on the server holds it back.
 */
final readonly class Horizon
{
    public function __construct(private ConnectionInterface $db) {}

    public function current(): Xid8
    {
        $row = $this->db->selectOne('SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS horizon');

        if (! is_object($row) || ! is_string($row->horizon ?? null)) {
            throw new RuntimeException('Could not read the sync horizon.');
        }

        return Xid8::of($row->horizon);
    }
}
