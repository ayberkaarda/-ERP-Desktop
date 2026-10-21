<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Console;

use App\Modules\Inventory\Services\InventoryRules;
use App\Modules\Organization\Contracts\CompanyDirectory;

final class SeedRules extends CompanyCommand
{
    /** @var string */
    protected $signature = 'inventory:seed-rules {company? : company id (default: every active company)}';

    /** @var string */
    protected $description = 'Create the default inventory account determination rules (idempotent)';

    public function handle(InventoryRules $rules, CompanyDirectory $companies): int
    {
        $ids = $this->companies($companies);

        if ($ids === null) {
            return self::FAILURE;
        }

        foreach ($ids as $id) {
            $this->line("{$id}: ".$rules->ensureDefaults($id));
        }

        return self::SUCCESS;
    }
}
