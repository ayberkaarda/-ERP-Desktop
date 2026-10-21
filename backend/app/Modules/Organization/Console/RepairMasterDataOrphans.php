<?php

declare(strict_types=1);

namespace App\Modules\Organization\Console;

use App\Modules\Organization\Services\MasterDataIntegrity;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Opt-in repair before the master data foreign key migrations on a populated database. Clears
 * references that may become empty (payment term, price list, tax codes, project party, warehouse
 * branch, default and bank account currency); company_id, currency codes that are required, risk
 * currencies and party discount rules are only listed and need a manual fix. Changes are not
 * written to the activity log; run it with --dry-run first.
 */
final class RepairMasterDataOrphans extends Command
{
    protected $signature = 'master-data:repair-orphans {--dry-run : Only list the orphan references}';

    protected $description = 'Report (and with care clear) master data references to missing records';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $report = (new MasterDataIntegrity(DB::connection()))->repairOrphans($dryRun);
        if ($report === []) {
            $this->info('No orphan references found.');

            return self::SUCCESS;
        }
        $manual = false;
        $rows = [];
        foreach ($report as $reference => [$count, $repaired]) {
            $repairable = in_array($reference, $this->repairable(), true);
            $manual = $manual || ! $repairable;
            $rows[] = [$reference, $count, match (true) {
                $repaired => 'cleared',
                $repairable => 'would be cleared',
                default => 'manual fix needed',
            }];
        }
        $this->table(['Reference', 'Rows', 'Action'], $rows);

        return $manual ? self::FAILURE : self::SUCCESS;
    }

    /** @return list<string> */
    private function repairable(): array
    {
        return array_values(array_map(
            static fn (array $key): string => "{$key[0]}.{$key[1]}",
            array_filter(MasterDataIntegrity::CROSS_MODULE, static fn (array $key): bool => $key[4]),
        ));
    }
}
