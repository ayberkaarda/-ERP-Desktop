<?php

declare(strict_types=1);

namespace App\Modules\Sync\Console;

use App\Core\Idempotency\IdempotencyStore;
use App\Core\Sync\SyncConfig;
use App\Core\Sync\Xid8;
use Illuminate\Console\Command;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Carbon;

/**
 * Removes tombstones older than the retention (by deleted_at) and raises the tombstone floor
 * of every (table, company) it pruned to max(pruned sync_txid) + 1 (SYNC-PROTOCOL
 * "Tombstone tabanı"); the floor never goes down. Expired push results and their resolutions
 * go too.
 */
final class PruneCommand extends Command
{
    protected $signature = 'sync:prune';

    protected $description = 'Prune old sync tombstones (raising the tombstone floor) and expired push results.';

    public function handle(ConnectionInterface $db, IdempotencyStore $store): int
    {
        $config = SyncConfig::fromConfig(config());
        $cutoff = Carbon::now()->subDays($config->tombstoneRetentionDays);

        $groups = $db->transaction(function () use ($db, $cutoff): int {
            $purged = $db->select(
                'WITH purged AS (
                    DELETE FROM sync_tombstones WHERE deleted_at < ? RETURNING resource_table, company_id, sync_txid
                 )
                 SELECT resource_table, company_id, max(sync_txid)::text AS top, count(*) AS n FROM purged GROUP BY resource_table, company_id',
                [$cutoff],
            );

            foreach ($purged as $row) {
                /** @var object{resource_table: string, company_id: string|null, top: string} $row */
                $floor = Xid8::of($row->top)->next();
                $db->statement(
                    'INSERT INTO sync_watermarks (resource_table, company_id, floor_txid, pruned_at) VALUES (?, ?, ?::xid8, ?)
                     ON CONFLICT (resource_table, company_id) DO UPDATE
                     SET floor_txid = GREATEST(sync_watermarks.floor_txid, EXCLUDED.floor_txid), pruned_at = EXCLUDED.pruned_at',
                    [$row->resource_table, $row->company_id, $floor->value, Carbon::now()],
                );
            }

            return count($purged);
        });

        $keys = $store->prune();
        $resolutions = $db->table('sync_push_resolutions')
            ->where('created_at', '<', Carbon::now()->subSeconds($config->idempotencyTtlSeconds()))
            ->delete();

        $this->info("Pruned tombstones of {$groups} table/company pairs, {$keys} expired idempotency keys, {$resolutions} resolutions.");

        return self::SUCCESS;
    }
}
