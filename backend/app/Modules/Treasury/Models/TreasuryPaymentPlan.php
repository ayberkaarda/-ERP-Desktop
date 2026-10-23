<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Models;

class TreasuryPaymentPlan extends TreasuryRecord
{
    protected $table = 'treasury_payment_plans';

    protected function casts(): array
    {
        return [];
    }
}
