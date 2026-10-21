<?php

declare(strict_types=1);

namespace App\Modules\Organization\Console;

use App\Modules\Organization\Services\MasterDataIntegrity;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Read-only audit: master data rows that reference a record of another company (the single-column
 * foreign keys cannot prevent this; the module lookups do on every write). Exits with failure and
 * logs a warning when it finds any, so it can run from the scheduler or CI.
 */
final class AuditMasterDataTenancy extends Command
{
    protected $signature = 'master-data:audit-tenancy';

    protected $description = 'Report master data rows that reference records of another company (read-only)';

    public function handle(): int
    {
        $violations = (new MasterDataIntegrity(DB::connection()))->tenancyViolations();
        if ($violations === []) {
            $this->info('No cross-company references found.');

            return self::SUCCESS;
        }
        $this->table(['Reference', 'Rows'], array_map(null, array_keys($violations), array_values($violations)));
        Log::warning('master_data.cross_company_references', $violations);

        return self::FAILURE;
    }
}
