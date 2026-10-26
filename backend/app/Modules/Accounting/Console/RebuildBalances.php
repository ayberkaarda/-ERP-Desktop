<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Console;

use App\Modules\Accounting\Services\BalanceBook;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

final class RebuildBalances extends Command
{
    /** @var string */
    protected $signature = 'accounting:rebuild-balances {company? : company id (default: every active company)}';

    /** @var string */
    protected $description = 'Recompute account_balances from booked journal lines';

    public function handle(BalanceBook $balances, CompanyDirectory $companies): int
    {
        $company = $this->argument('company');

        if (is_string($company) && (! Str::isUuid($company) || ! $companies->isActive($company))) {
            $this->error(__('accounting::messages.command_company_missing'));

            return self::FAILURE;
        }

        $ids = is_string($company) ? [$company] : array_column($companies->allActiveCompanies(), 'id');

        foreach ($ids as $id) {
            $rows = $balances->rebuild($id);
            $this->line("{$id}: {$rows}");
        }

        return self::SUCCESS;
    }
}
