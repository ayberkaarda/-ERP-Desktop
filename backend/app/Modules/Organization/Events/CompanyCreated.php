<?php

declare(strict_types=1);

namespace App\Modules\Organization\Events;

use Illuminate\Foundation\Events\Dispatchable;

/**
 * Dispatched inside the creating transaction so listeners (default roles) commit atomically with it.
 *
 * $seedDefaults asks the master data modules to create their per-company defaults (currencies,
 * payment terms, default warehouse, root cost center, units). Default roles are always created.
 * Only callers that bring their own master data (imports, test fixtures) pass false.
 */
final class CompanyCreated
{
    use Dispatchable;

    public function __construct(
        public readonly string $companyId,
        public readonly ?string $createdBy = null,
        public readonly bool $seedDefaults = true,
    ) {}
}
