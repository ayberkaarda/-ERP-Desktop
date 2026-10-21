<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Console;

use App\Modules\Inventory\Services\BalanceRebuilder;
use App\Modules\Organization\Contracts\CompanyDirectory;

final class RebuildBalances extends CompanyCommand
{
    /** @var string */
    protected $signature = 'inventory:rebuild-balances {company? : company id (default: every active company)} {--check : only report balances that differ from the movements}';

    /** @var string */
    protected $description = 'Recompute stock balances and valuations from the stock movements';

    public function handle(BalanceRebuilder $rebuilder, CompanyDirectory $companies): int
    {
        $ids = $this->companies($companies);

        if ($ids === null) {
            return self::FAILURE;
        }

        $differences = 0;

        foreach ($ids as $id) {
            if ($this->option('check')) {
                $found = $rebuilder->differences($id);
                $differences += count($found);

                foreach ($found as $d) {
                    $this->line("{$id}: {$d['item_id']} {$d['warehouse_id']} {$d['location_id']} {$d['lot_id']} stored {$d['stored']} movements {$d['computed']}");
                }

                continue;
            }

            $result = $rebuilder->rebuild($id);
            $this->line("{$id}: {$result['balances']} balances, {$result['valuations']} valuations");
        }

        return $differences > 0 ? self::FAILURE : self::SUCCESS;
    }
}
