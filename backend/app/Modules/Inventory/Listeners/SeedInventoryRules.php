<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Listeners;

use App\Modules\Inventory\Services\InventoryRules;
use App\Modules\Organization\Events\CompanyCreated;

/**
 * Runs inside the company creation transaction, after Accounting's bootstrap (providers boot in
 * module name order, so its chart of accounts exists by now).
 */
final class SeedInventoryRules
{
    public function __construct(private readonly InventoryRules $rules) {}

    public function handle(CompanyCreated $event): void
    {
        if (config('inventory.seed_rules_on_company_created') !== false) {
            $this->rules->ensureDefaults($event->companyId);
        }
    }
}
