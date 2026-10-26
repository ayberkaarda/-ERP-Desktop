<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

use App\Modules\Accounting\Models\Account;

/** One account of the trial balance; parent accounts carry the sum of their sub-accounts. */
final readonly class TrialBalanceRow
{
    public function __construct(
        public Account $account,
        public Amounts $amounts,
        public ?Amounts $previous,
    ) {}
}
