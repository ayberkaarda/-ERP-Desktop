<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Console;

use App\Modules\Inventory\Services\ReorderAdvisor;
use App\Modules\Organization\Contracts\CompanyDirectory;

final class CheckReorder extends CompanyCommand
{
    /** @var string */
    protected $signature = 'inventory:check-reorder {company? : company id (default: every active company)}';

    /** @var string */
    protected $description = 'Report items at or below their reorder point and notify stock viewers';

    public function handle(ReorderAdvisor $advisor, CompanyDirectory $companies): int
    {
        $ids = $this->companies($companies);

        if ($ids === null) {
            return self::FAILURE;
        }

        foreach ($ids as $id) {
            $this->line("{$id}: ".$advisor->check($id));
        }

        return self::SUCCESS;
    }
}
