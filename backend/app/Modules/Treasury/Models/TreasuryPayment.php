<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Models;

class TreasuryPayment extends TreasuryRecord
{
    protected $table = 'treasury_payments';

    protected function casts(): array
    {
        return [];
    }
}
