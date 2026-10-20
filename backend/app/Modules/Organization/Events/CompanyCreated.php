<?php

declare(strict_types=1);

namespace App\Modules\Organization\Events;

use Illuminate\Foundation\Events\Dispatchable;

/**
 * Dispatched inside the creating transaction so listeners (default roles) commit atomically with it.
 */
final class CompanyCreated
{
    use Dispatchable;

    public function __construct(
        public readonly string $companyId,
        public readonly ?string $createdBy = null,
    ) {}
}
