<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Console;

use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * A command over one company (argument) or every active company.
 */
abstract class CompanyCommand extends Command
{
    /**
     * @return list<string>|null null when the given company is unknown (error printed)
     */
    protected function companies(CompanyDirectory $companies): ?array
    {
        $company = $this->argument('company');

        if (is_string($company) && (! Str::isUuid($company) || ! $companies->isActive($company))) {
            $this->error(__('inventory::messages.command_company_missing'));

            return null;
        }

        return is_string($company) ? [$company] : array_column($companies->allActiveCompanies(), 'id');
    }
}
