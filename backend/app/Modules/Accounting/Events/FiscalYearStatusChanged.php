<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A fiscal year was closed or reopened; dispatched after commit.
 */
final class FiscalYearStatusChanged implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(
        public readonly string $companyId,
        public readonly string $fiscalYearId,
        public readonly string $status,
    ) {}
}
